/**
 * 请求准入：设备 cookie、IP、权益凭证、额度判定、记账。
 *
 * 抽出来是因为**不止一个入口要过这道闸** —— 首次解读（/api/fortune）
 * 与追问（/api/ask）用的是同一套限流。
 *
 * 限流是安全代码：抄一份到第二个路由里，两份迟早会因为改了一处而漂移，
 * 而漂移的那一份就是敞着的口子。
 *
 * 判定本身在 lib/access.ts（纯函数、可单测）；这里只负责把凭证、计数、
 * 限额三样东西凑齐了交给它，再把它的结论翻译成 HTTP。
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  FREE_DAILY_QUOTA,
  FREE_IP_DAILY_LIMIT,
  PAID_TRIAL_IP_LIMIT,
  PAID_TRIAL_PER_DAY,
  isFreeMode,
} from "@/lib/pricing";
import { decideAccess, type AccessDecision, type UsageCounts } from "@/lib/access";
import type { Entitlement } from "@/lib/entitlement";
import { dailyGlobalBudget, hashIp, readUsage } from "@/lib/server/usage-store";
import { ensurePassCookie, nowSec, withPassCookie } from "@/lib/server/pass-cookie";
import { claimPassConsumption, passIdOf } from "@/lib/server/account-store";
import { passSecret } from "@/lib/server/runtime";

export const DEVICE_COOKIE = "xj_dev";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * 单次券已被消费过时的文案。
 *
 * 与 access.ts 的 PAID_LOCKED 保持一致，但刻意不从那里 import ——
 * 那个常量是"判定该拒绝"用的，这个是"消费台账说已经用过了"用的，
 * 两者的触发条件不同，将来也可能改成不同的文案。
 */
const PAID_LOCKED_MESSAGE = "该模式需激活后使用，请使用激活码开通";

export interface GuardPass {
  ok: true;
  deviceId: string;
  ipHash: string;
  /** 这次请求是不是这个设备的第一面 —— 决定要不要签发设备 cookie */
  isNewDevice: boolean;
  counts: UsageCounts;
  /** 此次请求携带的有效权益，未持凭证时为 null */
  entitlement: Entitlement | null;
  /**
   * 凭证是从账户侧补签的（用户清了 cookie 但账号还在）。
   * 非 null 时路由必须把它写回响应，否则下次请求还得再查一次库。
   */
  reissued: Entitlement | null;
  /** 放行结论 —— 路由据此知道该不该记账、要不要回写单次券 */
  decision: Extract<AccessDecision, { allow: true }>;
  /**
   * 本次已经占用的消费台账条目（形如 `tid:下标`）。
   *
   * 占坑发生在放行之前，但**回写 cookie 发生在解读成功之后** ——
   * 所以路由在失败分支里必须用它把坑退还，否则用户会为一次服务端故障白丢一张券。
   */
  consumedPassId: string | null;
}

/**
 * 拒绝分支也带上"为什么拒绝"。
 *
 * 加这个字段是为了让路由能区分**拒绝的种类**：/api/fortune 在
 * "没付钱"（403 / paid）时改送一次免费试读，而熔断（503）与额度耗尽（429）
 * 必须原样拒绝 —— 那两种情况再送一次模型调用只会让服务端更吃紧。
 *
 * 在此之前路由只能靠 `guard.response.status` 反推，那既绕又容易看错。
 */
export type GuardOutcome =
  | GuardPass
  | {
      ok: false;
      response: NextResponse;
      /** 拒绝的判定结果，路由据此分支 */
      decision: Extract<AccessDecision, { allow: false }>;
      deviceId: string;
      ipHash: string;
      isNewDevice: boolean;
    };

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
 *
 * `mode` 必须传进来：付费模式与免费模式的额度规则不同，不区分就等于
 * 「客户端看着要付款，服务端却照给」—— 那正是这一步要堵的洞。
 */
