import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readBazi } from "@/lib/ai";
import { MODES, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT } from "@/lib/pricing";
import { validateFortuneRequest } from "@/lib/validation";
import { decideQuota } from "@/lib/quota-policy";
import { readUsage, bumpUsage, hashIp, dailyGlobalBudget } from "@/lib/server/usage-store";

// 用到 node:crypto 做 IP 哈希，必须显式声明 Node 运行时
export const runtime = "nodejs";

const DEVICE_COOKIE = "xj_dev";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const YEAR_SECONDS = COOKIE_MAX_AGE;

function clientIp(req: NextRequest): string {
  // Vercel 会在 x-forwarded-for 里给出真实来源，取第一段
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

function withDeviceCookie(res: NextResponse, deviceId: string, isNew: boolean): NextResponse {
  if (isNew) {
    res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: YEAR_SECONDS,
    });
  }
  return res;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const checked = validateFortuneRequest(body, Object.keys(MODES));
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  }

  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existing ?? randomUUID();
  const isNewDevice = existing === undefined;
  const ipHash = hashIp(clientIp(req));

  let counts;
  try {
    counts = await readUsage(deviceId, ipHash);
  } catch (err) {
    // 读不到计数就不能放行 —— 限流失效时宁可拒绝，也不能敞开烧钱
    console.error("用量读取失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const decision = decideQuota(counts, {
    device: FREE_DAILY_QUOTA,
    ip: FREE_IP_DAILY_LIMIT,
    global: dailyGlobalBudget(),
  });

  if (!decision.allowed) {
    return withDeviceCookie(
      // 回传 remaining=0，让界面与服务端一致 —— 本地计数只是估算
      NextResponse.json({ success: false, error: decision.message, remaining: 0 }, { status: 429 }),
      deviceId,
      isNewDevice
    );
  }

  const result = await readBazi(checked.input);

  if (!result.success) {
    // 失败不记账：服务端出错不该由用户承担额度。
    // 注意 result 里可能仍带着排好的命盘 —— 解读失败不该让人连盘都看不见。
    return withDeviceCookie(
      NextResponse.json(result, { status: 500 }),
      deviceId,
      isNewDevice
    );
  }

  let remaining = Math.max(0, FREE_DAILY_QUOTA - (counts.device + 1));
  try {
    await bumpUsage(deviceId, ipHash);
  } catch (err) {
    // 记账失败不影响本次结果，但要留痕
    console.error("用量记账失败:", err);
    remaining = Math.max(0, remaining - 1); // 记不上账就按更保守的数字显示
  }

  return withDeviceCookie(
    NextResponse.json({ ...result, remaining }),
    deviceId,
    isNewDevice
  );
}
