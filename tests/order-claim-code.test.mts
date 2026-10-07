/**
 * 交易单号（`/api/order/claim`）与兜底发码（`/api/order/code`）的行为测试。
 *
 * 分成两层，理由与 `tests/order-flow.test.mts` 完全一样：**路由文件 import 不了**。
 * 两个路由都 `import { NextRequest, NextResponse } from "next/server"`，而
 * next@14.2.35 的 package.json 没有 `exports` 字段 —— 裸 Node 的 ESM 解析器
 * 解析不出 `node_modules/next/server`（`ERR_MODULE_NOT_FOUND`），loader 也救不了。
 * 所以判定逻辑住在 `src/lib/order-flow.ts`（纯函数、可单测），路由退成适配层。
 *
 * 两层各管一段：
 *   1. **纯函数**：入参该不该拒、这单该不该收单号 / 该不该发码 —— 结论是数据，
 *      能逐条断言（下面「入参判定」「目标判定」两节）。
 *   2. **源码守卫**：路由是适配层，那就钉住"它接对了线、没多干别的" ——
 *      调了哪些函数、顺序如何、有没有出现不该出现的码与动作（「路由适配层」一节）。
 *
 * 真路由的接线由 `tests/order-e2e.mjs`（真 dev server + mock）跑一次端到端验证；
 * 本文件不假装覆盖那一层。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideClaimInput,
  decideClaimTarget,
  decideCodeInput,
  decideCodeTarget,
} from "../src/lib/order-flow.ts";
import { MAX_PAYER_REF_LENGTH } from "../src/lib/validation.ts";
import { PLANS } from "../src/lib/pricing.ts";
import type { OrderRow } from "../src/lib/server/order-store.ts";

const DEV = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const NOW = 1_700_000_000;

const iso = (sec: number) => new Date(sec * 1000).toISOString();

function row(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o-1",
    plan: "bazi",
    amount: 6.6,
    status: "pending",
    provider: null,
    payerRef: null,
    deviceId: DEV,
    granted: null,
    deliveredAt: null,
    codeIssuedAt: null,
    paidAt: null,
    confirmedBy: null,
    createdAt: iso(NOW - 120),
    expiresAt: iso(NOW + 1800),
    ...over,
  };
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.replace(/(^|\s)\/\/\s.*$/, "$1"))
    .join("\n");
}

const routeSource = (rel: string) =>
  stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

const CLAIM_ROUTE = "../src/app/api/order/claim/route.ts";
const CODE_ROUTE = "../src/app/api/order/code/route.ts";

// ── 入参判定：提交交易单号 ────────────────────────────────

test("claim 入参：非对象 → 请求格式不正确（调用方回 400）", () => {
  for (const bad of [null, undefined, 42, "x", [], true]) {
    const d = decideClaimInput(bad);
    assert.equal(d.kind, "invalid", `${JSON.stringify(bad)} 不该被当成合法请求`);
    if (d.kind === "invalid") assert.equal(d.error, "请求格式不正确");
  }
});

test("claim 入参：缺订单号 → 400", () => {
  for (const body of [{}, { orderId: "" }, { orderId: 123 }, { orderId: null }]) {
    const d = decideClaimInput({ ...body, payerRef: "X" });
    assert.equal(d.kind, "invalid");
    if (d.kind === "invalid") assert.equal(d.error, "缺少订单号");
  }
});

test("claim 入参：单号为空或只有空格 → 400，且拒绝理由说清是没填", () => {
  for (const payerRef of ["", "   ", "\t\n"]) {
    const d = decideClaimInput({ orderId: "o-1", payerRef });
    assert.equal(d.kind, "invalid");
    if (d.kind === "invalid") assert.equal(d.error, "请填写交易单号");
  }
});

test("claim 入参：单号两端空白被去掉 —— 存进库的是用户真正填的那串", () => {
  const d = decideClaimInput({ orderId: "o-1", payerRef: "  2026100722001  " });
  assert.equal(d.kind, "ok");
  if (d.kind === "ok") assert.equal(d.payerRef, "2026100722001");
});

test("claim 入参：单号超过上限 → 400，边界值本身放行", () => {
  const atLimit = "A".repeat(MAX_PAYER_REF_LENGTH);
  assert.equal(decideClaimInput({ orderId: "o-1", payerRef: atLimit }).kind, "ok", "恰好等于上限应放行");

  const over = "A".repeat(MAX_PAYER_REF_LENGTH + 1);
  const d = decideClaimInput({ orderId: "o-1", payerRef: over });
  assert.equal(d.kind, "invalid");
  if (d.kind === "invalid") assert.equal(d.error, "交易单号过长");
});

test("claim 入参：渠道只认 alipay / wechat 两个字符串；其它字符串 → 400", () => {
  for (const provider of ["alipay", "wechat"]) {
    assert.equal(
      decideClaimInput({ orderId: "o-1", payerRef: "X", provider }).kind,
      "ok",
      `${provider} 应当被接受`
    );
  }
  // 大小写不对、空串、拼错的渠道名都是"用户声明了一个不存在的渠道" —— 拒绝，
  // 别把它悄悄存成一列对不上账的数据。
  for (const provider of ["paypal", "ALIPAY", "WeChat", ""]) {
    const d = decideClaimInput({ orderId: "o-1", payerRef: "X", provider });
    assert.equal(d.kind, "invalid", `${JSON.stringify(provider)} 不该被接受`);
    if (d.kind === "invalid") assert.equal(d.error, "付款渠道不正确");
  }
});

test("claim 入参：非字符串的渠道按「没提供」处理，而不是报错", () => {
  // 与全站校验的既有口径一致（见 validation.ts：值不是字符串就跳过）。
  // 渠道只是对账用的备注，收到一个畸形值时"当作没填"比"整单拒绝"更合理 ——
  // 用户真正想提交的是那串交易单号。
  for (const provider of [1, true, {}, [], null]) {
    const d = decideClaimInput({ orderId: "o-1", payerRef: "X", provider });
    assert.equal(d.kind, "ok", `${JSON.stringify(provider)} 应按未提供处理`);
    if (d.kind === "ok") assert.equal(d.provider, null);
  }
});

test("claim 入参：省略渠道 → provider 为 null（不逼用户选，也不猜）", () => {
  const d = decideClaimInput({ orderId: "o-1", payerRef: "X" });
  assert.equal(d.kind, "ok");
  if (d.kind === "ok") assert.equal(d.provider, null);
});

// ── 入参判定：取激活码 ───────────────────────────────────

test("code 入参：非对象 → 400；缺订单号 → 400", () => {
  for (const bad of [null, 42, "x", []]) {
    const d = decideCodeInput(bad);
    assert.equal(d.kind, "invalid");
    if (d.kind === "invalid") assert.equal(d.error, "请求格式不正确");
  }
  for (const body of [{}, { orderId: "" }, { orderId: 7 }]) {
    const d = decideCodeInput(body);
    assert.equal(d.kind, "invalid");
    if (d.kind === "invalid") assert.equal(d.error, "缺少订单号");
  }
});

test("code 入参：合法订单号原样取出", () => {
  const d = decideCodeInput({ orderId: "o-1" });
  assert.equal(d.kind, "ok");
  if (d.kind === "ok") assert.equal(d.orderId, "o-1");
});

// ── 目标判定：提交交易单号 ────────────────────────────────
//
// 行为 1 的前半段：pending 单可以提交单号（`ok`），路由据此调 setPayerRef。
// 注意判定**不改变状态** —— 状态只在 setPayerRef 里写 payer_ref / provider。

test("行为1 claim 目标：pending 且是本设备 → ok（可以提交单号）", () => {
  const d = decideClaimTarget(row({ status: "pending" }), DEV);
  assert.equal(d.kind, "ok");
  if (d.kind === "ok") assert.equal(d.order.id, "o-1", "把订单带出来给路由用，省一次 null 断言");
});

test("行为2 claim 目标：别人的设备提交单号 → not_found（调用方回 404，不是 403）", () => {
  const d = decideClaimTarget(row(), OTHER);
  assert.equal(d.kind, "not_found");
});

test("行为2 claim 目标：没有设备号 → not_found（不能确认订单号是否存在）", () => {
  assert.equal(decideClaimTarget(row(), undefined).kind, "not_found");
});

test("claim 目标：订单不存在 → not_found", () => {
  assert.equal(decideClaimTarget(null, DEV).kind, "not_found");
});

test("claim 目标：订单上的 device_id 为空 → not_found（设备不匹配的一种）", () => {
  assert.equal(decideClaimTarget(row({ deviceId: null }), DEV).kind, "not_found");
});

test("claim 目标：非 pending（已到账 / 已过期）→ not_pending（调用方回 400）", () => {
  for (const status of ["paid", "expired"] as const) {
    const d = decideClaimTarget(row({ status }), DEV);
    assert.equal(d.kind, "not_pending", `${status} 不该还能提交单号`);
  }
});

// ── 目标判定：取激活码 ───────────────────────────────────

test("行为3 code 目标：未付款订单 → not_paid（调用方回 400）", () => {
  for (const status of ["pending", "expired"] as const) {
    const d = decideCodeTarget(row({ status }), DEV);
    assert.equal(d.kind, "not_paid", `${status} 不该能取码`);
  }
});

test("行为4 code 目标：已到账订单 → ok，且带出该单的套餐", () => {
  const d = decideCodeTarget(row({ status: "paid", plan: "member_year" }), DEV);
  assert.equal(d.kind, "ok");
  if (d.kind === "ok") {
    assert.equal(d.order.id, "o-1");
    assert.equal(d.plan, PLANS.member_year, "套餐要原样带出，发码时按它决定 kind/mode/days");
  }
});

test("行为4 code 目标：别人的设备取码 → not_found（404，不是 403）", () => {
  assert.equal(decideCodeTarget(row({ status: "paid" }), OTHER).kind, "not_found");
});

test("code 目标：没有设备号 / 订单不存在 → not_found", () => {
  assert.equal(decideCodeTarget(row({ status: "paid" }), undefined).kind, "not_found");
  assert.equal(decideCodeTarget(null, DEV).kind, "not_found");
});

test("code 目标：订单指向未知套餐 → unknown_plan（调用方回 400）", () => {
  // 库里的 plan 只可能由服务端从 PLANS 快照下来，所以这是个异常值。
  assert.equal(decideCodeTarget(row({ status: "paid", plan: "tarot" }), DEV).kind, "unknown_plan");
});

// ── 纯函数本身 ───────────────────────────────────────────

test("四个判定都不修改入参（纯函数）", () => {
  const order = Object.freeze(row({ status: "paid" }));
  const body = Object.freeze({ orderId: "o-1", payerRef: " X ", provider: "wechat" });
  const before = JSON.stringify({ order, body });

  decideClaimInput(body);
  decideCodeInput(body);
  decideClaimTarget(order, DEV);
  decideCodeTarget(order, DEV);

  assert.equal(JSON.stringify({ order, body }), before, "入参被改过了");
});

// ── 路由适配层：接对了线、没多干别的 ──────────────────────
//
// 路由 import 不了（见文件头），所以这一层用源码守卫钉住。它挡不住"实现改了
// 但名字还在"的假通过，因此配合 `tests/order-e2e.mjs` 的真路由端到端一起看。

test("claim 路由：判定交给 order-flow，写库交给 setPayerRef", () => {
  const src = routeSource(CLAIM_ROUTE);
  assert.match(src, /decideClaimInput\(/, "入参判定必须交给 order-flow（路由里写判定就等于不可测）");
  assert.match(src, /decideClaimTarget\(/, "目标判定必须交给 order-flow");
  assert.match(src, /setPayerRef\(/, "写 payer_ref 只能走 order-store 的 setPayerRef");
});

test("claim 路由：越权一律 404，不得出现 403 —— 403 等于确认订单号存在", () => {
  assert.doesNotMatch(routeSource(CLAIM_ROUTE), /status:\s*403/, "claim 路由不该出现 403");
});

test("claim 路由：提交单号不签发任何权益 —— 它不含解锁语义", () => {
  // 提交交易单号既不是"到账"也不是"开通"，所以这里连签发凭证的调用都不该有。
  const src = routeSource(CLAIM_ROUTE);
  assert.doesNotMatch(src, /withPassCookie\(/, "claim 与权益无关，不该写凭证");
  assert.doesNotMatch(src, /grantPass\(|grantMember\(/, "claim 不得自己造权益");
});

test("claim 路由：文案说清「提交≠到账」，不能让用户以为付完就开通了", () => {
  // 这正是全局约束点名的那句：写成「已提交，稍后开通」会让用户以为付完就完事了，
  // 然后回来发现没开通 —— 比不提交更糟。
  const src = routeSource(CLAIM_ROUTE);
  assert.match(src, /核对到账后会为你开通/, "文案必须写明是「我们核对到账后」才开通");
});

test("code 路由：判定交给 order-flow，发码权交给 markCodeIssued，造码交给 mintCode", () => {
  const src = routeSource(CODE_ROUTE);
  assert.match(src, /decideCodeInput\(/);
  assert.match(src, /decideCodeTarget\(/);
  assert.match(src, /markCodeIssued\(/, "发码权必须由数据库的原子抢占决定");
  assert.match(src, /mintCode\(/, "码只能由 codes.ts 的 mintCode 铸 —— 全站唯一发码处");
  assert.doesNotMatch(src, /randomBytes/, "路由不得自己铸码（那就是第二份发码逻辑）");
});

test("code 路由：先抢占发码权，再写码 —— 顺序反了就等于一次付款开两台设备", () => {
  const src = routeSource(CODE_ROUTE);
  const iClaim = src.indexOf("await markCodeIssued(");
  const iInsert = src.indexOf('from("redeem_codes")');
  assert.ok(iClaim >= 0, "未调用 markCodeIssued");
  assert.ok(iInsert >= 0, "未写入 redeem_codes");
  assert.ok(iClaim < iInsert, "必须先抢占发码权再写码，否则重复点会变出第二个码");
  assert.match(src, /if \(!claimed\)/, "抢占失败必须拒绝，不能继续写码");
});

test("code 路由：越权一律 404，不得出现 403", () => {
  assert.doesNotMatch(routeSource(CODE_ROUTE), /status:\s*403/, "code 路由不该出现 403");
});

test("code 路由：写码失败要撤回 code_issued_at，否则用户再也拿不到码", () => {
  // 发码权用掉了、码没写进库，不撤标记用户就再也没有机会 —— 这是刻意的设计，
  // 守卫钉住它，防止有人"顺手"把这段删掉当成清理死代码。
  const src = routeSource(CODE_ROUTE);
  assert.match(src, /code_issued_at:\s*null/, "写码失败必须撤回发码标记以便重试");
  assert.match(src, /23505/, "只有主键冲突（撞码）才重试；其它错误一律撤回并回 503");
});
