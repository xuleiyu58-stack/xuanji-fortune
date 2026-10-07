/**
 * 订单状态判定。
 *
 * 纯函数、零 `next/*` 依赖 —— 因此能被 `node --test` 直接跑。
 *
 * ## 判定为什么住在这里，而不是住在路由里
 *
 * 路由文件为了拿到 `NextRequest`/`NextResponse` 必须 `import "next/server"`，
 * 而 next@14.2.35 的 package.json **没有 `exports` 字段** —— 裸 Node 的 ESM
 * 解析器解析不出 `node_modules/next/server`（`ERR_MODULE_NOT_FOUND`），
 * 加 loader 也救不了（loader 只补 `@/` 与相对路径）。
 * 所以**任何 import 路由文件的测试都跑不起来**，判定写在路由里就等于不可测。
 *
 * 这与仓库既有的分工一致：`lib/access.ts` 写「判定本身在 lib 里（纯函数、可单测）；
 * 路由只负责把凭证、计数、限额三样东西凑齐了交给它」。本模块是订单侧的同一件事，
 * 路由退成适配层：凑参数、调数据库、把结论翻译成 HTTP。
 */
import { PLANS, isPlanId, type Plan } from "@/lib/pricing";
import {
  EMPTY_ENTITLEMENT,
  grantMember,
  grantPass,
  type Entitlement,
} from "@/lib/entitlement";
import { MAX_PAYER_REF_LENGTH } from "@/lib/validation";
import type { OrderRow } from "@/lib/server/order-store";

/**
 * 判定过程中发现"数据本身不对"时抛它。
 *
 * 为什么错误要带 HTTP 状态码：这一类异常有两种性质，调用方该回什么码不一样 ——
 * 订单指向一个不存在的套餐是**请求方看得见的异常值**（400，用户去找客服），
 * 已交付却没有权益快照是**库被外部改过**（500，属于服务端故障）。
 * 混成一个"出错了"就等于让路由去猜，猜错的那次会把 500 报成"你的套餐不存在"。
 */
export class OrderFlowError extends Error {
  readonly http: number;

  constructor(message: string, http: number) {
    super(message);
    this.name = "OrderFlowError";
    this.http = http;
  }
}

export interface OrderStatusInput {
  order: OrderRow | null;
  deviceId: string | undefined;
  /** 请求里带的、已验签的权益；没有则为 null */
  carried: Entitlement | null;
  nowSec: number;
}

export type OrderStatusDecision =
  | { kind: "not_found" } // → 404
  | { kind: "unpaid"; status: string } // → 200，只回状态
  | { kind: "claim"; entitlement: Entitlement } // 抢占后签发这份
  | { kind: "delivered"; reissue: Entitlement | null }; // 已交付；reissue 非空才重签

/**
 * 按计划类型算交付后的权益。纯函数。
 *
 * 会员单走 `grantMember`（从现有到期时间往后接），单次单走 `grantPass`
 * （同模式的券叠加）。两个函数**都在内部过 `withTid()`**，所以输出的 `tid`
 * 一定有值 —— 服务端的消费台账按 `tid:下标:剩余次数` 记账，一份没有编号的
 * 权益写进 cookie，下次真去消费时台账认不出它是谁，要么被拒（"有额度却用不了"）
 * 要么键退化成所有券共用的 `undefined:0:1` 而把额度放光。
 *
 * `plan.mode ?? ""` 与路由侧同口径：`PLANS` 里 kind === "single" 的计划必有
 * mode（当前只有 bazi），这里的兜底只是类型上的收口。
 */
export function entitlementFor(
  plan: Plan,
  current: Entitlement,
  nowSec: number
): Entitlement {
  return plan.kind === "member"
    ? grantMember(current, plan.days, nowSec)
    : grantPass(current, plan.mode ?? "", 1, plan.days, nowSec);
}

/**
 * 订单已过期但钱已到账时也允许确认（见 `supabase/orders.sql` 的 `confirm_order`）。
 *
 * 对应 SQL 的 `where status in ('pending','expired')`：用户下了单、页面开着、
 * 半小时后才付款 —— 单已过期但钱真付了，允许确认"复活"它才不会丢单。
 * `paid` 不在其中：已经确认过的单重复确认会覆盖 `paid_at` 与 `confirmed_by`，
 * 对账时看不出哪一次才是真的。
 */
export function isConfirmable(status: string): boolean {
  return status === "pending" || status === "expired";
}

