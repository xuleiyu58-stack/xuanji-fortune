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

import { Lunar, Solar } from "lunar-typescript";

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
import { formatClock, standardTimeFor, toTrueSolarTime } from "./solar-time.ts";
import { isApproximate, longitudeOf, longitudeOfCity, regions } from "./places.ts";

export type { WuXing, ShiShen, ChangSheng, Zhi } from "./constants.ts";
export { SHI_SHEN_MEANING } from "./relations.ts";
export { SHEN_SHA_CAVEAT } from "./shensha.ts";
export { PALACE_MEANING } from "./constants.ts";
export { YONG_SHEN_METHOD, groupPower } from "./strength.ts";
export { HISTORICAL_ZONES, standardTimeFor } from "./solar-time.ts";
export type { StrengthResult } from "./strength.ts";
export type { PatternResult } from "./pattern.ts";
export type { ShenShaHit, ShenShaTone } from "./shensha.ts";
export {
  PROVINCE_NAMES, citiesOf, countiesOf, longitudeOfCity, isApproximate, longitudeOf,
} from "./places.ts";
export { describeOffset } from "./solar-time.ts";

const ELEMENT_ORDER: readonly WuXing[] = ["金", "木", "水", "火", "土"];

/**
 * 把用户填的省市还原成区划表里的**规范名称**。
 *
 * 为什么不直接用原值拼接：`birthPlace` 会经 chartToPrompt 进入喂给模型的
 * 「已由程序精确排定」那一段。用原值等于把用户可控的任意文本（最长 200 字）
 * 塞进模型最信任的区域 —— 而省名并不参与经度计算（经度只认市名），
 * 所以「省名填一段指令 + 市名填一个真实城市」是能走通的注入路径。
 *
 * 只有能在表里找到的省/市才写进去；找不到的（老数据、简称、写错的字）留空，
 * 宁可少一行说明，也不把未经验证的文本当命盘数据。
 */
function canonicalPlaceName(
  province: string | undefined,
  city: string | undefined
): string | undefined {
  const provinceInput = province?.trim();
  const cityInput = city?.trim();

  // 一次遍历同时定位省与市：只认表中真实存在的名字，原值一律不回填
  for (const p of regions) {
    if (provinceInput && p.n !== provinceInput) continue;
    const hit = cityInput ? p.c.find((c) => c.n === cityInput) : undefined;
    if (hit) return `${p.n} ${hit.n}`;
  }

  // 市名精确匹配不上时不动它 —— 这一步只做净化，不做猜测。
  // 经度解析另有更宽松的兜底（见 longitudeOf），那条路不影响这里。
  return undefined;
}

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

export interface LiuYueStep {
  /** 月名，如「正月」 */
  month: string;
  ganZhi: string;
}

export interface LiuNianStep {
  year: number;
  age: number;
  ganZhi: string;
  /**
   * 该年的十二个流月。**只给当年那一个流年带上** ——
   * 八步大运各带十年、每年再带十二月，全塞进响应就是近千条，
   * 而用户真正会看的通常只有眼下这一年。想看别的年份，换一年再排即可。
   */
  liuYue?: LiuYueStep[];
}

export interface XiaoYunStep {
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
  /** 与流年并列的「小运」，同样十年 */
  xiaoYun: XiaoYunStep[];
}

export interface ChartRelations {
  /** 地支六合 */
  he: BranchPair[];
  /** 地支相冲 */
  chong: BranchPair[];
  /** 地支相刑与自刑 */
  xing: BranchPair[];
  /** 地支相害 */
  hai: BranchPair[];
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

  // ── 出生信息与时间校正 ──────────────────────────────
  /** 输入的历法 */
  calendar: Calendar;
  /** 钟表时间（用户填的那个），`HH:MM` */
  clockTime: string;
  /** 真太阳时。未填出生地、或该地不在经度表里时为 undefined */
  trueSolarTime?: string;
  /** 真太阳时相对钟表时间的偏移（分钟） */
  solarOffsetMinutes?: number;
  /** 出生地，形如「新疆维吾尔自治区 巴音郭楞蒙古自治州」 */
  birthPlace?: string;
  /** 该市经度是省内中位数估值而非实测（界面上要如实标出） */
  birthPlaceApproximate?: boolean;
  /** 出生时钟表实际依据的时区名。1949 年后统一北京时间，则为 undefined */
  standardTimeZone?: string;
  /** 校正后的时间是否落到了另一天 —— 会影响日柱，必须在界面上讲明白 */
  trueSolarCrossedDay?: boolean;
  /** 跨日时，排盘实际所用的日期（与上报的生日不同，界面需并列显示） */
  chartDateText?: string;
}

export type Calendar = "solar" | "lunar";

