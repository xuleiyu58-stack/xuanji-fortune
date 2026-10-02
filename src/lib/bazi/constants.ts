/**
 * 八字的基础表：干支、五行、藏干、十二长生。
 *
 * 全是数据与查表，零依赖 —— 因此能被 node --test 直接跑。
 * 有争议的口径（例如庚辛的长生位、阴干的禄刃）在下面各自注明取哪一派，
 * 不要为了"看起来更全"把几派混在一张表里。
 */

export const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
export const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;

export type Gan = (typeof GAN)[number];
export type Zhi = (typeof ZHI)[number];
export type WuXing = "金" | "木" | "水" | "火" | "土";

/** 展示用的固定顺序。金木水火土这个次序是习惯用法，不是生克次序。 */
export const WU_XING_ORDER: readonly WuXing[] = ["金", "木", "水", "火", "土"];

export const GAN_ELEMENT: Record<string, WuXing> = {
  甲: "木", 乙: "木",
  丙: "火", 丁: "火",
  戊: "土", 己: "土",
  庚: "金", 辛: "金",
  壬: "水", 癸: "水",
};

export const ZHI_ELEMENT: Record<string, WuXing> = {
  子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火",
  午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水",
};

/** 阳干：甲丙戊庚壬（下标为偶）。用于判十神的"同阴阳 / 异阴阳"。 */
export function ganIsYang(gan: string): boolean {
  return (GAN as readonly string[]).indexOf(gan) % 2 === 0;
}

/** 阳支：子寅辰午申戌（下标为偶）。 */
export function zhiIsYang(zhi: string): boolean {
  return (ZHI as readonly string[]).indexOf(zhi) % 2 === 0;
}

/** 五行相生：木生火、火生土、土生金、金生水、水生木 */
export const SHENG: Record<WuXing, WuXing> = {
  木: "火", 火: "土", 土: "金", 金: "水", 水: "木",
};

/** 五行相克：木克土、土克水、水克火、火克金、金克木 */
export const KE: Record<WuXing, WuXing> = {
  木: "土", 土: "水", 水: "火", 火: "金", 金: "木",
};

/**
 * 地支藏干，顺序为 本气 → 中气 → 余气。
 *
 * 与 `HIDE_WEIGHTS` 的下标一一对应。四库（辰戌丑未）与四生的差异最大，
 * 各家出入也多，这里取最通行的一套。
 */
export const ZHI_HIDE_GAN: Record<string, readonly string[]> = {
  子: ["癸"],
  丑: ["己", "癸", "辛"],
  寅: ["甲", "丙", "戊"],
  卯: ["乙"],
  辰: ["戊", "乙", "癸"],
  巳: ["丙", "庚", "戊"],
  午: ["丁", "己"],
  未: ["己", "丁", "乙"],
  申: ["庚", "壬", "戊"],
  酉: ["辛"],
  戌: ["戊", "辛", "丁"],
  亥: ["壬", "甲"],
};

/** 藏干权重：本气 1、中气 0.5、余气 0.25。 */
export const HIDE_WEIGHTS: readonly number[] = [1, 0.5, 0.25];

/** 十二长生，从长生起顺数。 */
export const CHANG_SHENG = [
  "长生", "沐浴", "冠带", "临官", "帝旺", "衰", "病", "死", "墓", "绝", "胎", "养",
] as const;

export type ChangSheng = (typeof CHANG_SHENG)[number];

/**
 * 各天干的长生位。
 * 阳干顺行、阴干逆行 —— 这是子平法的通行口径。
 */
export const CHANG_SHENG_START: Record<string, Zhi> = {
  甲: "亥", 丙: "寅", 戊: "寅", 庚: "巳", 壬: "申",
  乙: "午", 丁: "酉", 己: "酉", 辛: "子", 癸: "卯",
};

/**
 * 求天干在某地支上的十二长生。
 *
 * 阳干顺数、阴干逆数：甲长生在亥，逆行一位到戌是沐浴 —— 不是。
 * 甲是阳干，顺行：亥(长生) → 子(沐浴) → 丑(冠带) → 寅(临官) …
 * 乙是阴干，逆行：午(长生) → 巳(沐浴) → 辰(冠带) → 卯(临官) …
 */
export function changShengOf(gan: string, zhi: string): ChangSheng | null {
  const start = CHANG_SHENG_START[gan];
  if (!start) return null;
  const startIdx = (ZHI as readonly string[]).indexOf(start);
  const zhiIdx = (ZHI as readonly string[]).indexOf(zhi);
  if (startIdx < 0 || zhiIdx < 0) return null;

  const forward = ganIsYang(gan);
  const step = forward
    ? (zhiIdx - startIdx + 12) % 12
    : (startIdx - zhiIdx + 12) % 12;
  return CHANG_SHENG[step];
}

/** 地支六合：子丑合土、寅亥合木、卯戌合火、辰酉合金、巳申合水、午未合土 */
export const ZHI_LIU_HE: readonly (readonly [Zhi, Zhi, WuXing])[] = [
  ["子", "丑", "土"],
  ["寅", "亥", "木"],
  ["卯", "戌", "火"],
  ["辰", "酉", "金"],
  ["巳", "申", "水"],
  ["午", "未", "土"],
];

/** 地支六冲：子午、丑未、寅申、卯酉、辰戌、巳亥（相隔六位） */
export function zhiChong(a: string, b: string): boolean {
  const ia = (ZHI as readonly string[]).indexOf(a);
  const ib = (ZHI as readonly string[]).indexOf(b);
  if (ia < 0 || ib < 0) return false;
  return (ia + 6) % 12 === ib;
}

/** 地支三合局：申子辰合水、寅午戌合火、巳酉丑合金、亥卯未合木 */
export const ZHI_SAN_HE: readonly (readonly [Zhi, Zhi, Zhi, WuXing])[] = [
  ["申", "子", "辰", "水"],
  ["寅", "午", "戌", "火"],
  ["巳", "酉", "丑", "金"],
  ["亥", "卯", "未", "木"],
];

/** 天干五合：甲己合土、乙庚合金、丙辛合水、丁壬合木、戊癸合火 */
export const GAN_WU_HE: readonly (readonly [Gan, Gan, WuXing])[] = [
  ["甲", "己", "土"],
  ["乙", "庚", "金"],
  ["丙", "辛", "水"],
  ["丁", "壬", "木"],
  ["戊", "癸", "火"],
];

/** 「十神」的固定顺序，供界面稳定排序用。 */
export const SHI_SHEN_ORDER = [
  "比肩", "劫财", "食神", "伤官", "偏财", "正财", "七杀", "正官", "偏印", "正印",
] as const;

export type ShiShen = (typeof SHI_SHEN_ORDER)[number];
