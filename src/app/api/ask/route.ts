import { NextRequest, NextResponse } from "next/server";
import { askFollowUp } from "@/lib/ai";
import { buildBaziChart } from "@/lib/bazi";
import { validateFortuneRequest } from "@/lib/validation";
import { MODES } from "@/lib/pricing";
import { bumpUsage } from "@/lib/server/usage-store";
import { quotaGuard, remainingAfter, withDeviceCookie } from "@/lib/server/quota-guard";

/**
 * 追问。
 *
 * 与首次解读**共用同一套限流**（quota-guard），所以追问不是免费的加餐 ——
 * 它会消耗与首次解读同一个每日额度。这是刻意的：每一次追问都是一次真实的
 * DeepSeek 调用，不限额就是一个敞着的口子。
 *
 * 盘由服务端**重新排**，而不是信任客户端传回来的盘：
 * 排盘是确定性的，重算一遍成本极低；而收下客户端的盘等于让它往 prompt 里塞任意文本。
 */

export const runtime = "nodejs";

/** 追问正文的上限，比「关注方向」宽，比一整段解读窄。 */
const MAX_ASK = 300;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  // 追问本身
  const ask = raw.ask;
  if (typeof ask !== "string" || ask.trim().length < 2) {
    return NextResponse.json({ success: false, error: "请输入想问的问题" }, { status: 400 });
  }
  if (ask.length > MAX_ASK) {
    return NextResponse.json(
      { success: false, error: "问题过长，请精简到 300 字以内" },
      { status: 400 }
    );
  }

  // 出生信息复用同一套校验：伪造 mode 走不通，字段也过白名单
  const checked = validateFortuneRequest({ ...raw, mode: "bazi" }, Object.keys(MODES));
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  }

  // 上一轮解读的节选，可选。截断在 ai.ts 里做，这里只挡长度
  const previous = typeof raw.previous === "string" ? raw.previous.slice(0, 4000) : undefined;

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
      { success: false, error: "出生信息不完整，无法排盘，请重新填写后再问" },
      { status: 400 }
    );
  }

  const guard = await quotaGuard(req);
  if (!guard.ok) return guard.response;

  const result = await askFollowUp(chart, ask.trim(), previous);

  if (!result.success) {
    // 失败不记账，与首次解读一致
    return withDeviceCookie(
      NextResponse.json(result, { status: 500 }),
      guard.deviceId,
      guard.isNewDevice
    );
  }

  let remaining = remainingAfter(guard.counts);
  try {
    await bumpUsage(guard.deviceId, guard.ipHash);
  } catch (err) {
    console.error("用量记账失败:", err);
    remaining = Math.max(0, remaining - 1);
  }

  return withDeviceCookie(
    NextResponse.json({ ...result, remaining, chart }),
    guard.deviceId,
    guard.isNewDevice
  );
}
