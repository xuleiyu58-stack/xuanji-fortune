import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { grantMember, grantPass, toSummary, EMPTY_ENTITLEMENT } from "@/lib/entitlement";
import { isMode, REDEEM_IP_DAILY_LIMIT, SINGLE_PASS_DAYS } from "@/lib/pricing";
import { isValidCodeFormat, normalizeCode, redeemCode } from "@/lib/server/codes";
import { putDeviceEntitlement } from "@/lib/server/account-store";
import { DEVICE_COOKIE, withDeviceCookie } from "@/lib/server/quota-guard";
import { bumpCount, hashIp, readCount } from "@/lib/server/usage-store";
import { nowSec, readEntitlement, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";

/**
 * 兑换激活码。
 *
 * 这是全站唯一的"把付款变成权限"的入口，所以三件事都做在服务端：
 *   1. 码的有效性由数据库的原子核销决定（一码只能用一次）
 *   2. 权益写进 HMAC 签名的 cookie，此后判定只验签、不查库
 *   3. 既有的会员与单次券**合并**而不是覆盖 —— 手里还攥着一张券的人
 *      再兑会员，那张券不该被吞掉
 *
 * 失败信息刻意不区分"不存在"与"已被使用"：区分了就等于给爆破者一个进度条。
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = passSecret();
  if (!secret) {
    // 没有签名密钥就发不出可用的凭证。说清是服务端未配置，而不是"码错了"——
    // 后者会让用户拿着正确的码反复重试。
    console.error("[redeem] 未配置 PASS_SECRET，无法签发权益凭证");
    return NextResponse.json(
      { success: false, error: "兑换服务尚未配置完成，请稍后再试" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const rawCode = (body as Record<string, unknown>).code;
  if (typeof rawCode !== "string") {
    return NextResponse.json({ success: false, error: "请输入激活码" }, { status: 400 });
  }
  const code = normalizeCode(rawCode);
  if (!isValidCodeFormat(code)) {
    // 格式都不对就不必查库了；文案与"码无效"保持一致，不泄露额外的判定信息
    return NextResponse.json({ success: false, error: "激活码无效或已被使用" }, { status: 400 });
  }

  // 按 IP 限次，成功与失败都计数 —— 只统计成功会让失败路径变成免费的爆破靶场
  const ipHash = hashIp(
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "0.0.0.0"
  );
  const redeemKey = `redeem:${ipHash}`;

  try {
    const used = await readCount(redeemKey);
    if (used >= REDEEM_IP_DAILY_LIMIT) {
      return NextResponse.json(
        { success: false, error: "今日尝试次数过多，请明天再来" },
        { status: 429 }
      );
    }
    await bumpCount(redeemKey);
  } catch (err) {
    // 计数读不到就拒绝：这是核销入口，宁可 503 也不能让爆破无限试
    console.error("兑换限次失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  // 设备标识。**没有就现在发一个** —— 不能等到 /api/fortune 才发：
  // 用户完全可能先兑换、还没排盘就去登录，那时设备 cookie 还不存在，
  // 设备权益镜像就挂不上任何东西，登录后也就没得可迁移。
  // 这正是账号体系要解决的那个场景，不能让它断在这里。
  const existingDevice = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice ?? randomUUID();
  const isNewDevice = existingDevice === undefined;
  const who = deviceId.slice(0, 8);

  let outcome;
  try {
    outcome = await redeemCode(code, who);
  } catch (err) {
    console.error("核销失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  if (!outcome.ok) {
    return NextResponse.json({ success: false, error: "激活码无效或已被使用" }, { status: 400 });
  }

  const now = nowSec();
  const current = readEntitlement(req) ?? EMPTY_ENTITLEMENT;

  let next = current;
  if (outcome.kind === "member") {
    // 续期从现有到期时间往后接，提前续费不会亏掉剩余天数
    next = grantMember(next, outcome.days ?? 0, now);
  } else {
    const mode = outcome.mode ?? "";
    // 码里写着一个不存在的模式时不放行，否则会签出一张永远用不掉的券
    if (!isMode(mode)) {
      console.error(`[redeem] 激活码指向未知模式: ${mode}`);
      return NextResponse.json(
        { success: false, error: "该激活码对应的功能已下线，请联系客服" },
        { status: 400 }
      );
    }
    next = grantPass(next, mode, 1, SINGLE_PASS_DAYS, now);
  }

  // 镜像一份到设备维度，供日后登录时认领进账户（见 supabase/accounts.sql）。
  // 写镜像失败**不影响本次兑换** —— cookie 已经签好了，权益立刻可用；
  // 镜像只影响"以后能不能把它迁到账户上"，那是次要且可重试的事。
  try {
    await putDeviceEntitlement(deviceId, next);
  } catch (err) {
    console.error("写入设备权益镜像失败（不影响本次兑换）:", err);
  }

  const res = withDeviceCookie(
    NextResponse.json({ success: true, entitlement: toSummary(next, now) }),
    deviceId,
    isNewDevice
  );

  return withPassCookie(res, next, secret);
}
