/**
 * 每日运势的起卦与解读结构化。
 *
 * 起卦是确定性的，不该让模型"编一个卦名" —— 与八字排盘、塔罗抽牌同一个原则。
 * 这里以**当日干支**起卦：日干序定上卦、日支序定下卦、二者之和定动爻。
 *
 * 说明白：这不是梅花易数原法（原法要用问卦时的年月日时，那样全站同一个时辰内同卦、
 * 换个时辰又变）。每日运势要的是"今天这一卦"，以当日干支为准最稳，且同一天全站一致。
 *
 * 零项目内 import，但依赖 lunar-typescript 取真实干支（npm 包不影响 node --test）。
 */

import { Solar } from "lunar-typescript";

export type BaGuaName = "乾" | "兑" | "离" | "震" | "巽" | "坎" | "艮" | "坤";

export interface Trigram {
  name: BaGuaName;
  /** 取象：天泽火雷风水山地 */
  image: string;
  /** 三爻，上→下。true 为阳爻（实线） */
  bars: readonly [boolean, boolean, boolean];
}

/** 取象歌：乾三连，坤六断，震仰盂，艮覆碗，离中虚，坎中满，兑上缺，巽下断 */
export const BAGUA: Record<BaGuaName, Trigram> = {
  乾: { name: "乾", image: "天", bars: [true, true, true] },
  兑: { name: "兑", image: "泽", bars: [false, true, true] },
  离: { name: "离", image: "火", bars: [true, false, true] },
  震: { name: "震", image: "雷", bars: [false, false, true] },
  巽: { name: "巽", image: "风", bars: [true, true, false] },
  坎: { name: "坎", image: "水", bars: [false, true, false] },
  艮: { name: "艮", image: "山", bars: [true, false, false] },
  坤: { name: "坤", image: "地", bars: [false, false, false] },
};

/** 起卦用的八卦次序 */
export const BAGUA_ORDER: BaGuaName[] = ["乾", "兑", "离", "震", "巽", "坎", "艮", "坤"];

const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

/**
 * 六十四卦名。**行＝下卦，列＝上卦**，行列次序均为 乾兑离震巽坎艮坤。
 *
 * 注意取用方向：查表必须写 `HEXAGRAM[下卦][上卦]`。写成 [上卦][下卦] 会静默取到错卦 ——
 * 比如「上坎下震」本该是水雷屯，取反就成了雷水解，而且看起来完全像真的。
 * 表里已用文王卦序钉住八个可交叉验证的点（见 tests/daily.test.mts）。
 */
const HEXAGRAM: Record<BaGuaName, Record<BaGuaName, string>> = {
  乾: { 乾: "乾为天", 兑: "泽天夬", 离: "火天大有", 震: "雷天大壮", 巽: "风天小畜", 坎: "水天需", 艮: "山天大畜", 坤: "地天泰" },
  兑: { 乾: "天泽履", 兑: "兑为泽", 离: "火泽睽", 震: "雷泽归妹", 巽: "风泽中孚", 坎: "水泽节", 艮: "山泽损", 坤: "地泽临" },
  离: { 乾: "天火同人", 兑: "泽火革", 离: "离为火", 震: "雷火丰", 巽: "风火家人", 坎: "水火既济", 艮: "山火贲", 坤: "地火明夷" },
  震: { 乾: "天雷无妄", 兑: "泽雷随", 离: "火雷噬嗑", 震: "震为雷", 巽: "风雷益", 坎: "水雷屯", 艮: "山雷颐", 坤: "地雷复" },
  巽: { 乾: "天风姤", 兑: "泽风大过", 离: "火风鼎", 震: "雷风恒", 巽: "巽为风", 坎: "水风井", 艮: "山风蛊", 坤: "地风升" },
  坎: { 乾: "天水讼", 兑: "泽水困", 离: "火水未济", 震: "雷水解", 巽: "风水涣", 坎: "坎为水", 艮: "山水蒙", 坤: "地水师" },
  艮: { 乾: "天山遁", 兑: "泽山咸", 离: "火山旅", 震: "雷山小过", 巽: "风山渐", 坎: "水山蹇", 艮: "艮为山", 坤: "地山谦" },
  坤: { 乾: "天地否", 兑: "泽地萃", 离: "火地晋", 震: "雷地豫", 巽: "风地观", 坎: "水地比", 艮: "山地剥", 坤: "坤为地" },
};

