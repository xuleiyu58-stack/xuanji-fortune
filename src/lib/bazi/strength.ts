/**
 * 日主强弱与用神喜忌。
 *
 * 这是整张盘最核心的一个结论 —— 格局、喜忌、大运吉凶，全都从这里往下推。
 *
 * **算法是透明的，不是玄的。** 逐项计分：同我（比劫）与生我（印）记入「帮身」，
 * 其余（食伤、财、官杀）记入「耗身」，月令的权重翻倍（月令司权最重）。
 * 帮身占比超过阈值即为身强，低于阈值即为身弱。界面上会把这份账目摊开给用户看，
 * 而不是只丢一个结论 —— 命理最怕的就是"大师说了算"。
 *
 * 需要说明的口径：身强身弱的判法各家有出入（有以得令为主的，有以通根为主的，
 * 也有专论格局不论强弱的）。这里取的是最通行、也最容易讲清楚的一套计分法。
 */

import {
  GAN_ELEMENT, HIDE_WEIGHTS, KE, SHENG, ZHI_HIDE_GAN,
  type WuXing,
} from "./constants.ts";

export interface StrengthPillar {
  label: string;
  gan: string;
  zhi: string;
}

export interface StrengthInput {
  /** 日干，即「我」 */
  dayGan: string;
  /** 四柱，顺序为 年、月、日、时 */
  pillars: readonly StrengthPillar[];
}

/** 月令权重。月支司权最重，所以它那一柱的藏干分量翻倍。 */
const MONTH_MULTIPLIER = 2;
/** 天干的权重。天干无根则虚浮，故低于地支。 */
const STEM_WEIGHT = 0.8;

const STRONG_THRESHOLD = 0.55;
const WEAK_THRESHOLD = 0.45;

export type StrengthVerdict = "身强" | "身弱" | "中和";

/** 某五行「生我者」是谁 —— SHENG 的正向是"我生"，这里求逆。 */
export function elementShengMe(me: WuXing): WuXing {
  return (Object.keys(SHENG) as WuXing[]).find((k) => SHENG[k] === me) ?? me;
}

/** 某五行「克我者」是谁 —— KE 的正向是"我克"，这里求逆。 */
export function elementKeMe(me: WuXing): WuXing {
  return (Object.keys(KE) as WuXing[]).find((k) => KE[k] === me) ?? me;
}

/** 五组十神各自对应的五行，全部由日主五行推出。 */
export interface GroupElements {
  比劫: WuXing;
  食伤: WuXing;
  财: WuXing;
  官杀: WuXing;
  印: WuXing;
}

export function groupElements(dayElement: WuXing): GroupElements {
  return {
    比劫: dayElement,
    食伤: SHENG[dayElement],
    财: KE[dayElement],
    官杀: elementKeMe(dayElement),
    印: elementShengMe(dayElement),
  };
}

export interface StrengthEntry {
  /** 来自哪一柱、哪一项（天干 or 某地支的某个藏干） */
  from: string;
  element: WuXing;
  /** 该藏干/天干对日主属于哪一组 */
  group: keyof GroupElements;
  weight: number;
  /** true = 帮身，false = 耗身 */
  helps: boolean;
}

export interface StrengthResult {
  verdict: StrengthVerdict;
  /** 帮身占比，0..1 */
  ratio: number;
  helpScore: number;
  drainScore: number;
  yongShen: WuXing;
  xiShen: WuXing;
  jiShen: WuXing;
  /** 一句话结论，留给界面直接显示 */
  summary: string;
  /** 推理账目，界面摊开给用户看 */
  entries: StrengthEntry[];
  /** 各组的五行，供界面解释「你的官杀是金」这类话 */
  groups: GroupElements;
  /** 五组十神的力量排行 —— 身强身弱说「够不够强」，这个说「力气花在哪」 */
  groupPower: GroupPower[];
}

