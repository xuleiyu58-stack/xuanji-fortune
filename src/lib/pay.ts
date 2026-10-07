/**
 * 支付接缝。
 *
 * 当前实现是**方案 A（零资质）**：站长的个人收款码 + 人工确认到账。
 * 命理类过不了 ICP 备案、也开不了官方支付商户号，所以没有回调能力 ——
 * 这是资质问题，不是代码问题。
 *
 * 这里刻意保留一个联合类型而不是直接返回收款码列表：等拿到聚合支付资质时，
 * 改的是本文件加弹窗里一个 case，订单表、状态机、路由、权益签发全都不用动。
 * 不留这个缝，那时就得把整个订单流程再拆一遍。
 */
import { PLANS, type PlanId } from "@/lib/pricing";

export interface PayChannel {
  id: "alipay" | "wechat";
  label: string;
  qrSrc: string;
}

export type PayInstruction =
  | { kind: "qr"; amount: number; channels: PayChannel[] }
  | { kind: "redirect"; amount: number; url: string };

/**
 * 启用的收款渠道。**当前只做微信**（用户 2026-10-07 决定不做支付宝）。
 *
 * 用数组而不是单个值：渠道集合已经被改过一次（设计时两个、实现时一个），
 * 说明它易变。加回支付宝只是往这里补一行，类型与 UI 都不用动。
 */
const PROVIDERS: { id: PayChannel["id"]; label: string }[] = [
  { id: "wechat", label: "微信" },
];

/**
 * 收款码图片路径。
 *
 * 两位小数是必须的：金额直接参与拼路径，`69` 与 `69.00` 会指向两张不同的图，
 * 而只有一张存在 —— 表现是年卡的收款码裂图，月卡的正常，很难从现象反推。
 *
 * 每价位一张图，是因为微信收款码**可以**设固定金额，扫码后金额已填好。
 * 这也意味着改价必须同时重做图片：图片上的金额是物理的、改不了。
 * 改价后 `qrSrcFor` 会去找一张不存在的图 → 弹窗显示「暂未就绪」。
 * 宁可显示未就绪，也不要出现「页面标 6.6、扫码付出 6.9」。
 */
export function qrSrcFor(provider: string, amount: number): string {
  return `/pay/${provider}-${amount.toFixed(2)}.png`;
}

export function payInstructionFor(planId: PlanId): PayInstruction {
  const plan = PLANS[planId];
  return {
    kind: "qr",
    amount: plan.price,
    channels: PROVIDERS.map((p) => ({ ...p, qrSrc: qrSrcFor(p.id, plan.price) })),
  };
}
