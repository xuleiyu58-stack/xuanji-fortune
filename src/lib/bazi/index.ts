/**
 * 八字排盘 —— 对外的唯一入口。
 *
 * **排盘是确定性计算，不该交给大模型去「心算」** —— 那是它最容易一本正经编错的地方。
 * 这里用 lunar-typescript 精确排历（节气、大运、藏干、旬空、十二长生），
 * 再由本目录下的各模块推导身强身弱、格局、神煞、合冲。AI 只负责解读排好的盘。
 *
 * 目录分工：
 *   constants.ts  干支五行、藏干、十二长生等基础表
 *   relations.ts  十神、合冲刑害
 *   strength.ts   身强身弱与用神喜忌
 *   pattern.ts    月令取格
 *   shensha.ts    神煞
 *   index.ts      本文件 —— 组装
 */

import { Solar } from "lunar-typescript";

import {
  HIDE_WEIGHTS, ZHI_HIDE_GAN, changShengOf,
  type ChangSheng, type ShiShen, type WuXing, type Zhi,
} from "./constants.ts";
import {
  SHI_SHEN_MEANING, branchRelations, shiShenOf, stemHarmonies, tripleHarmonies,
  type BranchPair, type StemPair, type TripleHarmony,
} from "./relations.ts";
import { analyzeStrength, type StrengthResult } from "./strength.ts";
import { analyzePattern, type PatternResult } from "./pattern.ts";
import { findShenSha, type ShenShaHit } from "./shensha.ts";

export type { WuXing, ShiShen, ChangSheng, Zhi } from "./constants.ts";
export { SHI_SHEN_MEANING } from "./relations.ts";
export { SHEN_SHA_CAVEAT } from "./shensha.ts";
export type { StrengthResult } from "./strength.ts";
export type { PatternResult } from "./pattern.ts";
export type { ShenShaHit, ShenShaTone } from "./shensha.ts";

const ELEMENT_ORDER: readonly WuXing[] = ["金", "木", "水", "火", "土"];

const GAN_ELEMENT: Record<string, WuXing> = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土",
  己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水",
};

const ZHI_ELEMENT: Record<string, WuXing> = {
  子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火",
  午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水",
};

/** 藏干在月支以外的柱里，本气/中气/余气各自的称法。 */
const HIDE_ROLE = ["本气", "中气", "余气"] as const;

export interface HiddenStem {
  gan: string;
  element: WuXing;
  shiShen: ShiShen;
  /** 本气 / 中气 / 余气 */
  role: string;
  /** 该藏干在五行计分里的分量 */
  weight: number;
}

export interface Pillar {
  label: string;
  gan: string;
  zhi: string;
  ganElement: WuXing;
  zhiElement: WuXing;
  /** 天干十神。日柱一栏是「日主」本身。 */
  shiShen: string;
  naYin: string;
  isDayMaster: boolean;
  /** 地支藏干，含各自十神 —— 很多判断恰恰看地支，只看天干是看不全的 */
  hidden: HiddenStem[];
  /** 旬空（空亡） */
  xunKong: string;
  /** 日干在这一柱地支上的十二长生 */
  diShi: ChangSheng | null;
}

export interface ElementTally {
  element: WuXing;
  /** 加权分值：天干计 1，地支藏干按本气 1 / 中气 0.5 / 余气 0.25 */
  value: number;
  percent: number;
}

export interface LiuNianStep {
  year: number;
  age: number;
  ganZhi: string;
}

export interface DaYunStep {
  ganZhi: string;
  startYear: number;
  endYear: number;
  startAge: number;
  /** 这一步大运里的十个流年 */
  liuNian: LiuNianStep[];
}

export interface ChartRelations {
  /** 地支六合 */
  he: BranchPair[];
  /** 地支相冲 */
  chong: BranchPair[];
  /** 三合 / 半合 */
  triple: TripleHarmony[];
  /** 天干五合 */
  ganHe: StemPair[];
}

export interface BaziChart {
  pillars: Pillar[];
  /** 日主天干，即「我」 */
  dayMaster: string;
  dayMasterElement: WuXing;
  zodiac: string;
  solarDate: string;
  lunarDate: string;
  /** 时辰（钟表时间），形如「巳时 09:00-11:00」 */
  birthTime: string;