/**
 * 这次轮询该怎么处理。
 *
 * ## 六条分支与三个坑
 *
 * 1. 订单不存在、`deviceId` 缺失、或 `deviceId` 不匹配 → `not_found`。
 *    **调用方回 404、绝不回 403** —— 403 等于确认"这个订单号存在"，
 *    那就把接口变成了一台订单探测器。三种情况必须长得一模一样。
 * 2. `status !== "paid"` → `unpaid`，只把状态原样回给前端，不碰任何权益。
 * 3~5. **已交付**（`delivered_at` 非空）：
 *      · 请求**不带**权益凭证 → 用订单上存的快照重签（`reissue` 非空）。
 *        这一支修的是"响应在网络上丢了"：cookie 没落到浏览器里，
 *        而订单已标记交付 —— 不给重签，用户就是钱付了、什么都没有。
 *      · 请求**带着**凭证 → `reissue: null`，什么都不做。
 *        **这一条是安全阀**：带着 cookie 还重签，就等于把用户已经用掉的券复活
 *        （快照里记的是交付那一刻的次数，而用户可能已经消费过）。
 *        分不清"陈旧 cookie"与"刚消费过的 cookie"时，宁可不签。
 *      · 已交付却没有快照 → 抛错（调用方回 500）。`delivered_at` 与 `granted`
 *        由同一条 `UPDATE` 一起写（见 `claim_order_delivery`），不该只有一个。
 * 6. 已到账、未交付 → `claim`。
 *
 * ## 第 6 条为什么是"该尝试抢占"，而不是"抢占成功"
 *
 * 抢占（`delivered_at is null` → 写入）是**数据库的原子操作**，纯函数判不了它
 * 成不成功。所以第 6 条的语义是"该去抢"：调用方拿 `claimOrderDelivery` 去抢，
 * 抢到了才有权签发；返回 null 说明订单已被并发请求（双击、两个标签页）交付，
 * 此时**重读订单再判一次**，就会落在第 3/4 条的 `delivered` 分支上。
 * 重读是必须的 —— 抢不到时手里的那份行是抢占前的旧值，看不到别人写下的 `granted`。
 */
export function decideOrderStatus(input: OrderStatusInput): OrderStatusDecision {
  const { order, deviceId, carried, nowSec } = input;

  // 1. 不存在 / 没有设备号 / 设备不匹配 —— 一律按"不存在"处理，调用方统一回 404
  if (!order || !deviceId || order.deviceId !== deviceId) {
    return { kind: "not_found" };
  }

  // 2. 还没到账。pending 与 expired 都走这一支：过期单仍可能被人工确认复活
  //    （见 isConfirmable），状态该怎么报就怎么报，别替前端猜。
  if (order.status !== "paid") {
    return { kind: "unpaid", status: order.status };
  }

  // 3~5. 已交付。判据取 delivered_at，而不是 granted 是否为空：交付那一刻
  //      两者由同一条 UPDATE 一起写，所以正常数据里它们同进同出；以 delivered_at
  //      为准，则"已交付却缺快照"能被识别成数据异常，而不是被误当成未交付
  //      再抢一次（那会给同一张单签出第二份权益）。
  if (order.deliveredAt !== null) {
    if (carried) {
      // 带着凭证：什么都不动，理由见上面第 4 条
      return { kind: "delivered", reissue: null };
    }
    const snapshot = order.granted;
    if (snapshot === null || snapshot === undefined) {
      throw new OrderFlowError("权益发放异常，请联系客服并提供订单号", 500);
    }
    return { kind: "delivered", reissue: snapshot as Entitlement };
  }

  // 6. 未交付 → 该尝试抢占。权益以请求现有凭证为底叠加，不能覆盖
  if (!isPlanId(order.plan)) {
    throw new OrderFlowError("该订单对应的套餐已下线，请联系客服", 400);
  }
  return {
    kind: "claim",
    entitlement: entitlementFor(PLANS[order.plan], carried ?? EMPTY_ENTITLEMENT, nowSec),
  };
}

// ─────────────────────────────────────────────────────────────
// 交易单号（/api/order/claim）与兜底发码（/api/order/code）
//
// 这两条路由同样只能在 lib 里判 —— 理由与 decideOrderStatus 完全一样
// （路由 import 不了 `next/*`，见文件头）。判定分两半：
//   · **入参判定**：请求体够不够格，结论是"数据对不对"
//   · **目标判定**：这单该不该收单号 / 该不该发码，结论是"该不该做"
// 路由退成适配层：凑参数、调数据库、把结论翻成 HTTP。
// ─────────────────────────────────────────────────────────────

/**
 * 提交交易单号的入参判定。
 *
 * 单号必须是**非空**的：空串提交进库，对账时看到的是一行"提交过但什么都没写"的
 * 记录 —— 它比没提交更糟，因为它会让站长以为这笔单有凭证可查。
 */
