import { NextRequest, NextResponse } from "next/server";
import { accountsConfigured, issueLinkCode, userFromRequest } from "@/lib/server/account-store";
import { hasAnyCredential, readEntitlement } from "@/lib/server/pass-cookie";

/**
 * 认领码的签发端（两段式认领的第一步）。
 *
 * 背景：老的权益挂在一张 httpOnly 的 cookie（xj_pass）上，页面脚本**读不到**它 ——
 * 这正是它的价值所在。所以"把匿名权益接上账户"不能让前端把凭证递过来，
 * 否则这层保护就白做了。
 *
 * 做法：前端先用 xj_dev（设备 cookie）换一张 10 分钟、一次性的短码，
 * 登录后把短码交给服务端；服务端自己按 xj_dev 查出该设备的权益完成迁移。
 * 短码本身不含任何权益信息，只是一张"取货凭证"。
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

  const entitlement = readEntitlement(req);
  if (!hasAnyCredential(entitlement)) {
    // 没有可迁移的权益。这不是错误 —— 新用户第一次登录就是这种情况，
    // 前端据此跳过认领步骤，不做任何事。
    return NextResponse.json({ success: true, code: null, reason: "no_credential" });
  }

  const deviceId = req.cookies.get("xj_dev")?.value;
  if (!deviceId) {
    // 有权益却查不到设备号，说明 cookie 被人为构造过（两者是分别签发的）。
    // 不发认领码，避免把权益交给一个说不清来源的设备。
    console.warn("[account/link] 持有权益但缺少设备 cookie，拒绝签发认领码");
    return NextResponse.json({ success: true, code: null, reason: "no_device" });
  }

  try {
    const code = await issueLinkCode(deviceId);
    return NextResponse.json({ success: true, code });
  } catch (err) {
    console.error("签发认领码失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
