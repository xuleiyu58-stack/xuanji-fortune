/**
 * 真太阳时校正。
 *
 * 排盘用的是「钟表时间」，而真正决定时柱的是「太阳在当地天空的位置」。
 * 两者差两块：
 *
 *   1. **经度时差** —— 中国的钟表统一用东八区中央经线 120°E 的平太阳时。
 *      乌鲁木齐（87.6°E）与 120°E 差 32.4°，合 129.6 分钟。也就是说
 *      乌鲁木齐人钟表上的 10:00，当地太阳才刚到 7:50 的样子 —— 差了两个时辰。
 *   2. **均时差** —— 地球公转轨道是椭圆、且黄赤有交角，所以真太阳日长短不一，
 *      一年里在 −14 分到 +16 分之间摆动。
 *
 * 两块加起来，最极端的情况下能差到两个多时辰。时柱错了，整张盘就错了 ——
 * 这就是为什么真太阳时值得单独一个模块。
 *
 * 口径说明：是否做真太阳时校正，命理界有分歧。本站的做法是**由用户决定** ——
 * 填了出生地才校正，没填就按钟表时间排，并把两个结果都摆出来。
 */

const CHINA_STANDARD_MERIDIAN = 120; // 东八区中央经线
const MINUTES_PER_DEGREE = 4; // 地球每 4 分钟转 1°

/** 一年中的第几天，1 起算。 */
export function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1);
  const cur = Date.UTC(year, month - 1, day);
  return Math.round((cur - start) / 86400000) + 1;
}

/**
 * 均时差（分钟）。真太阳时减去平太阳时。
 *
 * 用通行的近似式：EoT ≈ 9.87·sin(2B) − 7.53·cos(B) − 1.5·sin(B)，B = 2π(N−81)/364。
 * 精度约 ±30 秒 —— 一个时辰跨两小时，这点误差不影响判柱，所以不引入更重的星历计算。
 * 极值：2 月中旬约 −14 分，11 月初约 +16 分。
 */
export function equationOfTimeMinutes(year: number, month: number, day: number): number {
  const n = dayOfYear(year, month, day);
  const b = (2 * Math.PI * (n - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * 真太阳时相对钟表时间的偏移（分钟）。正数表示真太阳时更快（钟表落后）。
 *
 * = 经度时差 + 均时差
 */
export function trueSolarOffsetMinutes(
  longitude: number,
  year: number,
  month: number,
  day: number
): number {
  const longitudeOffset = (longitude - CHINA_STANDARD_MERIDIAN) * MINUTES_PER_DEGREE;
  return longitudeOffset + equationOfTimeMinutes(year, month, day);
}

export interface TrueSolarResult {
  hour: number;
  minute: number;
  /** 偏移分钟数（四舍五入后） */
  offsetMinutes: number;
  /** 校正后跨了日期：−1 退一天，0 不变，+1 进一天 */
  dayShift: number;
  /** 校正后的时间是否落到了另一天 */
  crossedDay: boolean;
}

/**
 * 把钟表时间换算成真太阳时。
 *
 * 跨午夜时会返回 dayShift —— 调用方必须把它用到日期上，否则
 * 23:40 出生的乌鲁木齐人会算出错误的日柱（往前退一天，日柱就变了一个）。
 */
export function toTrueSolarTime(
  hour: number,
  minute: number,
  longitude: number,
  year: number,
  month: number,
  day: number
): TrueSolarResult {
  const rawOffset = trueSolarOffsetMinutes(longitude, year, month, day);
  const offsetMinutes = Math.round(rawOffset);

  let total = hour * 60 + minute + offsetMinutes;
  let dayShift = 0;
  while (total < 0) {
    total += 1440;
    dayShift -= 1;
  }
  while (total >= 1440) {
    total -= 1440;
    dayShift += 1;
  }

  return {
    hour: Math.floor(total / 60),
    minute: total % 60,
    offsetMinutes,
    dayShift,
    crossedDay: dayShift !== 0,
  };
}

/** `HH:MM`，用于界面显示。 */
export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * 把偏移量写成一句人话。
 * 让用户看得懂「为什么要给我减 40 分钟」，而不是不明不白地接受一个数字。
 */
export function describeOffset(offsetMinutes: number, placeName: string): string {
  const abs = Math.abs(offsetMinutes);
  if (abs < 1) return `${placeName}的经度接近东八区中央经线，真太阳时与钟表时间几乎一致。`;
  const dir = offsetMinutes > 0 ? "快" : "慢";
  return `按${placeName}的经度换算，当地真太阳时比钟表时间${dir}约 ${abs} 分钟。`;
}
