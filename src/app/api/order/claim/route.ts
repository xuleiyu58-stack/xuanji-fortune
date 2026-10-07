import { NextRequest, NextResponse } from "next/server";
import { decideClaimInput, decideClaimTarget } from "@/lib/order-flow";
import { getOrder, setPayerRef } from "@/lib/server/order-store";
import { DEVICE_COOKIE } from "@/lib/server/quota-guard";

/**
 * 用户提交交易单号。
 *
 * 提交**不等于**到账 —— 这里不做任何校验（也无从校验：个人收款码没有
 * 可查询的接口）。它的作用有两个：给站长对账时一个明确的锚点（金额 + 时间
 * 之外多一条线索），以及留下纠纷凭证。
 *
 * 文案必须说清楚这一点。「已提交，稍后开通」会让用户以为付完就完事了，
 * 然后回来发现没开通 —— 比不提交更糟。
 *
 * **本文件只是适配层**：入参判定与目标判定都在 `lib/order-flow.ts`（纯函数、
 * 零 next/* 依赖、可被 node --test 直接跑）。这边 import 了 next/server，
 * 裸 node 连模块都解析不出来，所以判定写在这里就等于不可测。
 */

export const runtime = "nodejs";

const NOT_FOUND = "订单不存在";
const UNAVAILABLE = "服务暂时不可用，请稍后再试";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const input = decideClaimInput(body);
  if (input.kind === "invalid") {
    return NextResponse.json({ success: false, error: input.error }, { status: 400 });
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    // 没有设备号就不可能有人下过单。回 404 而不是 403 ——
    // 403 等于确认"这个订单号存在"，那就成了订单探测器。
    // （早退只是为了省一次读库；判定的同一结论见 order-flow 的 decideClaimTarget。）
    return NextResponse.json({ success: false, error: NOT_FOUND }, { status: 404 });
  }

  try {
    const order = await getOrder(input.orderId);
    const target = decideClaimTarget(order, deviceId);
    if (target.kind === "not_found") {
      // 设备不匹配也走这里：不能区分"不存在"与"不是你的"。
      return NextResponse.json({ success: false, error: NOT_FOUND }, { status: 404 });
    }
    if (target.kind === "not_pending") {
      return NextResponse.json(
        { success: false, error: "该订单已处理，无需重复提交" },
        { status: 400 }
      );
    }

    // 只写 payer_ref / provider，**不碰 status**。到账与否由站长核对银行/收款
    // 流水后另行确认（见 order-store.confirmOrder），不在这里替用户宣布。
    await setPayerRef(target.order.id, deviceId, input.payerRef, input.provider);

    return NextResponse.json({
      success: true,
      notice: "已提交。我们核对到账后会为你开通，请保持本页面打开",
    });
  } catch (err) {
    console.error("提交交易单号失败:", err);
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
  }
}
