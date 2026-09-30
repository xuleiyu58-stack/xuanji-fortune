/**
 * 合婚。
 *
 * 接收两张**已排好**的命盘，只做关系判定与打分 —— 不自己排盘、不调模型。
 * 纯函数、零运行时 import（只 import type，编译后会被擦除），便于 node --test 直接跑。
 *
 * 关于"匹配度"这个数字：它是公开可复核的加权和，每一项加减分都在 factors 里列出来，
 * 界面上也逐条展示。不给黑箱分数 —— 命理产品最不该做的事就是让人猜数字怎么来的。
 */

import type { BaziChart, WuXing } from "./bazi";

const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

/** 十二地支的六种关系。用显式配对表而不是取模算 —— 记错一个模运算就会静默判错。 */
export const ZHI_PAIRS: Record<string, [string, string][]> = {
  六合: [["子", "丑"], ["寅", "亥"], ["卯", "戌"], ["辰", "酉"], ["巳", "申"], ["午", "未"]],
  六冲: [["子", "午"], ["丑", "未"], ["寅", "申"], ["卯", "酉"], ["辰", "戌"], ["巳", "亥"]],
  六害: [["子", "未"], ["丑", "午"], ["寅", "巳"], ["卯", "辰"], ["申", "亥"], ["酉", "戌"]],
  相刑: [["寅", "巳"], ["巳", "申"], ["寅", "申"], ["丑", "戌"], ["戌", "未"], ["丑", "未"], ["子", "卯"]],
};

const SAN_HE: readonly (readonly string[])[] = [
  ["申", "子", "辰"],
  ["亥", "卯", "未"],
  ["寅", "午", "戌"],
  ["巳", "酉", "丑"],
];

const has = (pairs: [string, string][], x: string, y: string) =>
  pairs.some(([a, b]) => (a === x && b === y) || (a === y && b === x));

export type ZodiacRelation = "六合" | "三合" | "相刑" | "六害" | "六冲" | "自刑" | "普通";

/**
 * 判定顺序按**严重程度**排：六合 → 六冲 → 相刑 → 六害 → 三合。
 *
 * 顺序不是随意的：若干组合同时成立两种关系，必须先取更重的那个。
 * 例如「寅巳」既属六害又属相刑（寅巳申三刑），「寅申」既相冲又相刑。
 * 早先按 六害 → 相刑 排，寅巳就被误判成了六害。
 */
export function zodiacRelation(a: string, b: string): ZodiacRelation {
  if (a === b) return ZHI.includes(a) ? "自刑" : "普通";
  if (has(ZHI_PAIRS.六合, a, b)) return "六合";
  if (has(ZHI_PAIRS.六冲, a, b)) return "六冲";
  if (has(ZHI_PAIRS.相刑, a, b)) return "相刑";
  if (has(ZHI_PAIRS.六害, a, b)) return "六害";
  if (SAN_HE.some((set) => set.includes(a) && set.includes(b))) return "三合";
  return "普通";
}

const SHENG: Record<WuXing, WuXing> = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const KE: Record<WuXing, WuXing> = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

export type ElementRelation = "相生" | "比和" | "相克";

export function elementRelation(a: WuXing, b: WuXing): ElementRelation {
  if (a === b) return "比和";
  if (SHENG[a] === b || SHENG[b] === a) return "相生";
  if (KE[a] === b || KE[b] === a) return "相克";
  return "比和";
}

export interface MatchFactor {
  name: string;
  verdict: string;
  delta: number;
  detail: string;
}

export interface LoveMatch {
  score: number;
  band: string;
  factors: MatchFactor[];
  zodiac: { a: string; b: string; relation: ZodiacRelation };
  dayMaster: { a: string; b: string; relation: ElementRelation };
  /** 一方所缺、而另一方明显有的五行 */
  complements: WuXing[];
}

const ZODIAC_DELTA: Record<ZodiacRelation, number> = {
  六合: 15,
  三合: 12,
  普通: 4,
  六害: -8,
  相刑: -10,
  六冲: -15,
  自刑: -6,
};

const ELEMENT_DELTA: Record<ElementRelation, number> = { 相生: 12, 比和: 8, 相克: -8 };

const COMPLEMENT_THRESHOLD = 20; // 对方该五行占比超过这个数，才算"补得上"

export function matchCharts(a: BaziChart, b: BaziChart): LoveMatch {
  const relation = zodiacRelation(a.pillars[0].zhi, b.pillars[0].zhi);
  const dmRelation = elementRelation(a.dayMasterElement, b.dayMasterElement);

  // 互补：一方缺的五行，在另一方盘里是否够旺
  const strongOf = (c: BaziChart) =>
    new Set(c.elements.filter((e) => e.percent >= COMPLEMENT_THRESHOLD).map((e) => e.element));
  const strongA = strongOf(a);
  const strongB = strongOf(b);
  const complements: WuXing[] = Array.from(
    new Set([
      ...a.missing.filter((el) => strongB.has(el)),
      ...b.missing.filter((el) => strongA.has(el)),
    ])
  );

  const factors: MatchFactor[] = [
    {
      name: "生肖",
      verdict: relation,
      delta: ZODIAC_DELTA[relation],
      detail: `${a.zodiac}与${b.zodiac}为${relation}`,
    },
    {
      name: "日主",
      verdict: dmRelation,
      delta: ELEMENT_DELTA[dmRelation],
      detail: `日主${a.dayMaster}${a.dayMasterElement} 与 ${b.dayMaster}${b.dayMasterElement} ${dmRelation}`,
    },
  ];

  if (complements.length > 0) {
    const delta = Math.min(complements.length * 6, 18);
    factors.push({
      name: "五行互补",
      verdict: complements.join("、"),
      delta,
      detail: `对方命中${complements.join("、")}偏旺，恰能补本方所缺`,
    });
  }

  const raw = 50 + factors.reduce((sum, f) => sum + f.delta, 0);
  const score = Math.max(0, Math.min(100, raw));

  const band = score >= 80 ? "上等" : score >= 65 ? "中上" : score >= 50 ? "中等" : "需经营";

  return {
    score,
    band,
    factors,
    zodiac: { a: a.zodiac, b: b.zodiac, relation },
    dayMaster: { a: `${a.dayMaster}${a.dayMasterElement}`, b: `${b.dayMaster}${b.dayMasterElement}`, relation: dmRelation },
    complements,
  };
}

export function loveToPrompt(match: LoveMatch): string {
  const factors = match.factors.map((f) => `- ${f.name}：${f.detail}（${f.delta >= 0 ? "+" : ""}${f.delta}）`).join("\n");
  return [
    `合婚匹配度：${match.score} 分（${match.band}）`,
    "评定依据（已由程序算定，不得改动）：",
    factors,
  ].join("\n");
}
