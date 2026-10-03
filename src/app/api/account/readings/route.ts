import { NextRequest, NextResponse } from "next/server";
import {
  accountsConfigured,
  deleteReadingForUser,
  listReadings,
  saveReadingForUser,
  userFromRequest,
} from "@/lib/server/account-store";
import { validateReadingPayload } from "@/lib/validation";

/**
 * 排盘记录上云。
 *
 * 记录本来就存在浏览器 localStorage 里（最多 50 条）。这里的账户副本解决两件事：
 * 换设备能看到、清了浏览器数据不丢。
 *
 * 两者**并存而不是替换**：未登录用户照样有本地记录，登录后才多一份云端副本。
 * 如果改成"必须登录才能看记录"，那些不想注册的用户会立刻失去已有功能 ——
 * 加功能不该以拿走已有功能为代价。
 *
 * 所有操作都按 user_id 过滤，且必须通过 token 校验。id 猜对了也读不到别人的。
 */

export const runtime = "nodejs";

async function requireUser(req: NextRequest) {
  if (!accountsConfigured()) {
    return {
      error: NextResponse.json({ success: false, error: "账号服务尚未配置" }, { status: 503 }),
    };
  }
  const user = await userFromRequest(req);
  if (!user) {
    return { error: NextResponse.json({ success: false, error: "未登录" }, { status: 401 }) };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  try {
    const readings = await listReadings(auth.user!.id);
    return NextResponse.json({ success: true, readings });
  } catch (err) {
    console.error("读取记录失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const checked = validateReadingPayload(body);
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  }

  try {
    const reading = await saveReadingForUser(auth.user!.id, checked.value);
    return NextResponse.json({ success: true, reading });
  } catch (err) {
    console.error("保存记录失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth.error) return auth.error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id || id.trim().length === 0) {
    return NextResponse.json({ success: false, error: "缺少记录 id" }, { status: 400 });
  }

  try {
    // user_id 条件在 account-store 里带上 —— 猜对 id 也删不掉别人的记录
    await deleteReadingForUser(auth.user!.id, id.trim());
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("删除记录失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
