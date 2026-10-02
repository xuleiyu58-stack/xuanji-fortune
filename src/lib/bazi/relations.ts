/**
 * 干支之间的关系推算：十神、合冲刑害。
 *
 * 零依赖，只查 constants 里的表。所有函数都是纯函数 —— 给定输入必然同一输出，
 * 这是「盘由代码算」这条线能被验证的前提。
 */

import {
  GAN_WU_HE, KE, SHENG, ZHI_LIU_HE, ZHI_SAN_HE,
  GAN_ELEMENT, ZHI_ELEMENT, ganIsYang, zhiIsYang,
  type ShiShen, type WuXing, type Zhi,
} from "./constants.ts";

/**
 * 以日主为我，推某一天干（或地支藏干）的十神。
 *
 * 五组关系各分同阴阳 / 异阴阳：
 *   同我 → 比肩 / 劫财     我生 → 食神 / 伤官
 *   我克 → 偏财 / 正财     克我 → 七杀 / 正官
 *   生我 → 偏印 / 正印
 */
export function shiShenOf(dayGan: string, targetGan: string): ShiShen {
  const me = GAN_ELEMENT[dayGan];
  const it = GAN_ELEMENT[targetGan];
  if (!me || !it) return "比肩";

  const same = ganIsYang(dayGan) === ganIsYang(targetGan);

  if (it === me) return same ? "比肩" : "劫财";
  if (SHENG[me] === it) return same ? "食神" : "伤官";
  if (KE[me] === it) return same ? "偏财" : "正财";
  if (KE[it] === me) return same ? "七杀" : "正官";
  if (SHENG[it] === me) return same ? "偏印" : "正印";
  return "比肩";
}

/** 十神的五种归属：比劫 / 食伤 / 财 / 官杀 / 印。用于统计势力。 */
export type ShiShenGroup = "比劫" | "食伤" | "财" | "官杀" | "印";

export const SHI_SHEN_GROUP: Record<ShiShen, ShiShenGroup> = {
  比肩: "比劫", 劫财: "比劫",
  食神: "食伤", 伤官: "食伤",
  偏财: "财", 正财: "财",
  七杀: "官杀", 正官: "官杀",
  偏印: "印", 正印: "印",
};

/**
 * 十神的人话解释。
 *
 * 「易懂」这条要求的落点在这里：盘上出现的每个术语，界面上都要能就地展开一句
 * 不带行话的说明。写得像给人看的，不像从字典里抄的。
 */
export const SHI_SHEN_MEANING: Record<ShiShen, { keyword: string; plain: string }> = {
  比肩: { keyword: "自立", plain: "与我同性同气。主独立、主见、朋友与同辈，也主不肯低头。" },
  劫财: { keyword: "竞争", plain: "与我同类但异性。主进取、合作与争夺，钱来得快去得也快。" },
  食神: { keyword: "才艺", plain: "由我生出而不争。主才华、口福、温和从容，是会享受生活的那一面。" },
  伤官: { keyword: "锋芒", plain: "由我生出但不服管。主聪明外露、表达力强，也容易锋芒伤人。" },
  偏财: { keyword: "机遇", plain: "为我所支配的流动之财。主机会、人脉、出手大方，来得不规律。" },
  正财: { keyword: "务实", plain: "为我所支配的稳定之财。主勤俭、踏实、按部就班积累。" },
  七杀: { keyword: "魄力", plain: "克制我而与我同性。主压力、竞争、决断与权柄，扛住了就是能力。" },
  正官: { keyword: "规矩", plain: "克制我而与我异性。主责任、名位、自律与约束，是秩序那一面。" },
  偏印: { keyword: "直觉", plain: "生扶我而与我同性。主偏才、直觉、独处，也主想得多、不易被理解。" },
  正印: { keyword: "庇荫", plain: "生扶我而与我异性。主学识、庇护、长辈缘，是让人心里有底的那一面。" },
};

export interface BranchPair {
  /** 参与关系的地支 */
  pair: readonly [Zhi, Zhi];
  kind: "六合" | "相冲";
  /** 六合化出的五行；相冲没有 */
  element?: WuXing;
}

/** 找出四支之间的六合与相冲。 */
export function branchRelations(zhiList: readonly string[]): BranchPair[] {
  const out: BranchPair[] = [];
  const uniq = [...new Set(zhiList)];

  for (let i = 0; i < zhiList.length; i++) {
    for (let j = i + 1; j < zhiList.length; j++) {
      const a = zhiList[i];
      const b = zhiList[j];
      const he = ZHI_LIU_HE.find(
        ([x, y]) => (x === a && y === b) || (x === b && y === a)
      );
      if (he) out.push({ pair: [a as Zhi, b as Zhi], kind: "六合", element: he[2] });
    }
  }

  // 相冲按"有就报一次"计，同一个支不重复出现
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i];
      const b = uniq[j];
      const ia = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"].indexOf(a);
      const ib = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"].indexOf(b);
      if (ia >= 0 && ib >= 0 && (ia + 6) % 12 === ib) {
        out.push({ pair: [a as Zhi, b as Zhi], kind: "相冲" });
      }
    }
  }

  return out;
}

export interface TripleHarmony {
  /** 三合局：申子辰… */
  branches: readonly [Zhi, Zhi, Zhi];
  element: WuXing;
  /** true = 三支俱全；false = 只见到其中两支（半合） */
  complete: boolean;
}

/** 找出四支里的三合局与半合。 */
export function tripleHarmonies(zhiList: readonly string[]): TripleHarmony[] {
  const present = new Set(zhiList);
  const out: TripleHarmony[] = [];

  for (const [a, b, c, element] of ZHI_SAN_HE) {
    const hit = [a, b, c].filter((z) => present.has(z));
    if (hit.length === 3) {
      out.push({ branches: [a, b, c], element, complete: true });
    } else if (hit.length === 2 && present.has(a)) {
      // 半合要求带长生那一支（a），否则不作数 —— 这是通行的取法
      out.push({ branches: [a, b, c], element, complete: false });
    }
  }

  return out;
}

export interface StemPair {
  pair: readonly [string, string];
  element: WuXing;
}

/** 找出天干之间的五合。 */
export function stemHarmonies(ganList: readonly string[]): StemPair[] {
  const out: StemPair[] = [];
  for (let i = 0; i < ganList.length; i++) {
    for (let j = i + 1; j < ganList.length; j++) {
      const a = ganList[i];
      const b = ganList[j];
      const he = GAN_WU_HE.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (he) out.push({ pair: [a, b], element: he[2] });
    }
  }
  return out;
}

/** 五行对一个具体天干的生克关系，用于把「身强身弱」的推理讲清楚。 */
export function elementRelation(me: WuXing, other: WuXing): "同" | "生" | "泄" | "克" | "被克" {
  if (me === other) return "同";
  if (SHENG[me] === other) return "泄"; // 我生它 → 泄我之气
  if (KE[me] === other) return "克"; // 我克它 → 耗我之力
  if (KE[other] === me) return "被克"; // 它克我
  return "生"; // 它生我
}

/** 地支的阴阳，界面用来解释「为何同一五行却有正偏之分」。 */
export function branchIsYang(zhi: string): boolean {
  return zhiIsYang(zhi);
}

/** 供 strength 模块复用：某地支的本气五行。 */
export function branchElement(zhi: string): WuXing {
  return ZHI_ELEMENT[zhi] ?? "土";
}