export async function quotaGuard(req: NextRequest, mode: string): Promise<GuardOutcome> {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existing ?? randomUUID();
  const isNewDevice = existing === undefined;
  const ipHash = hashIp(clientIp(req));

  // 有 cookie 就直接用它（不查库）；没有才凭登录态从账户侧补一张。
  // 这正是账号体系解决的那个问题：清了浏览器数据也不会丢掉会员。
  const { entitlement, reissued } = await ensurePassCookie(req);

  let counts: UsageCounts;
  try {
    counts = await readUsage(deviceId, ipHash);
  } catch (err) {
    console.error("用量读取失败:", err);
    return {
      ok: false,
      // 读不到用量就拒绝 —— 这是"服务端故障"，不是"你没付钱"，
      // 所以按 503 回，路由也不会把它当成可以送试读的情况。
      decision: {
        allow: false,
        status: 503,
        reason: "global",
        message: "服务暂时不可用，请稍后再试",
      },
      deviceId,
      ipHash,
      isNewDevice,
      response: NextResponse.json(
        { success: false, error: "服务暂时不可用，请稍后再试" },
        { status: 503 }
      ),
    };
  }

  // 付费模式与免费模式的额度档位不同：前者用体验上限（当前为 0，即先激活
  // 后使用），后者用免费额度。把两组数字都交给判定函数，由它按 isFree 选。
  const limits = isFreeMode(mode)
    ? { device: FREE_DAILY_QUOTA, ip: FREE_IP_DAILY_LIMIT, global: dailyGlobalBudget() }
    : { device: PAID_TRIAL_PER_DAY, ip: PAID_TRIAL_IP_LIMIT, global: dailyGlobalBudget() };

  const decision = decideAccess(
    mode,
    counts,
    limits,
    entitlement,
    isFreeMode(mode),
    nowSec(),
    PAID_TRIAL_PER_DAY
  );

  if (!decision.allow) {
    // 状态码沿用既有约定：额度用尽 429、服务熔断 503、权限不足 403
    return {
      ok: false,
      decision,
      deviceId,
      ipHash,
      isNewDevice,
      response: withDeviceCookie(
        NextResponse.json(
          { success: false, error: decision.message, reason: decision.reason, remaining: 0 },
          { status: decision.status }
        ),
        deviceId,
        isNewDevice
      ),
    };
  }

  // 单次券的消费必须落在服务端。
  //
  // 权益 cookie 是自包含的，客户端手里那份是它自己的副本 —— 若"用过了"只体现
  // 在回写的新 cookie 里，那么保留旧 cookie 的人（抄走凭证的、不执行清除的
  // 客户端、手工重放请求的）就能把同一张券无限次用下去。
  //
  // 所以这里先原子地认领一次消费，认领失败即拒绝（而不是悄悄放行）。
  // 这一步在调用 AI **之前**：先占坑再干活，否则会白送一次解读。
  let consumedPassId: string | null = null;

  if (typeof decision.consume === "object") {
    if (!entitlement?.tid) {
      // 没有编号就无从记账。正常签发的凭证一定带 tid，走到这里说明凭证
      // 是伪造或来自极旧的版本 —— 两种都不该放行。
      console.error("[guard] 凭证缺少 tid，拒绝消费单次券");
      return {
        ok: false,
        decision: { allow: false, status: 403, reason: "paid", message: PAID_LOCKED_MESSAGE },
        deviceId,
        ipHash,
        isNewDevice,
        response: withDeviceCookie(
          NextResponse.json(
            { success: false, error: PAID_LOCKED_MESSAGE, reason: "paid", remaining: 0 },
            { status: 403 }
          ),
          deviceId,
          isNewDevice
        ),
      };
    }

    try {
      const passId = passIdOf(
        entitlement.tid,
        decision.consume.passIndex,
        decision.consume.remaining
      );
      const first = await claimPassConsumption(passId);
      if (!first) {
        return {
          ok: false,
          decision: { allow: false, status: 403, reason: "paid", message: PAID_LOCKED_MESSAGE },
          deviceId,
          ipHash,
          isNewDevice,
          response: withDeviceCookie(
            NextResponse.json(
              { success: false, error: PAID_LOCKED_MESSAGE, reason: "paid", remaining: 0 },
              { status: 403 }
            ),
            deviceId,
            isNewDevice
          ),
        };
      }
      consumedPassId = passId;
    } catch (err) {
      // 记不上账就**拒绝**，不能放行：放行等于让这张券变成无限次。
      // 与 readUsage 失败时返回 503 同一个原则 —— 安全机制失效时宁可拒绝服务。
      console.error("消费台账写入失败，拒绝放行:", err);
      return {
        ok: false,
        decision: {
          allow: false,
          status: 503,
          reason: "global",
          message: "服务暂时不可用，请稍后再试",
        },
        deviceId,
        ipHash,
        isNewDevice,
        response: withDeviceCookie(
          NextResponse.json(
            { success: false, error: "服务暂时不可用，请稍后再试" },
            { status: 503 }
          ),
          deviceId,
          isNewDevice
        ),
      };
    }
  }

  return {
    ok: true,
    deviceId,
    ipHash,
    isNewDevice,
    counts,
    entitlement,
    reissued,
    decision,
    consumedPassId,
  };
}

/**
 * 只读准入：判定能不能用，但**不做任何消耗**。
 *
 * 与 quotaGuard 的区别只有一个，但很关键：它不认领消费台账、不记账。
 * 给「历史回看」这类**不调用模型**的接口用 —— 用户已经为那份解读付过钱了，
 * 点开重看再扣一次是错的。
 *
 * 为什么不复用 quotaGuard：那个函数的语义里包含「先占坑，紧接着就要调模型」。
 * 拿它去拦一个不调模型的接口，会在用户毫无察觉的情况下扣掉一张券。
 * 同一个函数有两种语义，迟早会有人在错误的场景调用它。
 */
export async function readOnlyGuard(
  req: NextRequest,
  mode: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existing ?? randomUUID();
  const isNewDevice = existing === undefined;
  const ipHash = hashIp(clientIp(req));

  const { entitlement, reissued } = await ensurePassCookie(req);

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

  const decision = decideAccess(
    mode,
    counts,
    { device: PAID_TRIAL_PER_DAY, ip: PAID_TRIAL_IP_LIMIT, global: dailyGlobalBudget() },
    entitlement,
    isFreeMode(mode),
    nowSec(),
    PAID_TRIAL_PER_DAY
  );

  if (!decision.allow) {
    return {
      ok: false,
      response: withDeviceCookie(
        NextResponse.json(
          { success: false, error: "该模式需激活后使用", reason: "paid", remaining: 0 },
          { status: 403 }
        ),
        deviceId,
        isNewDevice
      ),
    };
  }

  // 补签的凭证仍要写回，否则下次又得查一次库。这不涉及消费，是纯收益。
  const res = NextResponse.json({ ok: true });
  const secret = passSecret();
  if (secret && reissued) withPassCookie(res, reissued, secret);

  return { ok: true };
}

/**
 * 剩余免费体验次数，供响应回传给界面。
 *
 * 只在消耗了体验额度时才递减 —— 会员与持券用户没有「剩余次数」这个概念，
 * 一律减一会让界面显示得比实际更惨。
 */
export function remainingAfter(counts: UsageCounts, consumeQuota: boolean): number {
  if (!consumeQuota) return PAID_TRIAL_PER_DAY;
  return Math.max(0, PAID_TRIAL_PER_DAY - (counts.device + 1));
}