function groupOf(dayElement: WuXing, element: WuXing): keyof GroupElements {
  const g = groupElements(dayElement);
  for (const key of Object.keys(g) as (keyof GroupElements)[]) {
    if (g[key] === element) return key;
  }
  return "比劫";
}

/**
 * 计分。
 *
 * 逐项走一遍：天干按 STEM_WEIGHT，地支藏干按 HIDE_WEIGHTS，月支整体乘 MONTH_MULTIPLIER。
 * 「同我」与「生我」记帮身，其余记耗身。
 */
export function scoreStrength(input: StrengthInput): {
  entries: StrengthEntry[];
  helpScore: number;
  drainScore: number;
  ratio: number;
} {
  const dayElement = GAN_ELEMENT[input.dayGan];
  const entries: StrengthEntry[] = [];

  for (const pillar of input.pillars) {
    // 天干：日干本身是「我」，不参与计分
    if (pillar.label !== "日柱") {
      const element = GAN_ELEMENT[pillar.gan];
      if (element) {
        const group = groupOf(dayElement, element);
        entries.push({
          from: `${pillar.label}天干${pillar.gan}`,
          element,
          group,
          weight: STEM_WEIGHT,
          helps: group === "比劫" || group === "印",
        });
      }
    }

    // 地支藏干
    const hides = ZHI_HIDE_GAN[pillar.zhi] ?? [];
    const mult = pillar.label === "月柱" ? MONTH_MULTIPLIER : 1;
    hides.forEach((gan, idx) => {
      const element = GAN_ELEMENT[gan];
      if (!element) return;
      const group = groupOf(dayElement, element);
      const w = (HIDE_WEIGHTS[idx] ?? 0.25) * mult;
      entries.push({
        from: `${pillar.label}${pillar.zhi}藏${gan}`,
        element,
        group,
        weight: w,
        helps: group === "比劫" || group === "印",
      });
    });
  }

  let helpScore = 0;
  let drainScore = 0;
  for (const e of entries) {
    if (e.helps) helpScore += e.weight;
    else drainScore += e.weight;
  }

  const total = helpScore + drainScore;
  const ratio = total > 0 ? helpScore / total : 0.5;

  return { entries, helpScore, drainScore, ratio };
}

/**
 * 由帮身占比定强弱，并据强弱取用神。
 *
 * 用神的取法（简化但可解释）：
 *   身强 → 需要克制，所以用神从 官杀（克我）→ 食伤（泄我）→ 财（耗我）里依次取第一个
 *          在盘中有出现的
 *   身弱 → 需要帮扶，所以用神从 印（生我）→ 比劫（同我）里依次取
 *   中和 → 不强不弱，补盘中最缺的那一行
 *
 * 喜神取生用神者，忌神取克用神者 —— 这是五行生克的直接推论，不另立规则。
 */
export function analyzeStrength(input: StrengthInput): StrengthResult {
  const dayElement = GAN_ELEMENT[input.dayGan];
  const groups = groupElements(dayElement);
  const { entries, helpScore, drainScore, ratio } = scoreStrength(input);

  // 盘上实际出现过哪些五行 —— 用于「取有出现的那一组」
  const present = new Set<WuXing>(entries.map((e) => e.element));

  let verdict: StrengthVerdict;
  let yongShen: WuXing;

  if (ratio > STRONG_THRESHOLD) {
    verdict = "身强";
    yongShen = [groups.官杀, groups.食伤, groups.财].find((e) => present.has(e)) ?? groups.官杀;
  } else if (ratio < WEAK_THRESHOLD) {
    verdict = "身弱";
    yongShen = [groups.印, groups.比劫].find((e) => present.has(e)) ?? groups.印;
  } else {
    verdict = "中和";
    // 中和不进取用，补最缺的一行
    const missing = (["金", "木", "水", "火", "土"] as WuXing[]).filter((e) => !present.has(e));
    yongShen = missing[0] ?? groups.财;
  }

  const xiShen = elementShengMe(yongShen); // 生用神者为喜
  const jiShen = elementKeMe(yongShen); // 克用神者为忌

  const pct = Math.round(ratio * 100);
  // 结语里保留「身强 / 身弱 / 中和」这三个标准词 —— 命理读者到处会遇到它们，
  // 回避反而更不好懂。后面紧跟一句白话，把"旺了该怎么办"说清楚。
  const summary =
    verdict === "身强"
      ? `日主身强，帮身之力约占 ${pct}%。旺则需要疏泄与克制，所以喜${yongShen}、${xiShen}，忌${jiShen}。`
      : verdict === "身弱"
        ? `日主身弱，帮身之力约占 ${pct}%。弱则需要生扶，所以喜${yongShen}、${xiShen}，忌${jiShen}。`
        : `日主中和，帮身之力约占 ${pct}%。中和之局以平衡为要，宜补${yongShen}。`;

  return {
    verdict, ratio, helpScore, drainScore, yongShen, xiShen, jiShen, summary, entries, groups,
    groupPower: groupPower(entries),
  };
}

