export const FREE_DAILY_QUOTA = 3;
export const FREE_IP_DAILY_LIMIT = 6;
/** 兑换接口按 IP 的每日尝试上限。80 bit 的码本就爆不了，这层防的是脚本噪声。 */
export const REDEEM_IP_DAILY_LIMIT = 10;
/** 单次通行证的有效天数。¥3.8 买的一次，不该永远躺在浏览器里。 */
export const SINGLE_PASS_DAYS = 7;

export type Mode = "daily" | "oracle" | "bazi" | "tarot" | "love";

export interface ModeInfo {
  title: string;
  /** 单位：元。0 表示免费模式。 */
  price: number;
}

// 刻意不放 icon 字段：模式的图形是卦象爻线，由 components/Glyph.tsx 的
// MODE_TRIGRAM 提供。emoji 曾放在这里，会被顺手再引回来。
export const MODES: Record<Mode, ModeInfo> = {
  daily: { title: "今日运势", price: 0 },
  oracle: { title: "灵签求签", price: 0 },
  bazi: { title: "八字命理", price: 6.6 },
  tarot: { title: "AI 塔罗", price: 3.8 },
  love: { title: "姻缘配对", price: 8.8 },
};

export interface MemberPlan {
  id: string;
  name: string;
  price: number;
  days: number;
}

export const MEMBER_PLANS: ReadonlyArray<MemberPlan> = [
  { id: "member_month", name: "月卡", price: 9.9, days: 30 },
  { id: "member_year", name: "年卡", price: 69, days: 365 },
];

export function isMode(value: string): value is Mode {
  return Object.prototype.hasOwnProperty.call(MODES, value);
}

export function getModePrice(mode: Mode): number {
  return MODES[mode].price;
}

export function isFreeMode(mode: Mode): boolean {
  return MODES[mode].price === 0;
}

export function formatPrice(value: number): string {
  return String(value);
}
