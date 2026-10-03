import { NextRequest, NextResponse } from "next/server";
import { passWriteBack } from "@/lib/auth-writeback";
import { readBazi } from "@/lib/ai";
import { MODES } from "@/lib/pricing";
import { consumePass } from "@/lib/entitlement";
import { validateFortuneRequest } from "@/lib/validation";
import { bumpUsage } from "@/lib/server/usage-store";
import { releasePassConsumption } from "@/lib/server/account-store";
import { quotaGuard, remainingAfter, withDeviceCookie } from "@/lib/server/quota-guard";
import { nowSec, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";

// 用到 node:crypto（IP 哈希在 quota-guard 里），必须显式声明 Node 运行时
export const runtime = "nodejs";

/**
 * 单次解读可能要跑几十秒（2200 max_tokens），而 Vercel 的默认上限远低于此 ——
 * 不声明的话，平台会先把函数掐掉，用户看到的是无文案的 504。
 */
export const maxDuration = 60;

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

  // 准入判定（凭证 / 设备 / IP / 全局四维度）统一走 quota-guard，
  // 与追问接口共用同一套 —— 分成两份迟早会漂移。
  //
  // mode 必须传进去：付费模式与免费模式的额度规则不同。
  // 注意取自 checked.mode，而不是 checked.input.mode —— 后者恒为 undefined，
  // 会让判定把每个请求都当成未知模式（= 付费）处理，连持券用户也一起拦掉。
  const guard = await quotaGuard(req, checked.mode);
  if (!guard.ok) return guard.response;

  const result = await readBazi(checked.input);

  if (!result.success) {
    // 失败不记账：服务端出错不该由用户承担额度。
    // 注意 result 里可能仍带着排好的命盘 —— 解读失败不该让人连盘都看不见。
    //
    // 单次券的坑已经在放行前占下了（防并发白嫖），这里要退还，
    // 否则用户会为一次服务端故障白丢一张券。退还失败只记日志：
    // 最坏情况是用户损失一张券，而不是券被无限重放。
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

  // 只有真吃了额度才记账。会员与持券用户的放行是"权限"，不是"消耗"——
  // 给他们也记一笔，等于让付了钱的人比不付钱的人更早被拦。
  const consumedQuota = guard.decision.consume === "quota";
  let remaining = remainingAfter(guard.counts, consumedQuota);

  if (consumedQuota) {
    try {
      await bumpUsage(guard.deviceId, guard.ipHash);
    } catch (err) {
      // 记账失败不影响本次结果，但要留痕
      console.error("用量记账失败:", err);
      remaining = Math.max(0, remaining - 1); // 记不上账就按更保守的数字显示
    }
  }

  const res = withDeviceCookie(
    NextResponse.json({ ...result, remaining, via: guard.decision.via }),
    guard.deviceId,
    guard.isNewDevice
  );

  // 凭证的处理只有一种：算出该写回哪一份，然后写回。
  // 判断逻辑收在 lib/auth-writeback.ts —— 两个入口原本各写一遍，
  // 已经出现过一处漏掉"补签"分支的不一致。
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