export function hexagramName(upper: BaGuaName, lower: BaGuaName): string {
  // 表的行是下卦、列是上卦，故此处是 [lower][upper] —— 别按参数顺序直觉写
  return HEXAGRAM[lower][upper];
}

export interface Hexagram {
  name: string;
  upper: Trigram;
  lower: Trigram;
  /** 六爻，上→下。前三条为上卦，后三条为下卦 */
  lines: boolean[];
  /** 动爻位置，1=初爻（最下），6=上爻（最下标的反向） */
  movingLine: number;
  ganzhi: string;
  lunarDate: string;
}

/** 以当日干支起卦。同一天全站同卦。 */
export function castDailyHexagram(date: Date = new Date()): Hexagram {
  const solar = Solar.fromYmdHms(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    12, 0, 0
  );
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();

  const dayGan = ec.getDayGan();
  const dayZhi = ec.getDayZhi();
  const ganIdx = GAN.indexOf(dayGan); // 0-9
  const zhiIdx = ZHI.indexOf(dayZhi); // 0-11

  const upperName = BAGUA_ORDER[ganIdx % 8];
  const lowerName = BAGUA_ORDER[zhiIdx % 8];
  const upper = BAGUA[upperName];
  const lower = BAGUA[lowerName];

  const movingLine = ((ganIdx + zhiIdx) % 6) + 1;

  return {
    name: HEXAGRAM[lowerName][upperName],
    upper,
    lower,
    lines: [...upper.bars, ...lower.bars],
    movingLine,
    ganzhi: `${dayGan}${dayZhi}`,
    lunarDate: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
  };
}

/**
 * 动爻在 `lines` 数组里的下标。
 * lines 是上→下（下标 0 是上爻），而动爻号是自下而上 1-6（1 是初爻）。
 * 二者方向相反，这里统一换算一次，避免渲染层各算各的算反。
 */
export function movingLineIndex(hexagram: Hexagram): number {
  return 6 - hexagram.movingLine;
}

export function hexagramToPrompt(h: Hexagram): string {
  return [
    `今日干支：${h.ganzhi}日`,
    `农历：${h.lunarDate}`,
    `卦：${h.name}（上${h.upper.name}${h.upper.image}，下${h.lower.name}${h.lower.image}）`,
    `动爻：第 ${h.movingLine} 爻`,
  ].join("\n");
}

export interface DailyReading {
  hexagram: Hexagram;
  /** 【宜】里的条目 */
  good: string[];
  /** 【忌】里的条目 */
  bad: string[];
  lucky: { color?: string; number?: string; direction?: string };
}

const splitItems = (raw: string): string[] =>
  raw
    .split(/[、，,；;／/|｜]/)
    .map((s) => s.replace(/^[\s·•\-—]+|[\s。]+$/g, ""))
    .filter((s) => s.length > 0 && s.length <= 12)
    .slice(0, 6);

/**
 * 从模型的文本里抽出宜/忌/幸运三块。
 * 抽不到就返回 null —— 界面会退回只展示原文，不会因为格式没跟上就白屏。
 */
export function parseDailyReading(text: string, hexagram: Hexagram): DailyReading | null {
  const pick = (label: string): string | null => {
    const re = new RegExp(`【${label}】\\s*([^\\n【]+)`);
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };

  const goodRaw = pick("宜");
  const badRaw = pick("忌");
  if (!goodRaw || !badRaw) return null;

  const good = splitItems(goodRaw);
  const bad = splitItems(badRaw);
  if (good.length === 0 || bad.length === 0) return null;

  const luckyRaw = pick("幸运指南") ?? "";
  const grab = (key: string): string | undefined => {
    const m = luckyRaw.match(new RegExp(`${key}\\s*[:：]\\s*([^｜|、，,；;\\s]+)`));
    return m ? m[1].trim() : undefined;
  };

  return {
    hexagram,
    good,
    bad,
    lucky: { color: grab("颜色"), number: grab("数字"), direction: grab("方位") },
  };
}

/**
 * 把宜/忌/幸运三段从正文里去掉。
 * 它们已经由上面的解析器抽取、在面板里单独呈现了，正文里再出现一遍就是重复。
 * 与八字那条"不要复述排盘数据"是同一个问题 —— 只是这里必须让模型先输出才能解析，
 * 所以只能在解析之后剥掉，而不是在 prompt 里禁止。
 */
export function stripStructuredSections(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^【(宜|忌|幸运指南)】/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
