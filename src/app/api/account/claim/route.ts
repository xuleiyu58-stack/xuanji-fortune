import { NextRequest, NextResponse } from "next/server";
import {
  accountsConfigured,
  claimDeviceEntitlement,
  claimLinkCode,
  readAccountEntitlement,
  userFromRequest,
} from "@/lib/server/account-store";
import { toSummary } from "@/lib/entitlement";
import { clearPassCookie, nowSec } from "@/lib/server/pass-cookie";

/**
 * 认领码的核销端（两段式认领的第二步）。
 *
 * 完整流程：
 *   1. 未登录时兑换了激活码 → 权益同时写进 cookie 与 device_entitlements
 *   2. 用户登录 → 前端调 /api/account/link 拿一次性短码
 *   3. 把短码发到这里 → 服务端凭短码查出 device_id，
 *      在**一个数据库事务里**把设备权益搬进账户，并删除设备行
 *
 * 最后一步清掉本机的 xj_pass：权益已经属于账户了，本机再从 cookie 读一份
 * 就等于同一份权益存在两处，而两处迟早会不一致（一边用掉、另一边还在）。
 * 清掉之后，请求会由 quota-guard 的 ensurePassCookie 自动从账户重新签发 ——
 * 用户完全感觉不到，但数据只有一个权威来源。
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!accountsConfigured()) {
    return NextResponse.json({ success: false, error: "账号服务尚未配置" }, { status: 503 });
  }

  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const raw = (body as Record<string, unknown>)?.code;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return NextResponse.json({ success: false, error: "缺少认领码" }, { status: 400 });
  }
  const code = raw.trim().toUpperCase();

  try {
    const deviceId = await claimLinkCode(code);
    if (!deviceId) {
      // 无效、已用过、已过期一律同一句话 —— 区分了就是给爆破者进度条
      return NextResponse.json(
        { success: false, error: "认领码无效或已过期，请重新获取" },
        { status: 400 }
      );
    }

    const moved = await claimDeviceEntitlement(user.id, deviceId);
    const ent = await readAccountEntitlement(user.id);

    const res = NextResponse.json({
      success: true,
      moved,
      entitlement: toSummary(ent, nowSec()),
    });

    // 权益已归账户，本机 cookie 不再保留一份
    return clearPassCookie(res);
  } catch (err) {
    console.error("认领权益失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
