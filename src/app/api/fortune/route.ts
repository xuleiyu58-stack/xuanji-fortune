import { NextRequest, NextResponse } from "next/server";
import { readBazi } from "@/lib/ai";
import { MODES } from "@/lib/pricing";
import { validateFortuneRequest } from "@/lib/validation";
import { bumpUsage } from "@/lib/server/usage-store";
import { quotaGuard, remainingAfter, withDeviceCookie } from "@/lib/server/quota-guard";

// 用到 node:crypto（IP 哈希在 quota-guard 里），必须显式声明 Node 运行时
export const runtime = "nodejs";

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

  // 准入判定（设备 / IP / 全局三维度）统一走 quota-guard，
  // 与追问接口共用同一套限流 —— 分成两份迟早会漂移
  const guard = await quotaGuard(req);
  if (!guard.ok) return guard.response;

  const result = await readBazi(checked.input);

  if (!result.success) {
    // 失败不记账：服务端出错不该由用户承担额度。
    // 注意 result 里可能仍带着排好的命盘 —— 解读失败不该让人连盘都看不见。
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
    // 记账失败不影响本次结果，但要留痕
    console.error("用量记账失败:", err);
    remaining = Math.max(0, remaining - 1); // 记不上账就按更保守的数字显示
  }

  return withDeviceCookie(
    NextResponse.json({ ...result, remaining }),
    guard.deviceId,
    guard.isNewDevice
  );
}
