import { NextRequest, NextResponse } from "next/server";
import { toSummary } from "@/lib/entitlement";
import { nowSec, readEntitlement, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";

/**
 * 查询当前权益。
 *
 * 供界面显示会员徽章与「会员免费」标签。判定权益只验签、不查库，
 * 所以这个接口很便宜，前端可以放心在挂载时调一次。
 *
 * 顺带做一次**凭证清理**：过期的会员与用尽的券在这里被剔除，
 * cookie 被重写或清掉。否则一份早已失效的载荷会一直挂在浏览器里，
 * 每次请求都白带一圈。
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const now = nowSec();
  const ent = readEntitlement(req);
  const summary = toSummary(ent, now);
  const res = NextResponse.json({ success: true, entitlement: summary });

  const secret = passSecret();
  if (secret) {
    // 传 null 时 withPassCookie 会清掉 cookie —— 这正是过期凭证该有的下场
    withPassCookie(res, ent, secret);
  }

  return res;
}
