export const FREE_DAILY_QUOTA = 3;
export const FREE_IP_DAILY_LIMIT = 6;
/** 兑换接口按 IP 的每日尝试上限。80 bit 的码本就爆不了，这层防的是脚本噪声。 */
export const REDEEM_IP_DAILY_LIMIT = 10;
/** 单次通行证的有效天数。买的一次解读，不该永远躺在浏览器里。 */
export const SINGLE_PASS_DAYS = 7;

/** 全站只做八字一个产品。 */
export type Mode = "bazi";

export interface ModeInfo {
  title: string;
  /** 单位：元。0 表示免费模式。 */
  price: number;
}

// 刻意不放 icon 字段：图标语言是卦象爻线，在 components/Glyph.tsx 里。
// emoji 曾放在这里，一旦有了字段就会被顺手引回来。
export const MODES: Record<Mode, ModeInfo> = {
  bazi: { title: "八字命理", price: 6.6 },
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
