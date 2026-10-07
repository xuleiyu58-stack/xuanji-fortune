import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isPlanId, ORDER_IP_DAILY_LIMIT, ORDER_TTL_MINUTES, PLANS } from "@/lib/pricing";
import { payInstructionFor } from "@/lib/pay";
import { createOrder } from "@/lib/server/order-store";
import { DEVICE_COOKIE, withDeviceCookie } from "@/lib/server/quota-guard";
import { bumpCount, hashIp, readCount } from "@/lib/server/usage-store";

/**
 * 建单。
 *
 * **只收 plan，绝不收金额。** 金额由服务端从 PLANS 取 —— 接受客户端传价格
 * 等于让用户自己定价，那是最容易被忽略、后果又最直接的一类漏洞。
 *
 * 限次是必须的：没有它，任何人都能无限建 pending 单，把对账列表冲垮，
 * 让站长在几百条垃圾里找那笔真付款。
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const rawPlan = (body as Record<string, unknown>).plan;
  if (typeof rawPlan !== "string" || !isPlanId(rawPlan)) {
    return NextResponse.json({ success: false, error: "该套餐不存在" }, { status: 400 });
  }
  const plan = PLANS[rawPlan];

  // 设备标识。与 /api/redeem 的做法一致：没有就现在发一个，不能等到排盘才发。
  const existingDevice = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice ?? randomUUID();
  const isNewDevice = existingDevice === undefined;

  let ipHash: string;
  try {
    ipHash = hashIp(
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "0.0.0.0"
    );
  } catch (err) {
    console.error("IP 哈希失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const orderKey = `order:${ipHash}`;
  try {
    const used = await readCount(orderKey);
    if (used >= ORDER_IP_DAILY_LIMIT) {
      return NextResponse.json(
        { success: false, error: "今日下单次数过多，请明天再来" },
        { status: 429 }
      );
    }
    await bumpCount(orderKey);
  } catch (err) {
    // 计数读不到就拒绝：这是建单入口，宁可 503 也不能让人无限塞订单
    console.error("建单限次失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  try {
    const order = await createOrder({
      plan: plan.id,
      amount: plan.price,
      deviceId,
      ttlMinutes: ORDER_TTL_MINUTES,
    });

    const res = NextResponse.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      instruction: payInstructionFor(plan.id),
      expiresAt: order.expiresAt,
    });
    return withDeviceCookie(res, deviceId, isNewDevice);
  } catch (err) {
    console.error("建单失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
