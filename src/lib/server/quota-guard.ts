/**
 * 请求准入：设备 cookie、IP、额度判定、记账。
 *
 * 抽出来是因为**不止一个入口要过这道闸** —— 首次解读（/api/fortune）
 * 与追问（/api/ask）用的是同一套限流。
 *
 * 限流是安全代码：抄一份到第二个路由里，两份迟早会因为改了一处而漂移，
 * 而漂移的那一份就是敞着的口子。
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT } from "@/lib/pricing";
import { decideQuota, type UsageCounts } from "@/lib/quota-policy";
import { dailyGlobalBudget, hashIp, readUsage } from "@/lib/server/usage-store";

export const DEVICE_COOKIE = "xj_dev";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface GuardPass {
  ok: true;
  deviceId: string;
  ipHash: string;
  /** 这次请求是不是这个设备的第一面 —— 决定要不要签发设备 cookie */
  isNewDevice: boolean;
  counts: UsageCounts;
}

export type GuardOutcome = GuardPass | { ok: false; response: NextResponse };

function clientIp(req: NextRequest): string {
  // Vercel 会在 x-forwarded-for 里给出真实来源，取第一段
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/** 新设备才签发 cookie。已签发的原样留着，不重写。 */
export function withDeviceCookie(
  res: NextResponse,
  deviceId: string,
  isNewDevice: boolean
): NextResponse {
  if (isNewDevice) {
    res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
  return res;
}

/**
 * 判定这次请求放不放行。
 *
 * 读不到计数时**拒绝**而不是放行 —— 限流失效时宁可返回 503，也不能敞着口子烧 API 余额。
 */
export async function quotaGuard(req: NextRequest): Promise<GuardOutcome> {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existing ?? randomUUID();
  const isNewDevice = existing === undefined;
  const ipHash = hashIp(clientIp(req));

  let counts: UsageCounts;
  try {
    counts = await readUsage(deviceId, ipHash);
  } catch (err) {
    console.error("用量读取失败:", err);
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "服务暂时不可用，请稍后再试" },
        { status: 503 }
      ),
    };
  }

  const decision = decideQuota(counts, {
    device: FREE_DAILY_QUOTA,
    ip: FREE_IP_DAILY_LIMIT,
    global: dailyGlobalBudget(),
  });

  if (!decision.allowed) {
    return {
      ok: false,
      response: withDeviceCookie(
        NextResponse.json(
          { success: false, error: decision.message, remaining: 0 },
          { status: 429 }
        ),
        deviceId,
        isNewDevice
      ),
    };
  }

  return { ok: true, deviceId, ipHash, isNewDevice, counts };
}

/** 剩余免费次数，供响应回传给界面（本地计数只是估算，服务端才是准的）。 */
export function remainingAfter(counts: UsageCounts): number {
  return Math.max(0, FREE_DAILY_QUOTA - (counts.device + 1));
}
