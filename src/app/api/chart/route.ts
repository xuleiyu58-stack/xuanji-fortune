import { NextRequest, NextResponse } from "next/server";
import { buildBaziChart } from "@/lib/bazi";
import { MODES } from "@/lib/pricing";
import { validateFortuneRequest } from "@/lib/validation";
import { readOnlyGuard } from "@/lib/server/quota-guard";

/**
 * 只排盘，不解读。
 *
 * 给「历史回看」用：点开一条旧记录时，要把它当时的命盘重新显示出来，
 * 但**不能扣券、不能调模型** —— 用户已经为这份解读付过一次钱了。
 *
 * 排盘是确定性纯计算（见 lib/bazi），不花一分钱。所以这个接口：
 *   · 不调用 DeepSeek
 *   · 不消耗单次券、不记账
 *
 * 用 readOnlyGuard 而不是 quotaGuard：后者的语义里包含"先占坑，紧接着
 * 就要调模型"，拿它拦一个不调模型的接口会在用户毫无察觉时扣掉一张券。
 */

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const checked = validateFortuneRequest(body, Object.keys(MODES));
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  }

  const guard = await readOnlyGuard(req, checked.mode);
  if (!guard.ok) {
    // 未解锁（403）时不该报错 —— 前端拿不到盘就只显示解读正文，那已经够读了。
    // 所以回 200 + 空盘，而不是把 403 抛给用户看。
    if (guard.response.status === 403) {
      return NextResponse.json({ success: true, chart: null, reason: "locked" });
    }
    return guard.response;
  }

  const chart = buildBaziChart({
    birthDate: checked.input.birthDate ?? "",
    birthTime: checked.input.birthTime ?? "",
    gender: checked.input.gender ?? "",
    calendar: checked.input.calendar === "lunar" ? "lunar" : "solar",
    lunarLeap: checked.input.lunarLeap === "true",
    province: checked.input.province || undefined,
    city: checked.input.city || undefined,
  });

  if (!chart) {
    return NextResponse.json(
      { success: false, error: "出生信息不完整，无法排盘" },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, chart });
}
