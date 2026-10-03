import { NextRequest, NextResponse } from "next/server";
import {
  accountsConfigured,
  readAccountEntitlement,
  userFromRequest,
} from "@/lib/server/account-store";
import { toSummary } from "@/lib/entitlement";
import { nowSec } from "@/lib/server/pass-cookie";

/**
 * 查询账户权益。
 *
 * 与 /api/entitlement 的区别，正是账号体系存在的理由：
 *   · /api/entitlement 读的是**本机凭证**（cookie），清了浏览器数据就没了
 *   · 这个接口读的是**账户**，换设备、清 cookie 都还在
 *
 * 界面用前者做即时显示（不查库、快），用这个做登录后的权威同步。
 * 两边都返回同一个 EntitlementSummary 形状，调用方不需要区分。
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!accountsConfigured()) {
    return NextResponse.json(
      { success: false, error: "账号服务尚未配置" },
      { status: 503 }
    );
  }

  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: "未登录" }, { status: 401 });
  }

  try {
    const ent = await readAccountEntitlement(user.id);
    return NextResponse.json({
      success: true,
      email: user.email,
      entitlement: toSummary(ent, nowSec()),
    });
  } catch (err) {
    console.error("读取账户权益失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
