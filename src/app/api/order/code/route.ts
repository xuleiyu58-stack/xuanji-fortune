import { NextRequest, NextResponse } from "next/server";
import { decideCodeInput, decideCodeTarget } from "@/lib/order-flow";
import { getOrder, markCodeIssued } from "@/lib/server/order-store";
import { mintCode } from "@/lib/server/codes";
import { DEVICE_COOKIE } from "@/lib/server/quota-guard";
import { admin } from "@/lib/server/runtime";

/**
 * 跨设备兜底：把已到账的订单换成一个激活码。
 *
 * 用途是「手机付款、电脑在用」这类场景 —— 权益自动落到付款那台设备上，
 * 另一台设备只能靠码。有了它，redeem_codes 的原子核销与设备镜像
 * 全部原样复用，不需要第二套交付机制。
 *
 * **本文件只是适配层**：该不该发、发给谁，都在 `lib/order-flow.ts` 里判
 *（纯函数、可被 node --test 直接跑）；这边 import 了 next/server，裸 node
 * 解析不了，判定写在这里就等于不可测。
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

  const input = decideCodeInput(body);
  if (input.kind === "invalid") {
    return NextResponse.json({ success: false, error: input.error }, { status: 400 });
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    // 没有设备号就不可能有人下过单。404 而非 403：403 等于确认这个订单号存在。
    return NextResponse.json({ success: false, error: NOT_FOUND }, { status: 404 });
  }

  try {
    const order = await getOrder(input.orderId);
    const target = decideCodeTarget(order, deviceId);
    if (target.kind === "not_found") {
      return NextResponse.json({ success: false, error: NOT_FOUND }, { status: 404 });
    }
    if (target.kind === "not_paid") {
      return NextResponse.json({ success: false, error: "该订单尚未到账" }, { status: 400 });
    }
    if (target.kind === "unknown_plan") {
      console.error(`[order/code] 订单指向未知计划: ${order?.plan}`);
      return NextResponse.json(
        { success: false, error: "该订单对应的套餐已下线，请联系客服" },
        { status: 400 }
      );
    }

    const { order: paidOrder, plan } = target;

    // 抢占发码权：只有拿到行的那次请求能发。重复点"获取激活码"不会
    // 变出第二个码 —— 否则一次付款能开两台设备。
    const claimed = await markCodeIssued(paidOrder.id, deviceId);
    if (!claimed) {
      // 标记已在库里 —— 但**标记不等于码真发出去了**：写码那一步失败时，撤回
      // `code_issued_at` 本身也可能失败（网络断了就是两件事一起失败），标记就卡
      // 在库里了。那时用户每次都拿到"本单已发放过激活码"，手里却没有码 ——
      // 钱付了、门关着，而且只有付过钱的人会撞上。
      //
      // 所以按 `batch = order.id` 反查 redeem_codes（发码时写进去的就是它）：
      //   · 查到 → 把那张码原样还给他。同一张码，开不了第二台设备，但网络抖动
      //            不再是单点故障（幂等恢复）。
      //   · 查不到 → 码确实没发出去过，才真的报错。
      const { data: issued, error: lookupErr } = await admin()
        .from("redeem_codes")
        .select("code")
        .eq("batch", paidOrder.id)
        .limit(1);
      if (lookupErr) {
        console.error("反查已发出的激活码失败:", lookupErr);
        return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
      }
      const alreadyIssued = issued?.[0]?.code;
      if (typeof alreadyIssued === "string" && alreadyIssued) {
        return NextResponse.json({ success: true, code: alreadyIssued });
      }
      // 标记在、码不在 —— 只剩「写码失败且撤回也失败」这一种可能（见上）。
      // 不能对他撒谎说"已发放过，请查看之前的记录"：他手里根本没有那条记录。
      return NextResponse.json(
        { success: false, error: "该订单的激活码状态异常，请联系客服并提供订单号" },
        { status: 400 }
      );
    }

    /**
     * 撤回发码标记，让用户能重试。
     *
     * 撤不掉也不致命了：下面的反查兜底会在下一次请求里把已经发出去的码还给他。
     * 但**必须每次都试** —— 成功一次，用户就少一次"钱付了、码没有"的客服工单。
     */
    const undoMark = async () => {
      const { error: undoErr } = await admin()
        .from("orders")
        .update({ code_issued_at: null })
        .eq("id", paidOrder.id);
      if (undoErr) console.error("撤回发码标记失败:", undoErr);
    };

    // 撞码概率极低，但主键冲突会让整次请求失败，所以重试几次
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = mintCode();
      let failed: { code?: string } | null = null;
      try {
        const { error } = await admin()
          .from("redeem_codes")
          .insert({
            code,
            kind: plan.kind,
            mode: plan.kind === "single" ? plan.mode : null,
            days: plan.kind === "member" ? plan.days : 0,
            batch: paidOrder.id,
          });
        if (!error) {
          return NextResponse.json({ success: true, code });
        }
        failed = error;
      } catch (err) {
        // insert **抛异常**（而不是回一个 `{ error }`）。当前版本的 postgrest-js（2.110.2）
        // 会把连接层的失败也翻成 `{ error: { code: '' } }`，所以常态下走的是下面那条
        // 非撞码分支；这一支接住的是"库的实现变了 / admin() 本身抛了"那类情况。
        // 留着它是因为：**撤标记这件事不该指望第三方库的错误封装方式不变** ——
        // 少了它，异常就直接落到最外层 catch → 503，标记留在库里，用户从此每次
        // 都拿到"已发放过"而手里没有码。
        console.error("发码失败:", err);
        await undoMark();
        return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
      }

      if (failed.code !== "23505") {
        console.error("发码失败:", failed);
        // 发码权已经用掉了，但码没写进去。允许重试：把标记撤回。
        await undoMark();
        return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
      }
    }
    // 连续撞码 5 次（或数据库一直在回 23505）—— 按服务端故障处理。
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
  } catch (err) {
    console.error("发码失败:", err);
    return NextResponse.json({ success: false, error: UNAVAILABLE }, { status: 503 });
  }
}