export interface GroupPower {
  group: keyof GroupElements;
  /** 五组十神的中文名，直接可显示 */
  label: string;
  weight: number;
  percent: number;
}

const GROUP_LABEL: Record<keyof GroupElements, string> = {
  比劫: "比劫 · 同我者",
  食伤: "食伤 · 我生者",
  财: "财星 · 我克者",
  官杀: "官杀 · 克我者",
  印: "印星 · 生我者",
};

/**
 * 按十神五组汇总力量并排行。
 *
 * 身强身弱回答的是「我够不够强」，这个问题回答的是「我的力气花在哪」——
 * 两者合起来才看得出一个人是靠什么立身、又在哪一路失衡。
 * 排序无关于吉凶：哪一组最旺，只说明那股力量在命里占的位置最重。
 */
export function groupPower(entries: readonly StrengthEntry[]): GroupPower[] {
  const acc: Record<keyof GroupElements, number> = { 比劫: 0, 食伤: 0, 财: 0, 官杀: 0, 印: 0 };
  for (const e of entries) acc[e.group] += e.weight;

  const total = Object.values(acc).reduce((s, v) => s + v, 0) || 1;
  return (Object.keys(acc) as (keyof GroupElements)[])
    .map((group) => ({
      group,
      label: GROUP_LABEL[group],
      weight: Math.round(acc[group] * 100) / 100,
      percent: Math.round((acc[group] / total) * 100),
    }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * 用神取法的口径说明。
 *
 * 取用神是八字里分歧最大的一步。本站用的是最通行、也最容易讲清楚的一套，
 * 但它不是唯一的一套 —— 这份说明要原样显示给用户，不能让他以为这是定论。
 */
export const YONG_SHEN_METHOD =
  "取用神各家不同。本站用的是最通行的一套：身强就从官杀、食伤、财里取一个在盘中有力的，身弱就从印、比劫里取。" +
  "正统还要再看调候（寒暖燥湿）、通关（两强相争取中间那个）与病药（哪一处是病、哪一味是药）—— 这三样没有收录，" +
  "所以这里的用神只是一个起点，不是定论。";

/** 把「帮身 / 耗身」的账目按五行汇总，供界面画势力对比。 */
export function powerByElement(entries: readonly StrengthEntry[]): Record<WuXing, { help: number; drain: number }> {
  const out: Record<WuXing, { help: number; drain: number }> = {
    金: { help: 0, drain: 0 },
    木: { help: 0, drain: 0 },
    水: { help: 0, drain: 0 },
    火: { help: 0, drain: 0 },
    土: { help: 0, drain: 0 },
  };
  for (const e of entries) {
    if (e.helps) out[e.element].help += e.weight;
    else out[e.element].drain += e.weight;
  }
  for (const k of Object.keys(out) as WuXing[]) {
    out[k].help = Math.round(out[k].help * 100) / 100;
    out[k].drain = Math.round(out[k].drain * 100) / 100;
  }
  return out;
}
