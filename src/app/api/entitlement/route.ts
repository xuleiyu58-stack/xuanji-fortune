import { NextRequest, NextResponse } from "next/server";
import { toSummary } from "@/lib/entitlement";
import { ensurePassCookie, nowSec, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";

/**
 * 查询当前权益。
 *
 * 供界面显示会员徽章与「会员免费」标签。
 *
 * **必须走 `ensurePassCookie` 而不是 `readEntitlement`。**
 * 两者的差别只在"cookie 里没有凭证"这一种情况下才显出来，而登录恰好就会
 * 制造这种情况：认领（claim）时本机 cookie 被清掉，权益只剩账户那一份，
 * 紧接着登录页调这里刷新界面 —— 只验签读 cookie 的话读到的是空的，
 * 于是页面刚说"权益已同步到账户"，徽章与会员页当场变回未开通。
 * 走 ensurePassCookie 才会在凭证缺失时从账户侧补一份回来。
 *
 * 代价可控：带着有效 cookie 的常规请求根本不读库，只有凭证缺失那一次会。
 *
 * 顺带做一次**凭证清理**：过期的会员与用尽的券在这里被剔除，
 * cookie 被重写或清掉。否则一份早已失效的载荷会一直挂在浏览器里，
 * 每次请求都白带一圈。
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const now = nowSec();
  const { entitlement, reissued } = await ensurePassCookie(req);
  const summary = toSummary(entitlement, now);
  const res = NextResponse.json({ success: true, entitlement: summary });

  const secret = passSecret();
  if (secret) {
    // 补签出来的那份（登录后靠账户补的，或旧凭证补了编号的）要写回去，
    // 否则下一次请求还得再查一次库；两份都没有时传 null，由 withPassCookie
    // 把那份失效的 cookie 清掉，而不是留个空壳在浏览器里。
    //
    // 编号不在这里补 —— `withPassCookie` 内部统一过 `withTid()`，
    // 写出去的凭证一定带号，见那里的注释。
    withPassCookie(res, reissued ?? entitlement, secret);
  }

  return res;
}