export interface BaziInput {
  /**
   * 阳历时为公历 `YYYY-MM-DD`；农历时为农历 `YYYY-MM-DD`，月份填 1-12。
   * 闰月用 `lunarLeap` 单独表达，不塞进日期串 —— 日期串里写不下这个信息。
   */
  birthDate: string;
  /** 形如「巳时 09:00-11:00」，或直接是 `HH:MM` */
  birthTime: string;
  gender: string;
  /** 历法，默认阳历 */
  calendar?: Calendar;
  /** 该农历月是否为闰月 */
  lunarLeap?: boolean;
  /** 出生地：省与市（见 regions.ts）。填了才做真太阳时校正。 */
  province?: string;
  city?: string;
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

/**
 * 校验农历日期是否真实存在，返回 null 表示合法，否则返回一句人话。
 *
 * lunar-typescript 对不存在的闰月、超出的日数都会抛错，但报的是英文
 * （"wrong lunar year 2023 month -3" / "only 29 days in lunar year 2023 month -2"）。
 * 直接透给用户等于没报错，所以在这里翻译。
 *
 * 表单那边拿不到库（lunar-typescript 必须留在服务端），所以它做不了这层校验 ——
 * 用户可能勾了「闰月」但那年并没有，或选了「三十」但当月只有二十九天。
 */
export function validateLunarDate(
  year: number,
  month: number,
  day: number,
  leap: boolean
): string | null {
  try {
    Lunar.fromYmdHms(year, leap ? -month : month, day, 12, 0, 0);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("wrong lunar year")) {
      return leap
        ? `农历 ${year} 年没有闰${month}月。请核对年份，或取消勾选「闰月」。`
        : `农历 ${year} 年没有 ${month} 月，请核对年份。`;
    }
    const days = /only (\d+) days/.exec(msg);
    if (days) {
      return `农历${leap ? "闰" : ""}${month}月只有 ${days[1]} 天，请重新选择日期。`;
    }
    return "这个农历日期不存在，请核对后重试。";
  }
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

  const calendar: Calendar = input.calendar === "lunar" ? "lunar" : "solar";

  // ── 第一步：把用户填的日期换算成公历 ──
  // 排盘库只认公历。农历的闰月用**负数月份**表达（lunar-typescript 的口径：
  // 农历 2023 年闰二月 = fromYmd(2023, -2, 1)），所以不能塞进日期串，单独一个字段。
  let gy = year;
  let gm = month;
  let gd = day;
  if (calendar === "lunar") {
    // 非法农历日期（不存在的闰月、超出的日数）库会抛错 —— 这里兜住返回 null，
    // 而不是让异常冒到路由变成 500。用户看到的应当是"日期不对"，不是"服务器出错"。
    try {
      const asLunar = Lunar.fromYmdHms(
        year,
        input.lunarLeap ? -month : month,
        day,
        time.hour,
        time.minute,
        0
      );
      const asSolar = asLunar.getSolar();
      gy = asSolar.getYear();
      gm = asSolar.getMonth();
      gd = asSolar.getDay();
    } catch {
      return null;
    }
  }

  // 用户报的那个日期 —— 也就是他身份证上的生日。校正跨日时，它和排盘用的日期会不同，
  // 两笔都要留着，否则用户会觉得我们把他的生日算错了。
  const birthYmd = { y: gy, m: gm, d: gd };

  // ── 第二步：真太阳时校正 ──
  // 校正作用在公历日期上（那才是"当地钟表读到的日期"）。
  // 跨日时必须把日期一并退/进一天 —— 否则 00:30 出生的乌鲁木齐人日柱会整整错一天。
  let hour = time.hour;
  let minute = time.minute;
  let trueSolarTime: string | undefined;
  let solarOffsetMinutes: number | undefined;
  let trueSolarCrossedDay: boolean | undefined;
  /** 民国时期出生的人，钟表走的可能不是东八区 —— 用了哪个要如实记下来 */
  let usedZoneName: string | undefined;

  // 优先按「省 + 市」查（跨省重名时才不会取错）；只有市名时退回按市名查
  const longitude = longitudeOfCity(input.province, input.city) ?? longitudeOf(input.city);
  if (longitude !== undefined) {
    // 1949 年前中国分五个时区，钟表走的未必是东八区 —— 按经度取当年实际用的那个
    const zone = standardTimeFor(longitude, gy);
    const r = toTrueSolarTime(time.hour, time.minute, longitude, gy, gm, gd, zone.offsetHours);
    usedZoneName = zone.offsetHours === 8 ? undefined : zone.name;
    hour = r.hour;
    minute = r.minute;
    trueSolarTime = formatClock(r.hour, r.minute);
    solarOffsetMinutes = r.offsetMinutes;
    trueSolarCrossedDay = r.crossedDay;
    if (r.dayShift !== 0) {
      const shifted = new Date(Date.UTC(gy, gm - 1, gd + r.dayShift));
      gy = shifted.getUTCFullYear();
      gm = shifted.getUTCMonth() + 1;
      gd = shifted.getUTCDate();
    }
  }

