/**
 * 请求里的登录态与权益凭证。
 *
 * 单独一层，是因为「读凭证」有四个入口要用（fortune / ask / entitlement / account），
 * 「写凭证」有三个（redeem 签发、fortune 与 ask 消耗后回写、account 登录时重签）。
 * 散在路由里手抄 cookie 选项，迟早有一处漏掉 httpOnly —— 而漏掉的那一处
 * 就是把签名凭证送给页面里的任意脚本。
 *
 * ## 为什么放行仍然只验签、不查库
 *
 * 权益的权威副本有两处：账户表（account_entitlements）与这张签名 cookie。
 * 热路径（每次解读）**只信 cookie**，因为每次解读都插一次数据库往返，
 * 是最容易在"加功能"时被悄悄引入的性能退化。
 *
 * 代价与对应的缓解：
 *   · cookie 有效期长（400 天），账户侧改权益不会立刻生效
 *     → 兑换与登录这两条人为路径都会从库里重签，正常使用下不会读到陈旧值
 *   · 用户清了 cookie
 *     → ensurePassCookie 会凭登录态从库里重新签发，这正是账号体系要解决的问题
 *
 * 未配置 PASS_SECRET 时一律视为「无凭证」：宁可让用户重新兑换，
 * 也不能因为密钥缺失就把所有人当成会员。
 */
import type { NextRequest, NextResponse } from "next/server";
import { sign, verify, toSummary, type Entitlement } from "@/lib/entitlement";
import { passSecret } from "@/lib/server/runtime";
import { readAccountEntitlement, userFromRequest } from "@/lib/server/account-store";

export const PASS_COOKIE = "xj_pass";

/** 会员最长 400 天 —— 比年卡(365)宽一点，免得最后一天续费时 cookie 先过期。 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 当前请求携带的有效权益；无凭证、密钥未配、验签失败都返回 null。 */
export function readEntitlement(req: NextRequest): Entitlement | null {
  const secret = passSecret();
  if (!secret) return null;
  return verify(req.cookies.get(PASS_COOKIE)?.value, secret, nowSec());
}

/**
 * 这份凭证里有没有"值钱的东西"。
 *
 * 给登录时判断要不要签发认领码用：一张只有空 passes 的凭证没什么可迁移的，
 * 此时不生成认领码，用户登录流程就少一步无意义的往返。
 */
export function hasAnyCredential(ent: Entitlement | null): boolean {
  if (!ent) return false;
  return (ent.member ?? 0) > nowSec() || ent.passes.some((p) => p.n > 0 && p.e > nowSec());
}

/**
 * 保证请求带着一份可用权益：cookie 里有就用它，没有就用账户里的补一张。
 *
 * 返回 `{ entitlement, reissued }`。`reissued` 为真时调用方必须把
 * 新凭证写回响应（用 withPassCookie），否则用户下一次请求还得再查一次库。
 *
 * 这一步会读库，所以只在**凭证缺失时**触发；带着有效 cookie 的常规请求
 * 完全不会走到这里。
 */
export async function ensurePassCookie(
  req: NextRequest
): Promise<{ entitlement: Entitlement | null; reissued: Entitlement | null }> {
  const secret = passSecret();
  if (!secret) return { entitlement: null, reissued: null };

  const existing = readEntitlement(req);
  if (existing) return { entitlement: existing, reissued: null };

  // cookie 缺失或已失效：若用户已登录，从账户侧补一张
  const user = await userFromRequest(req);
  if (!user) return { entitlement: null, reissued: null };

  try {
    const fromAccount = await readAccountEntitlement(user.id);
    const alive = toSummary(fromAccount, nowSec());
    if (!alive.member && alive.passes.length === 0) {
      return { entitlement: null, reissued: null };
    }

    // 账户行里没有 tid（那是设备凭证的概念）。这里给它一个**稳定**的编号：
    // 由 user_id 派生，因此每次补签都得到同一个值。
    //
    // 为什么必须稳定：消费台账的键是 `tid:下标`。若每次补签都换一个新编号，
    // 同一张券在台账里就成了不同的条目 —— 重放同一份 cookie 就能无限次通过。
    // 用 user_id 派生则无论补签多少次，指向的都是同一张券。
    return {
      entitlement: { ...fromAccount, tid: `acc-${user.id}` },
      reissued: { ...fromAccount, tid: `acc-${user.id}` },
    };
  } catch (err) {
    // 读库失败不该把"已付费用户"变成"未授权" —— 但也不能凭空放行。
    // 返回 null 让判定按未授权处理，用户看到 403 后重试通常就好了。
    console.error("从账户补发凭证失败:", err);
    return { entitlement: null, reissued: null };
  }
}

/**
 * 把凭证写回响应。
 *
 * `ent` 为 null 表示整份凭证已空，此时**清除** cookie 而不是写一个空壳 ——
 * 空壳会让下次请求仍然带着一个无意义的头。
 */
export function withPassCookie(
  res: NextResponse,
  ent: Entitlement | null,
  secret: string
): NextResponse {
  if (ent === null) {
    clearPassCookie(res);
    return res;
  }
  res.cookies.set(PASS_COOKIE, sign(ent, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

export function clearPassCookie(res: NextResponse): NextResponse {
  res.cookies.set(PASS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
