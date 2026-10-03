/**
 * 全站只做八字一个产品。
 *
 * 价格是 6.6，即付费模式 —— 所以**付费模式下的免费体验次数是整站唯一的
 * 转化杠杆**，它被单独提出来放在下面，不藏在判定逻辑里。
 */
export type Mode = "bazi";

/** 免费模式（price === 0）每日每设备可用次数。当前无免费模式，留作将来用。 */
export const FREE_DAILY_QUOTA = 3;

/** 每 IP 每日上限。比设备档宽，因为同一个 IP 后面可能坐着宿舍或整间公司。 */
export const FREE_IP_DAILY_LIMIT = 6;

/** 兑换接口按 IP 的每日尝试上限。80 bit 的码本就爆不了，这层防的是脚本噪声。 */
export const REDEEM_IP_DAILY_LIMIT = 10;

/** 单次通行证的有效天数。买的一次解读，不该永远躺在浏览器里。 */
export const SINGLE_PASS_DAYS = 7;

/**
 * 付费模式每日免费体验次数。
 *
 * **0 = 先激活后使用**（付了钱才解开），这是默认值，也是最保守的一个：
 * 它保证「付费模式」这四个字在服务端是真的。
 *
 * 改成 3 就变成「每天前 3 次免费看完整解读」——转化通常更好，但
 * 任何人都能每天白拿 3 份 ¥6.6 的解读。改这个数字之前先想清楚：
 * 这是在决定要不要把产品的一部分长期白送出去。
 *
 * 注意它同时是设备维度的上限；IP 维度仍受 FREE_IP_DAILY_LIMIT 约束，
 * 否则换一个设备 cookie 就能无限续杯。
 */
export const PAID_TRIAL_PER_DAY = 0;

/**
 * 体验额度在 IP 维度的上限。
 *
 * 必须**大于**设备上限，否则清一下 cookie 就等于无限体验 —— 设备 cookie
 * 是用户随手能删的，IP 不是。当前值为 0，与 PAID_TRIAL_PER_DAY 保持一致：
 * 没有体验额度时，IP 维度也不该开任何口子。
 */
export const PAID_TRIAL_IP_LIMIT = 0;

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

/**
 * 这个模式是不是免费的。
 *
 * 收 `string` 而不是 `Mode`：调用方（放行判定）拿到的是请求里的原始 mode 字符串，
 * 要求它先窄化就等于在每个入口各写一遍判断。未知 mode 一律按**付费**处理 ——
 * 这是安全的那一侧：认错的代价是多重一次校验，不是白送一次解读。
 */
export function isFreeMode(mode: string): boolean {
  return isMode(mode) && MODES[mode].price === 0;
}

export function formatPrice(value: number): string {
  return String(value);
}
