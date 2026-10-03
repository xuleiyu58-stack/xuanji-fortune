import { NextRequest, NextResponse } from "next/server";
import { bumpCount, hashIp, readCount } from "@/lib/server/usage-store";
import { accountsConfigured } from "@/lib/server/account-store";
import { admin } from "@/lib/server/runtime";

/**
 * 发送邮箱验证码。
 *
 * 由服务端代发，而不是让浏览器直接调 supabase.auth.signInWithOtp，是为了
 * **加一道按 IP 的频率限制**。没有它，任何人都能拿这个接口当免费的邮件
 * 轰炸机 —— 用一个循环往任意邮箱发验证码，烧的是站长的邮件额度，
 * 更糟的是站长会成为那个"发垃圾邮件的人"。
 *
 * 发信本身仍交给 Supabase Auth（它管着 OTP 的生成、有效期与校验）。
 * 注意：默认的邮件模板只发链接，需要在控制台把它改成显示 {{ .Token }}，
 * 否则用户在站内输不了那 6 位码。见 README。
 */

export const runtime = "nodejs";

/** 每个 IP 每日发信上限。正常用户一天不会发超过几次。 */
const SEND_IP_DAILY_LIMIT = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
}

export async function POST(req: NextRequest) {
  if (!accountsConfigured()) {
    return NextResponse.json(
      { success: false, error: "账号服务尚未配置，可先用激活码解锁" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const raw = (body as Record<string, unknown>)?.email;
  if (typeof raw !== "string" || !EMAIL_RE.test(raw.trim())) {
    return NextResponse.json({ success: false, error: "请输入有效的邮箱地址" }, { status: 400 });
  }
  const email = raw.trim().toLowerCase();

  // 发信限次：成功与失败都计数，否则失败路径就是免费的轰炸通道
  const key = `otp:${hashIp(clientIp(req))}`;
  try {
    const used = await readCount(key);
    if (used >= SEND_IP_DAILY_LIMIT) {
      return NextResponse.json(
        { success: false, error: "今日验证码发送次数过多，请明天再试" },
        { status: 429 }
      );
    }
    await bumpCount(key);
  } catch (err) {
    console.error("验证码限次失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  try {
    // shouldCreateUser: true —— 本站没有独立的注册流程，首次验证即注册。
    // 这与"邮箱验证码登录"这个交互是自洽的：用户不需要知道自己是新用户还是老用户。
    const { error } = await admin().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      console.error("发送验证码失败:", error.message);
      return NextResponse.json(
        { success: false, error: "验证码发送失败，请稍后重试" },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("发送验证码异常:", err);
    return NextResponse.json(
      { success: false, error: "验证码发送失败，请稍后重试" },
      { status: 502 }
    );
  }

  // 刻意不回显"该邮箱是否已注册" —— 那等于一个免费的账号枚举接口
  return NextResponse.json({ success: true });
}