  const solar = Solar.fromYmdHms(gy, gm, gd, hour, minute, 0);
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
  const branchRels = branchRelations(zhiList);
  const relations: ChartRelations = {
    he: branchRels.filter((r) => r.kind === "六合"),
    chong: branchRels.filter((r) => r.kind === "相冲"),
    xing: branchRels.filter((r) => r.kind === "相刑" || r.kind === "自刑"),
    hai: branchRels.filter((r) => r.kind === "相害"),
    triple: tripleHarmonies(zhiList),
    ganHe: stemHarmonies(ganList),
  };

  const strengthInput = {
    dayGan,
    pillars: pillars.map((p) => ({ label: p.label, gan: p.gan, zhi: p.zhi })),
  };

  const currentYear = new Date().getFullYear();
  const yun = ec.getYun(input.gender === "男" ? 1 : 0);
  const daYun: DaYunStep[] = yun
    .getDaYun()
    .slice(1) // 第 0 步是起运前的本命，不展示
    .slice(0, 8)
    .map((d) => {
      const liuNian: LiuNianStep[] = d.getLiuNian(10).map((n) => {
        const base: LiuNianStep = { year: n.getYear(), age: n.getAge(), ganZhi: n.getGanZhi() };
        // 只给当年那一个流年配流月，理由见 LiuNianStep 的注释
        if (base.year === currentYear) {
          base.liuYue = n.getLiuYue().map((m) => ({
            month: m.getMonthInChinese(),
            ganZhi: m.getGanZhi(),
          }));
        }
        return base;
      });

      const xiaoYun: XiaoYunStep[] = d.getXiaoYun(10).map((x) => ({
        year: x.getYear(),
        age: x.getAge(),
        ganZhi: x.getGanZhi(),
      }));

      return {
        ganZhi: d.getGanZhi(),
        startYear: d.getStartYear(),
        endYear: d.getEndYear(),
        startAge: d.getStartAge(),
        liuNian,
        xiaoYun,
      };
    });

  // 展示用的农历日期，取「用户报的那个生日」而非排盘日 —— 校正跨日时两者会差一天
  const birthLunar = Solar.fromYmd(birthYmd.y, birthYmd.m, birthYmd.d).getLunar();
  const crossedToText =
    trueSolarCrossedDay === true ? `${gy} 年 ${gm} 月 ${gd} 日` : undefined;

  return {
    pillars,
    dayMaster: dayGan,
    dayMasterElement: GAN_ELEMENT[dayGan] ?? "土",
    zodiac: birthLunar.getYearShengXiao(),
    solarDate: `${birthYmd.y} 年 ${birthYmd.m} 月 ${birthYmd.d} 日`,
    lunarDate: `${birthLunar.getYearInChinese()}年${birthLunar.getMonthInChinese()}月${birthLunar.getDayInChinese()}`,
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

    calendar,
    clockTime: formatClock(time.hour, time.minute),
    trueSolarTime,
    solarOffsetMinutes,
    birthPlace:
      longitude !== undefined
        ? canonicalPlaceName(input.province, input.city)
        : undefined,
    birthPlaceApproximate: longitude !== undefined ? isApproximate(input.city) : undefined,
    standardTimeZone: usedZoneName,
    trueSolarCrossedDay,
    chartDateText: crossedToText,
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
  for (const r of chart.relations.xing) {
    rel.push(r.kind === "自刑" ? `${r.pair[0]}${r.pair[1]}自刑` : `${r.pair.join("")}相刑`);
  }
  for (const r of chart.relations.hai) rel.push(`${r.pair.join("")}相害`);
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

  const timeLine =
    chart.trueSolarTime !== undefined
      ? `钟表时间 ${chart.clockTime} → 按${chart.birthPlace}换算真太阳时 ${chart.trueSolarTime}（差 ${chart.solarOffsetMinutes} 分钟）` +
        (chart.chartDateText ? `，校正后跨日，四柱按 ${chart.chartDateText} 排定` : "")
      : `钟表时间 ${chart.clockTime}（未填出生地，未作真太阳时校正）`;

  return [
    `公历：${chart.solarDate}`,
    `农历：${chart.lunarDate}　生肖：${chart.zodiac}`,
    `出生时间：${timeLine}`,
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
    `十神力量排行（由强到弱）：${chart.strength.groupPower.map((g) => `${g.group} ${g.percent}%`).join("，")}`,
    `起运：${chart.startAgeText}`,
    `大运：${daYun}`,
    currentLiuNian
      ? `当前流年：${currentLiuNian.year} 年 ${currentLiuNian.ganZhi}（${currentLiuNian.age} 岁）`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