  elements: ElementTally[];
  strongest: WuXing;
  weakest: WuXing;
  /** 全局未出现的五行 */
  missing: WuXing[];

  /** 身强身弱与用神喜忌 —— 整张盘最核心的结论 */
  strength: StrengthResult;
  /** 月令取格 */
  pattern: PatternResult | null;
  /** 神煞 */
  shenSha: ShenShaHit[];
  /** 合冲刑害 */
  relations: ChartRelations;

  /** 胎元、命宫、身宫 —— 传统上用来补看命局的三个点 */
  taiYuan: string;
  mingGong: string;
  shenGong: string;

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

function tally(pillars: Pillar[]): ElementTally[] {
  const acc: Record<WuXing, number> = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };

  for (const p of pillars) {
    acc[p.ganElement] += 1;
    for (const h of p.hidden) acc[h.element] += h.weight;
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

  const dayGan = ec.getDayGan();

  const raw = [
    { label: "年柱", gan: ec.getYearGan(), zhi: ec.getYearZhi(), shiShen: ec.getYearShiShenGan(), naYin: ec.getYearNaYin(), hides: ec.getYearHideGan(), kong: ec.getYearXunKong() },
    { label: "月柱", gan: ec.getMonthGan(), zhi: ec.getMonthZhi(), shiShen: ec.getMonthShiShenGan(), naYin: ec.getMonthNaYin(), hides: ec.getMonthHideGan(), kong: ec.getMonthXunKong() },
    { label: "日柱", gan: ec.getDayGan(), zhi: ec.getDayZhi(), shiShen: "日主", naYin: ec.getDayNaYin(), hides: ec.getDayHideGan(), kong: ec.getDayXunKong() },
    { label: "时柱", gan: ec.getTimeGan(), zhi: ec.getTimeZhi(), shiShen: ec.getTimeShiShenGan(), naYin: ec.getTimeNaYin(), hides: ec.getTimeHideGan(), kong: ec.getTimeXunKong() },
  ];

  const pillars: Pillar[] = raw.map((p) => {
    const isDayMaster = p.label === "日柱";
    // 藏干优先用库给的（它按节气与流派算过），缺失时退回本地表
    const hideGans = p.hides.length > 0 ? p.hides : [...(ZHI_HIDE_GAN[p.zhi] ?? [])];

    const hidden: HiddenStem[] = hideGans.map((gan, idx) => {
      const element = GAN_ELEMENT[gan] ?? "土";
      return {
        gan,
        element,
        // 日柱的藏干对日主本身也算十神 —— 日支是"我"所坐之地，同样要看
        shiShen: shiShenOf(dayGan, gan),
        role: HIDE_ROLE[idx] ?? "余气",
        weight: HIDE_WEIGHTS[idx] ?? 0.25,
      };
    });

    return {
      label: p.label,
      gan: p.gan,
      zhi: p.zhi,
      ganElement: GAN_ELEMENT[p.gan] ?? "土",
      zhiElement: ZHI_ELEMENT[p.zhi] ?? "土",
      shiShen: p.shiShen,
      naYin: p.naYin,
      isDayMaster,
      hidden,
      xunKong: p.kong,
      diShi: changShengOf(dayGan, p.zhi),
    };
  });

  const elements = tally(pillars);
  const present = elements.filter((e) => e.value > 0);
  const sorted = [...present].sort((a, b) => b.value - a.value);

  const zhiList = pillars.map((p) => p.zhi);
  const ganList = pillars.map((p) => p.gan);
  const relations: ChartRelations = {
    he: branchRelations(zhiList).filter((r) => r.kind === "六合"),
    chong: branchRelations(zhiList).filter((r) => r.kind === "相冲"),
    triple: tripleHarmonies(zhiList),
    ganHe: stemHarmonies(ganList),
  };

  const strengthInput = {
    dayGan,
    pillars: pillars.map((p) => ({ label: p.label, gan: p.gan, zhi: p.zhi })),
  };

  const yun = ec.getYun(input.gender === "男" ? 1 : 0);
  const daYun: DaYunStep[] = yun
    .getDaYun()
    .slice(1) // 第 0 步是起运前的本命，不展示
    .slice(0, 8)
    .map((d) => {
      const liuNian: LiuNianStep[] = d
        .getLiuNian(10)
        .map((n) => ({ year: n.getYear(), age: n.getAge(), ganZhi: n.getGanZhi() }));
      return {
        ganZhi: d.getGanZhi(),
        startYear: d.getStartYear(),
        endYear: d.getEndYear(),
        startAge: d.getStartAge(),
        liuNian,
      };
    });

  return {
    pillars,
    dayMaster: dayGan,
    dayMasterElement: GAN_ELEMENT[dayGan] ?? "土",
    zodiac: lunar.getYearShengXiao(),
    solarDate: `${year} 年 ${month} 月 ${day} 日`,
    lunarDate: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    birthTime: input.birthTime,

    elements,
    strongest: sorted[0]?.element ?? "土",
    weakest: sorted[sorted.length - 1]?.element ?? "土",
    missing: elements.filter((e) => e.value === 0).map((e) => e.element),

    strength: analyzeStrength(strengthInput),
    pattern: analyzePattern(strengthInput),
    shenSha: findShenSha(strengthInput),
    relations,

    taiYuan: ec.getTaiYuan(),
    mingGong: ec.getMingGong(),
    shenGong: ec.getShenGong(),

    startAgeText: `${yun.getStartYear()} 年 ${yun.getStartMonth()} 个月起运`,
    daYun,
  };
}

/** 把排好的盘压成一段文字，喂给模型做解读用 —— 它据此解读，不必自己推算。 */
export function chartToPrompt(chart: BaziChart): string {
  const pillars = chart.pillars
    .map((p) => {
      const hides = p.hidden.map((h) => `${h.gan}(${h.shiShen})`).join("、");
      return (
        `${p.label}：${p.gan}${p.zhi}（${p.ganElement}${p.zhiElement}，${p.naYin}，天干十神${p.shiShen}，` +
        `藏干${hides}，空亡${p.xunKong}，${p.diShi ?? "—"}）`
      );
    })
    .join("\n");

  const elements = chart.elements.map((e) => `${e.element} ${e.percent}%`).join("，");

  const rel: string[] = [];
  for (const r of chart.relations.he) rel.push(`${r.pair.join("")}六合化${r.element}`);
  for (const r of chart.relations.chong) rel.push(`${r.pair.join("")}相冲`);
  for (const t of chart.relations.triple) {
    rel.push(`${t.branches.join("")}${t.complete ? "三合" : "半合"}${t.element}局`);
  }
  for (const s of chart.relations.ganHe) rel.push(`${s.pair.join("")}合化${s.element}`);

  const shenSha = chart.shenSha.map((s) => `${s.name}（${s.position}${s.hitOn}）`).join("、");

  const currentYear = new Date().getFullYear();
  const daYun = chart.daYun
    .map((d) => {
      const cur = currentYear >= d.startYear && currentYear <= d.endYear ? "← 当前" : "";
      return `${d.ganZhi}（${d.startYear}-${d.endYear}，${d.startAge} 岁起）${cur}`;
    })
    .join("；");

  const currentDaYun = chart.daYun.find(
    (d) => currentYear >= d.startYear && currentYear <= d.endYear
  );
  const currentLiuNian = currentDaYun?.liuNian.find((n) => n.year === currentYear);

  return [
    `公历：${chart.solarDate}　${chart.birthTime}`,
    `农历：${chart.lunarDate}　生肖：${chart.zodiac}`,
    "四柱：",
    pillars,
    `日主：${chart.dayMaster}（${chart.dayMasterElement}）`,
    `五行分布：${elements}`,
    chart.missing.length ? `全局缺：${chart.missing.join("、")}` : "五行俱全",
    `日主强弱：${chart.strength.summary}`,
    chart.pattern ? `格局：${chart.pattern.name} —— ${chart.pattern.note}` : "格局：未能取格",
    rel.length ? `干支关系：${rel.join("，")}` : "干支之间无合冲",
    shenSha ? `神煞：${shenSha}` : "无显著神煞",
    `胎元${chart.taiYuan}　命宫${chart.mingGong}　身宫${chart.shenGong}`,
    `起运：${chart.startAgeText}`,
    `大运：${daYun}`,
    currentLiuNian
      ? `当前流年：${currentLiuNian.year} 年 ${currentLiuNian.ganZhi}（${currentLiuNian.age} 岁）`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