export type ClaimInputDecision =
  | { kind: "invalid"; error: string }
  | { kind: "ok"; orderId: string; payerRef: string; provider: string | null };

export function decideClaimInput(body: unknown): ClaimInputDecision {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", error: "请求格式不正确" };
  }

  const raw = body as Record<string, unknown>;
  const orderId = typeof raw.orderId === "string" ? raw.orderId : "";
  const payerRef = typeof raw.payerRef === "string" ? raw.payerRef.trim() : "";
  const provider = typeof raw.provider === "string" ? raw.provider : null;

  if (!orderId) return { kind: "invalid", error: "缺少订单号" };
  if (!payerRef) return { kind: "invalid", error: "请填写交易单号" };
  if (payerRef.length > MAX_PAYER_REF_LENGTH) {
    return { kind: "invalid", error: "交易单号过长" };
  }
  // 渠道是可选的两个已知值。**刻意不校验单号本身** —— 个人收款码没有可查询的
  // 接口，服务端无从判断这串数字是不是真的，硬校验只会把真单号误杀。
  if (provider !== null && provider !== "alipay" && provider !== "wechat") {
    return { kind: "invalid", error: "付款渠道不正确" };
  }

  return { kind: "ok", orderId, payerRef, provider };
}

/** 取激活码的入参判定。只要求一个非空订单号。 */
export type CodeInputDecision =
  | { kind: "invalid"; error: string }
  | { kind: "ok"; orderId: string };

export function decideCodeInput(body: unknown): CodeInputDecision {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "invalid", error: "请求格式不正确" };
  }
  const orderId = (body as Record<string, unknown>).orderId;
  if (typeof orderId !== "string" || !orderId) {
    return { kind: "invalid", error: "缺少订单号" };
  }
  return { kind: "ok", orderId };
}

/**
 * 这单该不该收一份交易单号。
 *
 * **deviceId 缺失、订单不存在、设备不匹配一律 `not_found`** —— 三种情况必须长得
 * 一模一样，调用方统一回 404。回 403 等于确认"这个订单号存在"，那就把接口变成了
 * 一台订单探测器。
 *
 * 只有 `pending` 收：`paid` / `expired` 的单已经定了，再收一份单号
 * 只会覆盖掉先前那条对账锚点。
 *
 * 判定**不看钱、不发权益、不改状态** —— 提交不等于到账，那三件事都不在它的职责里。
 */
export type ClaimTargetDecision =
  | { kind: "not_found" }
  | { kind: "not_pending" }
  | { kind: "ok"; order: OrderRow };

export function decideClaimTarget(
  order: OrderRow | null,
  deviceId: string | undefined
): ClaimTargetDecision {
  if (!order || !deviceId || order.deviceId !== deviceId) return { kind: "not_found" };
  if (order.status !== "pending") return { kind: "not_pending" };
  return { kind: "ok", order };
}

/**
 * 这单该不该发一个激活码。
 *
 * 越权与不存在同样一律 `not_found`（回 404）。只有已到账（`paid`）的单能发码 ——
 * 发码是"把已到账的权益换个载体交付"，没到账就没有可交付的东西。
 *
 * `ok` 分支把套餐一并带出：发码时要按它决定 `kind` / `mode` / `days`，
 * 带出来省得路由再查一次、也省得在路由里再写一遍 `isPlanId` 的白名单。
 *
 * **它不检查 `deliveredAt`**（见 spec §13，刻意的取舍）：先自动到账、再取激活码
 * 会得到两份权益，堵它需要在目标判定里拒绝已交付的单，而那会同时堵死
 * 「电脑上已自动到账、现在想给手机也开一个」这种合理需求。
 */
export type CodeTargetDecision =
  | { kind: "not_found" }
  | { kind: "not_paid" }
  | { kind: "unknown_plan" }
  | { kind: "ok"; order: OrderRow; plan: Plan };

export function decideCodeTarget(
  order: OrderRow | null,
  deviceId: string | undefined
): CodeTargetDecision {
  if (!order || !deviceId || order.deviceId !== deviceId) return { kind: "not_found" };
  if (order.status !== "paid") return { kind: "not_paid" };
  // 库里的 plan 只可能由服务端从 PLANS 快照下来，所以这是个异常值，
  // 不是"用户的套餐下线了"这种能正常发生的事 —— 但两种都得回 400 让用户找客服。
  if (!isPlanId(order.plan)) return { kind: "unknown_plan" };
  return { kind: "ok", order, plan: PLANS[order.plan] };
}
