import { NextRequest, NextResponse } from "next/server";
import { passWriteBack } from "@/lib/auth-writeback";
import { readBazi } from "@/lib/ai";
import { PREVIEW_PER_DEVICE_PER_DAY, PREVIEW_PER_IP_PER_DAY, MODES } from "@/lib/pricing";
import { decidePreview, type AccessEntitlement } from "@/lib/access";
import { parseReading, LOCKED_SECTION_COUNT, SECTION_TITLES, type ParsedReading } from "@/lib/reading";
import { consumePass, verify } from "@/lib/entitlement";
import { validateFortuneRequest } from "@/lib/validation";
import { bumpUsage, bumpPreviewUsage, dailyGlobalBudget, hashIp, readPreviewUsage } from "@/lib/server/usage-store";
import { releasePassConsumption } from "@/lib/server/account-store";
import { DEVICE_COOKIE, quotaGuard, remainingAfter, withDeviceCookie } from "@/lib/server/quota-guard";
import { nowSec, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";
import { randomUUID } from "node:crypto";

// 用到 node:crypto（IP 哈希在 quota-guard 里），必须显式声明 Node 运行时
export const runtime = "nodejs";

/**
 * 单次解读可能要跑几十秒（2200 max_tokens），而 Vercel 的默认上限远低于此 ——
 * 不声明的话，平台会先把函数掐掉，用户看到的是无文案的 504。
 */
export const maxDuration = 60;

/**
 * 免费试读的响应。
 *
 * 用户还没付钱，但可以看第一节（命局总评）—— 这是唯一能让他判断
 * 「这 ¥6.6 值不值」的东西。在那之前他看到的只有一份命盘和一句价格。
 *
 * 三件事必须一起做到：
 *   1. 只回第一节 —— 解析后按小节名挑，不是按字数截断（截断会切在半句上）
 *   2. 记账 —— 试读同样要花一次模型调用，不记账就等于开了个免费接口
 *   3. 带上设备 cookie —— 否则每次请求都是"新设备"，额度形同虚设
 *
 * 返回 `locked: true` 与总节数，界面据此显示"还有 N 节待解锁"。
 */
async function previewResponse(
  req: NextRequest,
  result: { content?: string; chart?: unknown }
): Promise<NextResponse> {
  const parsed = parseReading(result.content ?? "");
  const first = parsed.sections[0];

  // 解析不出小节（模型没按格式走）时**不返回试读** ——
  // 没有结构就没有"样品"可言，回一段残文反而显得像坏了。
  // 此时当作没试读过：不计账、不签发 cookie，用户下次还能再试。
  if (!first) {
    return NextResponse.json(
      {
        success: false,
        error: "试读生成失败，请稍后再试",
        reason: "preview_failed",
        chart: result.chart,
      },
      { status: 500 }
    );
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value ?? randomUUID();
  const isNewDevice = req.cookies.get(DEVICE_COOKIE)?.value === undefined;

  try {
    await bumpPreviewUsage(deviceId, hashIp(clientIpOf(req)));
  } catch (err) {
    // 记不上账就不放行 —— 与正式解读同口径：宁可少送一次，也不开无额度的口子
    console.error("试读记账失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试", chart: result.chart },
      { status: 503 }
    );
  }

  return withDeviceCookie(
    NextResponse.json({
      success: true,
      // 只回第一节的内容。重新序列化成模型原本的格式，
      // 这样界面上走的是与完整解读完全相同的渲染路径 —— 试读就必须
      // 代表真实质量，两套渲染迟早会不一致。
      content: serializeSections([first]),
      chart: result.chart,
      preview: true,
      // 必须用常量而不是 parsed.sections.length ——
      // 试读响应里本来就只有一节，数出来恒为 1，界面会显示"还有 1 节待解锁"。
      // 总节数由提示词规定（见 reading.ts 的 SECTION_TITLES），那是唯一的真相。
      lockedSections: LOCKED_SECTION_COUNT,
      totalSections: SECTION_TITLES.length,
      remaining: 0,
      via: "preview",
    }),
    deviceId,
    isNewDevice
  );
}

/** 把解析出来的小节还原成模型原本的文本格式。 */
function serializeSections(sections: ParsedReading["sections"]): string {
  return sections
    .map((s) => {
      const lines = [`【${s.title}】`];
      if (s.part.verdict) lines.push(`结论：${s.part.verdict}`);
      if (s.part.basis) lines.push(`依据：${s.part.basis}`);
      if (s.part.detail) lines.push(`展开：${s.part.detail}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** 路由里也要 IP 做试读限流 —— quota-guard 的那份没有导出。 */
function clientIpOf(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/**
 * 这次请求能不能拿试读。
 *
 * 只在 quotaGuard 判定为「没付钱」（403 / reason=paid）时才会被调用 ——
 * 熔断与额度耗尽不该再送一次模型调用。
 *
 * 只回答"能不能"，不生成内容：生成要花一次模型调用，得由调用方
 * 拿到肯定答复后再触发，否则会白烧一次。
 */
async function canPreview(req: NextRequest): Promise<boolean> {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existing ?? randomUUID();
  const ipHash = hashIp(clientIpOf(req));

  // 自己验一遍凭证。刻意不复用 quotaGuard 的结果：它在放行路径上会
  // "先占消费台账的坑"，而试读是另一条路径，不该碰那张表。
  const secret = passSecret();
  const raw = req.cookies.get("xj_pass")?.value;
  const ent = secret && raw ? verify(raw, secret, nowSec()) : null;

  let counts;
  try {
    counts = await readPreviewUsage(deviceId, ipHash);
  } catch (err) {
    console.error("试读用量读取失败:", err);
    return false; // 读不到就不放行，退回原来的 403
  }

  const entitlement: AccessEntitlement | null = ent
    ? { member: ent.member, passes: ent.passes.map((p) => ({ m: p.m, n: p.n, e: p.e })) }
    : null;

  if (
    !decidePreview(
      counts,
      entitlement,
      nowSec(),
      PREVIEW_PER_DEVICE_PER_DAY,
      PREVIEW_PER_IP_PER_DAY
    )
  ) {
    return false;
  }

  // 全局熔断再看一眼：decidePreview 只管试读自己的额度，
  // 而 DEEPSEEK_DAILY_BUDGET 是所有模型调用的总闸。
  // counts.global 是"试读 + 正式"两者之和，见 usage-store 的注释。
  return counts.global < dailyGlobalBudget();
}

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

  if (!guard.ok) {
    // 被拦下的请求里，**只有「没付钱」这一类该改成给试读**。
    // 熔断（503）与额度耗尽（429）照旧拒绝 —— 那两种情况说明服务端已经
    // 有压力或这个来源用得太狠，再送一次模型调用只会更糟。
    //
    // guard.response 在被拦时可能已经设在建响应，这里不用它 ——
    // 试读是一条独立路径，自己重新算设备 cookie 更清楚。
    if (
      guard.decision.status === 403 &&
      guard.decision.reason === "paid" &&
      (await canPreview(req))
    ) {
      const preview = await readBazi(checked.input, true);
      if (preview.success) return previewResponse(req, preview);
      // 试读也失败时，把命盘单独回给用户 —— 排盘不依赖模型，不该连盘都看不到。
      // 这里**不记账**：没送出去的东西不该消耗额度。
      return NextResponse.json(
        { success: false, error: preview.error, chart: preview.chart, reason: "preview_failed" },
        { status: 500 }
      );
    }
    return guard.response;
  }

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
