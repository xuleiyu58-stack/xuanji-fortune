/**
 * 放行判定。
 *
 * 只回答"这个请求该不该放行、放行后该扣什么"，不碰任何 I/O。
 * 纯函数、零 import —— 因此能被 node --test 直接跑。
 *
 * 判定顺序里有两处刻意安排：
 *   - 全局熔断排在最前，因为它是保护 API 账单的最后一道闸，会员也不例外
 *   - 凭证排在免费额度之前，因为会员用免费模式时不该被扣次数
 */

export interface UsageCounts {
  device: number;
  ip: number;
  global: number;
}

export interface QuotaLimits {
  device: number;
  ip: number;
  global: number;
}

/** 与 entitlement.ts 的 Entitlement 结构兼容。此处独立声明是为了保持本模块零 import。 */
export interface AccessEntitlement {
  member: number | null;
  passes: { m: string; n: number; e: number }[];
}

export type AccessDecision =
  | { allow: true; consume: "none" | "quota" | { mode: string } }
  | {
      allow: false;
      status: 403 | 429 | 503;
      reason: "global" | "paid" | "device" | "ip";
      message: string;
    };

const QUOTA_EXHAUSTED = "今日免费次数已用完，开通会员可无限次解读";

export function decideAccess(
  mode: string,
  counts: UsageCounts,
  limits: QuotaLimits,
  entitlement: AccessEntitlement | null,
  isFree: boolean,
  nowSec: number
): AccessDecision {
  // 1. 全局熔断 —— 无论持有什么凭证都不放行
  if (counts.global >= limits.global) {
    return {
      allow: false,
      status: 503,
      reason: "global",
      message: "今日测算人数较多，请明天再来",
    };
  }

  // 2. 凭证
  if (entitlement) {
    if (entitlement.member !== null && entitlement.member > nowSec) {
      return { allow: true, consume: "none" };
    }
    const pass = entitlement.passes.find((p) => p.m === mode && p.n > 0 && p.e > nowSec);
    if (pass) {
      return { allow: true, consume: { mode } };
    }
  }

  // 3. 免费模式走额度
  if (isFree) {
    if (counts.device >= limits.device) {
      return { allow: false, status: 429, reason: "device", message: QUOTA_EXHAUSTED };
    }
    if (counts.ip >= limits.ip) {
      return { allow: false, status: 429, reason: "ip", message: QUOTA_EXHAUSTED };
    }
    return { allow: true, consume: "quota" };
  }

  // 4. 付费模式而没有有效凭证 —— 不是频率问题，是权限问题，用 403 而非 429
  return {
    allow: false,
    status: 403,
    reason: "paid",
    message: "该模式需激活后使用",
  };
}
