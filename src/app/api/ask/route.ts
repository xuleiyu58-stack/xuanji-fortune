import { NextRequest, NextResponse } from "next/server";
import { askFollowUp } from "@/lib/ai";
import { passWriteBack } from "@/lib/auth-writeback";
import { buildBaziChart } from "@/lib/bazi";
import { validateFortuneRequest } from "@/lib/validation";
import { MODES } from "@/lib/pricing";
import { consumePass } from "@/lib/entitlement";
import { releasePassConsumption } from "@/lib/server/account-store";
import { bumpUsage } from "@/lib/server/usage-store";
import { quotaGuard, remainingAfter, withDeviceCookie } from "@/lib/server/quota-guard";
import { nowSec, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";

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

/** 与首次解读同口径：模型调用要留足时间，别让平台在返回前掐掉函数。 */
export const maxDuration = 60;

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

  // 追问本身。
  // 先 trim 再判长度：不 trim 的话，一段前后带大量空白的 300 字问题
  // 会被判超长，而真正发给模型的内容其实很短 —— 用户看不懂为什么被拒。
  const ask = typeof raw.ask === "string" ? raw.ask.trim() : "";
  if (ask.length < 2) {
    return NextResponse.json({ success: false, error: "请输入想问的问题" }, { status: 400 });
  }
  if (ask.length > MAX_ASK) {
    return NextResponse.json(
      { success: false, error: `问题过长，请精简到 ${MAX_ASK} 字以内` },
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
    timeUnknown: checked.input.timeUnknown === "true",
    province: checked.input.province || undefined,
    city: checked.input.city || undefined,
  });

  if (!chart) {
    return NextResponse.json(
      { success: false, error: "出生信息不完整，无法排盘，请重新填写后再问" },
      { status: 400 }
    );
  }

  const guard = await quotaGuard(req, "bazi");
  if (!guard.ok) return guard.response;

  const result = await askFollowUp(chart, ask, previous);

  if (!result.success) {
    // 失败不记账，与首次解读一致。
    // 单次券的坑已在放行前占下，这里退还 —— 用户不该为服务端故障丢一张券。
    if (guard.consumedPassId) {
      try {
        await releasePassConsumption(guard.consumedPassId);
      } catch (err) {
        console.error("退还单次券消费失败:", err);
      }
    }
    return withDeviceCookie(
      NextResponse.json(result, { status: 500 }),
      guard.deviceId,
      guard.isNewDevice
    );
  }

  // 与初次解读同口径：只有真吃额度才记账，会员与持券用户不占免费额度
  const consumedQuota = guard.decision.consume === "quota";
  let remaining = remainingAfter(guard.counts, consumedQuota);
  if (consumedQuota) {
    try {
      await bumpUsage(guard.deviceId, guard.ipHash);
    } catch (err) {
      console.error("用量记账失败:", err);
      remaining = Math.max(0, remaining - 1);
    }
  }

  const res = withDeviceCookie(
    NextResponse.json({ ...result, remaining, chart, via: guard.decision.via }),
    guard.deviceId,
    guard.isNewDevice
  );

  // 与 fortune 同口径：判断收在 lib/auth-writeback.ts，两个入口共用一套
  const secret = passSecret();
  if (secret) {
    const next = passWriteBack({
      entitlement: guard.entitlement,
      reissued: guard.reissued,
      consume: guard.decision.consume,
      nowSec: nowSec(),
    });
    if (next !== null || guard.reissued) withPassCookie(res, next, secret);
  }

  return res;
}
