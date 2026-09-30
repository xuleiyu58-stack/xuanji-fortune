/**
 * 额度判定。
 *
 * 只做"该不该放行"这一个判断，不碰任何 I/O —— 额度存在哪里是 usage-store 的事。
 * 纯函数、零 import，便于 node --test 直接跑。
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

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: "device" | "ip" | "global"; message: string };

/**
 * 判定顺序：全局熔断 → 设备 → IP。
 *
 * 全局排第一，因为它是保护 API 余额的最后一道闸：一旦触发，无论谁来都不再放行。
 * 设备排在 IP 前，是因为 IP 档位故意放得更宽（同一 IP 后面可能坐着多人 ——
 * 宿舍、公司、运营商 NAT），先按设备这个更精确的维度卡。
 */
export function decideQuota(counts: UsageCounts, limits: QuotaLimits): QuotaDecision {
  if (counts.global >= limits.global) {
    return {
      allowed: false,
      reason: "global",
      message: "今日测算人数较多，请明天再来",
    };
  }

  if (counts.device >= limits.device) {
    return {
      allowed: false,
      reason: "device",
      message: "今日免费次数已用完，开通会员可无限次解读",
    };
  }

  if (counts.ip >= limits.ip) {
    return {
      allowed: false,
      reason: "ip",
      message: "今日免费次数已用完，开通会员可无限次解读",
    };
  }

  return { allowed: true };
}
