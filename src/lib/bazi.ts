/**
 * 八字排盘。
 *
 * 排盘是确定性计算，不该交给大模型去"心算" —— 那是它最容易一本正经编错的地方。
 * 这里用 lunar-typescript 精确排盘（节气、大运、藏干），AI 只负责解读已排好的盘。
 *
 * 刻意只依赖 npm 包、不 import 项目内模块：测试用 node --test 直接跑这个文件，
 * 相对导入需要显式 .ts 扩展名，跨模块会平添麻烦。
 */

import { Solar } from "lunar-typescript";

export type WuXing = "金" | "木" | "水" | "火" | "土";

const ELEMENT_ORDER: readonly WuXing[] = ["金", "木", "水", "火", "土"];

const GAN_ELEMENT: Record<string, WuXing> = {
  甲: "木", 乙: "木",
  丙: "火", 丁: "火",
  戊: "土", 己: "土",
  庚: "金", 辛: "金",
  壬: "水", 癸: "水",
};

const ZHI_ELEMENT: Record<string, WuXing> = {
  子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火",
  午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水",
};

/** 地支藏干的分量：本气 / 中气 / 余气 */
const HIDE_WEIGHTS: readonly number[] = [1, 0.5, 0.25];

export interface Pillar {
  label: string;
  gan: string;
  zhi: string;
  ganElement: WuXing;
  zhiElement: WuXing;
  /** 十神。日柱一栏是「日主」本身。 */
  shiShen: string;
  naYin: string;
  isDayMaster: boolean;
}

export interface ElementTally {
  element: WuXing;
  /** 加权分值：天干计 1，地支藏干按本气 1 / 中气 0.5 / 余气 0.25 */
  value: number;
  percent: number;
}

export interface DaYunStep {
  ganZhi: string;
  startYear: number;
  endYear: number;
  startAge: number;
}

export interface BaziChart {
  pillars: Pillar[];
  /** 日主天干，即「我」 */
  dayMaster: string;
  dayMasterElement: WuXing;
  zodiac: string;
  solarDate: string;
  lunarDate: string;
  elements: ElementTally[];
  strongest: WuXing;
  weakest: WuXing;
  /** 全局未出现的五行 */
  missing: WuXing[];
  startAgeText: string;
  daYun: DaYunStep[];
}

export interface BaziInput {
  /** `YYYY-MM-DD` */
  birthDate: string;
  /** 形如「巳时 09:00-11:00」，或直接是 `HH:MM` */
  birthTime: string;
  gender: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 从时辰选项里取出代表时刻。
 * 子时横跨午夜，取区间起点（23:00），即晚子时的口径。
 */
export function parseHourMinute(birthTime: string): { hour: number; minute: number } | null {
  const m = birthTime.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function tally(pillars: Pillar[], hideGanPerPillar: string[][]): ElementTally[] {
  const acc: Record<WuXing, number> = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };

  for (let i = 0; i < pillars.length; i++) {
    acc[pillars[i].ganElement] += 1;
    const hides = hideGanPerPillar[i] ?? [];
    hides.forEach((gan, idx) => {
      const element = GAN_ELEMENT[gan];
      if (element) acc[element] += HIDE_WEIGHTS[idx] ?? 0.25;
    });
  }

  const total = ELEMENT_ORDER.reduce((sum, e) => sum + acc[e], 0) || 1;

  return ELEMENT_ORDER.map((element) => ({
    element,
    value: round1(acc[element]),
    percent: Math.round((acc[element] / total) * 100),
  }));
}

export function buildBaziChart(input: BaziInput): BaziChart | null {
  const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.birthDate.trim());
  if (!dateMatch) return null;

  const time = parseHourMinute(input.birthTime);
  if (!time) return null;

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  if (year < 1900 || year > 2100) return null;

  const solar = Solar.fromYmdHms(year, month, day, time.hour, time.minute, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();

  const raw: Array<{ label: string; gan: string; zhi: string; shiShen: string; naYin: string }> = [
    { label: "年柱", gan: ec.getYearGan(), zhi: ec.getYearZhi(), shiShen: ec.getYearShiShenGan(), naYin: ec.getYearNaYin() },
    { label: "月柱", gan: ec.getMonthGan(), zhi: ec.getMonthZhi(), shiShen: ec.getMonthShiShenGan(), naYin: ec.getMonthNaYin() },
    { label: "日柱", gan: ec.getDayGan(), zhi: ec.getDayZhi(), shiShen: "日主", naYin: ec.getDayNaYin() },
    { label: "时柱", gan: ec.getTimeGan(), zhi: ec.getTimeZhi(), shiShen: ec.getTimeShiShenGan(), naYin: ec.getTimeNaYin() },
  ];

  const pillars: Pillar[] = raw.map((p) => ({
    ...p,
    ganElement: GAN_ELEMENT[p.gan],
    zhiElement: ZHI_ELEMENT[p.zhi],
    isDayMaster: p.label === "日柱",
  }));

  const hideGanPerPillar = [
    ec.getYearHideGan(),
    ec.getMonthHideGan(),
    ec.getDayHideGan(),
    ec.getTimeHideGan(),
  ];

  const elements = tally(pillars, hideGanPerPillar);
  const present = elements.filter((e) => e.value > 0);
  const sorted = [...present].sort((a, b) => b.value - a.value);

  const yun = ec.getYun(input.gender === "男" ? 1 : 0);
  const daYun: DaYunStep[] = yun
    .getDaYun()
    .slice(1) // 第 0 步是起运前的本命，不展示
    .slice(0, 8)
    .map((d) => ({
      ganZhi: d.getGanZhi(),
      startYear: d.getStartYear(),
      endYear: d.getEndYear(),
      startAge: d.getStartAge(),
    }));

  return {
    pillars,
    dayMaster: ec.getDayGan(),
    dayMasterElement: GAN_ELEMENT[ec.getDayGan()],
    zodiac: lunar.getYearShengXiao(),
    solarDate: `${year} 年 ${month} 月 ${day} 日`,
    lunarDate: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    elements,
    strongest: sorted[0]?.element ?? "土",
    weakest: sorted[sorted.length - 1]?.element ?? "土",
    missing: elements.filter((e) => e.value === 0).map((e) => e.element),
    startAgeText: `${yun.getStartYear()} 年 ${yun.getStartMonth()} 个月起运`,
    daYun,
  };
}

/** 把排好的盘压成一段文字，喂给模型做解读用 —— 它据此解读，不必自己推算。 */
export function chartToPrompt(chart: BaziChart): string {
  const pillars = chart.pillars.map((p) => `${p.label}：${p.gan}${p.zhi}（${p.ganElement}${p.zhiElement}，${p.naYin}，十神${p.shiShen}）`).join("\n");
  const elements = chart.elements.map((e) => `${e.element} ${e.percent}%`).join("，");
  const daYun = chart.daYun.map((d) => `${d.ganZhi}（${d.startYear}-${d.endYear}，${d.startAge} 岁起）`).join("；");

  return [
    `公历：${chart.solarDate}`,
    `农历：${chart.lunarDate}　生肖：${chart.zodiac}`,
    "四柱：",
    pillars,
    `日主：${chart.dayMaster}（${chart.dayMasterElement}）`,
    `五行分布：${elements}`,
    chart.missing.length ? `全局缺：${chart.missing.join("、")}` : "五行俱全",
    `起运：${chart.startAgeText}`,
    `大运：${daYun}`,
  ].join("\n");
}
