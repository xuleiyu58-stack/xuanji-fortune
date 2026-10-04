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
  | {
      allow: true;
      /**
       * `pass` 带上被选中那张券的**下标**与**消费前的次数**。
       *
       * 光有下标不够：一张券可能有多次（n>1），而服务端的消费台账要能区分
       * "这张券的第几次使用"。次数是递减的，所以 `tid:下标:消费前次数`
       * 每次使用都不同 —— 同一次使用重放会被挡住，正常多次使用则一路放行。
       */
      consume: "none" | "quota" | { mode: string; passIndex: number; remaining: number };
      /**
       * 放行的依据。`trial` 表示吃的是每日免费体验额度 —— 界面据此提示
       * 「这是今天的第 N 次免费」，而 `paid` 表示持会员或单次券。
       */
      via: "paid" | "trial";
    }
  | {
      allow: false;
      status: 403 | 429 | 503;
      reason: "global" | "paid" | "device" | "ip";
      message: string;
    };

const QUOTA_EXHAUSTED = "今日免费次数已用完，开通会员可无限次解读";
/** 付费而没激活 —— 说清该做什么（去兑换），而不是只说"不行"。 */
const PAID_LOCKED = "该模式需激活后使用，请使用激活码开通";

export function decideAccess(
  mode: string,
  counts: UsageCounts,
  limits: QuotaLimits,
  entitlement: AccessEntitlement | null,
  isFree: boolean,
  nowSec: number,
  /**
   * 付费模式每日免费体验次数。默认 **0**，即付费模式必须先激活才能用。
   *
   * 这是产品决策的旋钮，不是安全参数：给它一个正数，首次来访就能免费看到
   * 一份完整解读（体验式转化），代价是任何人每天都能白拿那么多份。
   * 默认值刻意取 0 —— 让"要不要送"必须显式写出来，而不是某天被顺手改成 3。
   */
  trialPerDay = 0
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
      return { allow: true, consume: "none", via: "paid" };
    }
    // 找的是「第一张可用且模式匹配的券」的下标 —— 台账需要它，
    // 因为同一个模式可能有好几张券。
    // 一并带出消费前的次数：台账按 `tid:下标:次数` 记账，
    // 次数递减，所以同一次使用重放会被挡住，而正常的多次使用能依次通过。
    const passIndex = entitlement.passes.findIndex(
      (p) => p.m === mode && p.n > 0 && p.e > nowSec
    );
    if (passIndex >= 0) {
      const pass = entitlement.passes[passIndex];
      return {
        allow: true,
        consume: { mode, passIndex, remaining: pass.n },
        via: "paid",
      };
    }
  }

  // 3. 付费模式：先看有没有免费体验额度，没有就必须先激活
  if (!isFree) {
    if (trialPerDay > 0) {
      if (counts.device >= trialPerDay) {
        return { allow: false, status: 403, reason: "paid", message: PAID_LOCKED };
      }
      if (counts.ip >= limits.ip) {
        return { allow: false, status: 429, reason: "ip", message: QUOTA_EXHAUSTED };
      }
      return { allow: true, consume: "quota", via: "trial" };
    }
    return { allow: false, status: 403, reason: "paid", message: PAID_LOCKED };
  }

  // 4. 免费模式走额度
  if (counts.device >= limits.device) {
    return { allow: false, status: 429, reason: "device", message: QUOTA_EXHAUSTED };
  }
  if (counts.ip >= limits.ip) {
    return { allow: false, status: 429, reason: "ip", message: QUOTA_EXHAUSTED };
  }
  return { allow: true, consume: "quota", via: "trial" };
}

/**
 * 这次请求能不能拿到**免费试读**（只看第一节）。
 *
 * 与 decideAccess 分开，是因为它回答的是另一个问题：
 * decideAccess 判的是"能不能拿到完整解读"，这里判的是"连一节都拿不到的话，
 * 要不要给一份样品"。
 *
 * 三个前提，缺一不可：
 *   · 没有可用凭证 —— 已经付过钱的人不需要试读，走完整路径
 *   · 设备额度没用完
 *   · IP 额度没用完 —— 少了这条，清 cookie 就能无限次试读
 *
 * 纯函数、零 import，与 decideAccess 保持同样的可测性。
 */
export function decidePreview(
  counts: UsageCounts,
  entitlement: AccessEntitlement | null,
  nowSec: number,
  perDevice: number,
  perIp: number
): boolean {
  if (perDevice <= 0 || perIp <= 0) return false;

  // 已有凭证的人走完整解读，不该被算成试读
  if (entitlement) {
    const isMember = entitlement.member !== null && entitlement.member > nowSec;
    const hasPass = entitlement.passes.some((p) => p.n > 0 && p.e > nowSec);
    if (isMember || hasPass) return false;
  }

  return counts.device < perDevice && counts.ip < perIp;
}
