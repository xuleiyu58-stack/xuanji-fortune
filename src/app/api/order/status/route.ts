import { NextRequest, NextResponse } from "next/server";
import type { OrderRow } from "@/lib/server/order-store";
import { claimOrderDelivery, getOrder } from "@/lib/server/order-store";
import { DEVICE_COOKIE } from "@/lib/server/quota-guard";
import { toSummary } from "@/lib/entitlement";
import { OrderFlowError, decideOrderStatus } from "@/lib/order-flow";
import { nowSec, readEntitlement, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";
import { putDeviceEntitlement } from "@/lib/server/account-store";

/**
 * 轮询订单状态；订单已到账且是本设备下的，就地签发权益。
 *
 * 这是全站第二个"把付款变成权限"的入口（另一个是 /api/redeem）。
 * 收尾逻辑刻意与 redeem 路由保持一致：读现有凭证 → 按计划类型签发 →
 * 写回 cookie。差别只在"凭什么给"——那边凭一个原子核销的激活码，
 * 这边凭一个原子抢占的订单交付权。
 *
 * **本文件只是适配层。** 该不该给、该抢还是该重签，全在 lib/order-flow.ts 里判；
 * 那边是纯函数、零 next/* 依赖，能被 node --test 直接跑；这边 import 了
 * next/server，裸 node 连模块都解析不出来（next 没有 exports 字段），
 * 所以判定写在路由里就等于不可测。
 */

export const runtime = "nodejs";

const NOT_FOUND = "订单不存在";
const UNAVAILABLE = "服务暂时不可用，请稍后再试";
const GRANT_BROKEN = "权益发放异常，请联系客服并提供订单号";

/** 判定抛出的异常自带状态码；其余（读库失败之类）一律按服务端故障回 503。 */
function flowErrorResponse(err: unknown, orderId: string): NextResponse {
  if (err instanceof OrderFlowError) {
    console.error(`[order/status] 订单 ${orderId}: ${err.message}`);
    return NextResponse.json({ success: false, error: err.message }, { status: err.http });
  }
  console.error("轮询订单失败:", err);
  return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "缺少订单号" }, { status: 400 });
  }

  const secret = passSecret();
  if (!secret) {
    console.error("[order/status] 未配置 PASS_SECRET，无法签发权益凭证");
    return NextResponse.json(
      { success: false, error: "服务尚未配置完成，请稍后再试" },
      { status: 503 }
    );
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    // 没有设备号就不可能有人下过单。回 404 而不是 403 ——
    // 403 等于确认"这个订单号存在"，那就成了订单探测器。
    // （早退只是为了省一次读库；判定的同一结论见 order-flow 的分支 1。）
    return NextResponse.json({ success: false, error: NOT_FOUND }, { status: 404 });
  }

  let order: OrderRow | null;
  try {
    order = await getOrder(id);
  } catch (err) {
    console.error("读取订单失败:", err);
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
  }

  const now = nowSec();
  const carried = readEntitlement(req);

  // 第一次判定：可能是 not_found / unpaid / delivered（已交付）/ claim（该去抢）
  let decision;
  try {
    decision = decideOrderStatus({ order, deviceId, carried, nowSec: now });
  } catch (err) {
    return flowErrorResponse(err, id);
  }

  if (decision.kind === "not_found") {
    // 设备不匹配也走这里：不能区分"不存在"与"不是你的"。
    return NextResponse.json({ success: false, error: NOT_FOUND }, { status: 404 });
  }

  if (decision.kind === "unpaid") {
    return NextResponse.json({ success: true, status: decision.status });
  }

  if (decision.kind === "claim") {
    // 抢占是数据库的原子操作：并发双击 / 两个标签页时，只有拿到行的请求有权签发。
    let claimed: OrderRow | null;
    try {
      claimed = await claimOrderDelivery(order!.id, deviceId, decision.entitlement);
    } catch (err) {
      console.error("抢占交付权失败:", err);
      return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
    }

    if (claimed) {
      // 抢占成功：本次由我签发。
      //
      // 镜像一份到设备维度，供日后登录时认领进账户（见 supabase/accounts.sql）。
      // 写镜像失败**不影响本次开通** —— cookie 马上就写下去了，权益立刻可用；
      // 镜像只影响"以后能不能把它迁到账户上"，那是次要且可重试的事。
      const next = decision.entitlement;
      try {
        await putDeviceEntitlement(deviceId, next);
      } catch (err) {
        console.error("写入设备权益镜像失败（不影响本次开通）:", err);
      }
      const res = NextResponse.json({
        success: true,
        status: "paid",
        entitlement: toSummary(next, now),
      });
      return withPassCookie(res, next, secret);
    }

    // 抢占失败 = 本单已经被另外一次请求交付过（双击、两个标签页，或本页上一次的
    // 响应丢了）。**必须重读订单**：手里这份是抢占前的旧值，看不到赢家写下的
    // delivered_at 与 granted 快照，重判就会又判成"该去抢"，无限空转。
    let fresh: OrderRow | null;
    try {
      fresh = await getOrder(order!.id);
    } catch (err) {
      console.error("重读订单失败:", err);
      return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
    }

    try {
      decision = decideOrderStatus({ order: fresh, deviceId, carried, nowSec: now });
    } catch (err) {
      return flowErrorResponse(err, id);
    }

    if (decision.kind !== "delivered") {
      // 抢不到却读出"未交付" = 状态在两次读之间被外部改回去了。真到不了，
      // 到了也不能接着往下签（不知道签什么），交给客服。
      console.error(`[order/status] 订单 ${id} 抢占失败后重读仍未交付`);
      return NextResponse.json({ success: false, error: GRANT_BROKEN }, { status: 500 });
    }
  }

  // 到这里 decision 一定是 delivered（第一次判成 delivered，或抢占失败后重判成 delivered）。
  if (!decision.reissue) {
    // 请求带着凭证：什么都不做。**这一支是安全阀** —— 带着 cookie 还重签，
    // 就等于把用户已经用掉的券复活（快照记的是交付那一刻的次数）。
    // 分不清"陈旧 cookie"与"刚消费过的 cookie"时，宁可不签。
    return NextResponse.json({ success: true, status: "paid", delivered: true });
  }

  // 响应丢失后的恢复：请求完全不带权益 cookie，而订单已交付。
  // 用订单行上那份**已被正当授予过的**快照重签一次，否则用户就是钱付了、
  // 什么都没有。它不是现场构造的权益，来源见 order-flow 与 claim_order_delivery。
  const snapshot = decision.reissue;
  const res = NextResponse.json({
    success: true,
    status: "paid",
    entitlement: toSummary(snapshot, now),
  });
  return withPassCookie(res, snapshot, secret);
}
