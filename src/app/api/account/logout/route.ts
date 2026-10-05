import { NextResponse } from "next/server";
import { clearDeviceCookie } from "@/lib/server/quota-guard";
import { clearPassCookie } from "@/lib/server/pass-cookie";

/**
 * 退出登录时清掉本机的权益凭证。
 *
 * ## 为什么必须有这个接口
 *
 * 退出登录此前**完全不碰权益 cookie**，于是留下一个很难解释的后果：
 * `ensurePassCookie` 在"没有 cookie 但有登录态"时会凭账户补签一份
 * `acc-<uid>` 的凭证；反过来，退出登录后那份 `acc-<uid>` 的凭证还躺在
 * 浏览器里（有效期 400 天），于是**同一台机器上的下一个人不用登录，
 * 就能继续排盘、拿完整解读** —— 用的是上一个人的会员或券。
 *
 * 权益不会因为退出登录而消失（它在账户里有权威副本，重新登录就回来），
 * 所以这里清掉的只是"本机这一份副本"，不是权益本身。
 *
 * ## 顺带清设备号
 *
 * `xj_dev` 是免费额度的记账键。不清的话下一个用户接着用上一个人的
 * 剩余额度；清了则各自从干净状态开始，也更符合"退出登录"的直觉。
 * 代价是同一台机器可以靠反复退出登录重置免费次数 —— 但 IP 与全局
 * 两道闸门仍在，且免费额度本来就只有 1 次/日，不值得为此把设备号留着。
 *
 * 前端在 `signOut()` 之后调它。Supabase 的登出是纯客户端动作，
 * 服务端这边没有会话要销，所以这里只做清 cookie 一件事。
 */

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ success: true });
  clearPassCookie(res);
  clearDeviceCookie(res);
  return res;
}
