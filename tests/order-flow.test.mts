/**
 * 订单状态判定的行为测试。
 *
 * 这里跑的是**纯函数**（`src/lib/order-flow.ts`），不是路由 —— 路由文件
 * import 了 `next/server`，而 next@14.2.35 的 package.json 没有 `exports`
 * 字段，裸 Node 的 ESM 解析器连 `node_modules/next/server` 都找不到
 * （`ERR_MODULE_NOT_FOUND`）。任何 import 路由文件的测试都跑不起来，
 * 所以判定必须住在 lib 里，路由退成适配层。本文件本身能跑起来就是那件事的证据。
 *
 * 六个分支一一对应 brief 里列的那六条，测试名直接写明是哪一条。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMPTY_ENTITLEMENT, type Entitlement } from "../src/lib/entitlement.ts";
import { PLANS } from "../src/lib/pricing.ts";
import {
  OrderFlowError,
  decideOrderStatus,
  entitlementFor,
  isConfirmable,
} from "../src/lib/order-flow.ts";
import type { OrderRow } from "../src/lib/server/order-store.ts";

const DEV = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const NOW = 1_700_000_000;
const DAY = 86400;

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/** 一条已到账（paid）、尚未交付的订单。各分支只覆盖自己关心的字段。 */
function row(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o-1",
    plan: "bazi",
    amount: 6.6,
    status: "paid",
    provider: null,
    payerRef: null,
    deviceId: DEV,
    granted: null,
    deliveredAt: null,
    codeIssuedAt: null,
    paidAt: iso(NOW - 60),
    confirmedBy: "tester",
    createdAt: iso(NOW - 120),
    expiresAt: iso(NOW + 1800),
    ...over,
  };
}

/** 请求里带着的、已验签的权益。 */
const CARRY: Entitlement = {
  v: 1,
  tid: "carried-1",
  member: null,
  passes: [{ m: "bazi", n: 1, e: NOW + DAY }],
};

/** 交付时存进 `orders.granted` 的权益快照。 */
const SNAP: Entitlement = {
  v: 1,
  tid: "granted-1",
  member: null,
  passes: [{ m: "bazi", n: 1, e: NOW + 7 * DAY }],
};

/** 已交付的订单：delivered_at 与 granted 由同一条 UPDATE 一起写下。 */
const DELIVERED = { deliveredAt: iso(NOW - 30), granted: SNAP };

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// ── 分支 1：not_found ────────────────────────────────────

test("分支1 订单不存在 → not_found（调用方回 404）", () => {
  const d = decideOrderStatus({ order: null, deviceId: DEV, carried: null, nowSec: NOW });
  assert.equal(d.kind, "not_found");
});

test("分支1 请求不带设备号 → not_found（不能确认订单号是否存在）", () => {
  const d = decideOrderStatus({ order: row(), deviceId: undefined, carried: null, nowSec: NOW });
  assert.equal(d.kind, "not_found");
});

test("分支1 别人的设备查我的订单 → not_found，而不是 403", () => {
  // 403 等于告诉对方"这个订单号存在"，那就是一台订单探测器。
  const d = decideOrderStatus({ order: row(), deviceId: OTHER, carried: null, nowSec: NOW });
  assert.equal(d.kind, "not_found");
});

test("分支1 订单上的 device_id 为空 → not_found", () => {
  const d = decideOrderStatus({
    order: row({ deviceId: null }),
    deviceId: DEV,
    carried: null,
    nowSec: NOW,
  });
  assert.equal(d.kind, "not_found");
});

// ── 分支 2：unpaid ───────────────────────────────────────

test("分支2 未到账（pending/expired）→ unpaid，只回状态、不碰权益", () => {
  for (const status of ["pending", "expired"] as const) {
    const d = decideOrderStatus({
      order: row({ status }),
      deviceId: DEV,
      carried: null,
      nowSec: NOW,
    });
    assert.equal(d.kind, "unpaid", `${status} 不该被当成已到账`);
    if (d.kind === "unpaid") assert.equal(d.status, status, "状态要原样回给前端");
  }
});

test("分支2 未到账时不因为缺少权益快照而抛错", () => {
  // granted 为空是未交付订单的正常形态，只有"已交付却缺快照"才算数据异常。
  const d = decideOrderStatus({
    order: row({ status: "pending", granted: null }),
    deviceId: DEV,
    carried: null,
    nowSec: NOW,
  });
  assert.equal(d.kind, "unpaid");
});

// ── 分支 3：已交付 + 不带凭证 → 用快照重签 ────────────────

test("分支3 已交付、请求完全不带凭证 → 用订单上的快照重签", () => {
  // 响应在网络上丢了的那种情况：cookie 没落到浏览器里，而订单已标记交付。
  const d = decideOrderStatus({ order: row(DELIVERED), deviceId: DEV, carried: null, nowSec: NOW });
  assert.equal(d.kind, "delivered");
  if (d.kind === "delivered") assert.deepEqual(d.reissue, SNAP);
});

// ── 分支 4：已交付 + 带凭证 → 什么都不做 ──────────────────

test("分支4 已交付、请求带着凭证 → 不重签（否则会把已用掉的券复活）", () => {
  const d = decideOrderStatus({ order: row(DELIVERED), deviceId: DEV, carried: CARRY, nowSec: NOW });
  assert.equal(d.kind, "delivered");
  if (d.kind === "delivered") assert.equal(d.reissue, null);
});

test("分支4 带着凭证但没有 granted 快照时也不重签、不抛错", () => {
  // 携带凭证时快照根本用不上，所以"缺快照"在这一支里不该变成 500。
  const order = row({ deliveredAt: iso(NOW - 30), granted: null });
  const d = decideOrderStatus({ order, deviceId: DEV, carried: CARRY, nowSec: NOW });
  assert.equal(d.kind, "delivered");
  if (d.kind === "delivered") assert.equal(d.reissue, null);
});

// ── 分支 5：已交付却无快照 → 抛错（调用方回 500）──────────

test("分支5 已交付却没有权益快照 → 抛错，调用方回 500", () => {
  // delivered_at 与 granted 由同一条 UPDATE 一起写，不该只有一个。真到了
  // 说明数据被库外的东西改过 —— 不能重签（不知道签什么），也不能假装没事。
  const order = row({ deliveredAt: iso(NOW - 30), granted: null });
  assert.throws(
    () => decideOrderStatus({ order, deviceId: DEV, carried: null, nowSec: NOW }),
    (err: unknown) => err instanceof OrderFlowError && err.http === 500
  );
});

// ── 分支 6：已到账未交付 → claim ─────────────────────────

test("分支6 已到账、未交付 → claim：该尝试抢占", () => {
  const d = decideOrderStatus({ order: row(), deviceId: DEV, carried: null, nowSec: NOW });
  assert.equal(d.kind, "claim");
  if (d.kind === "claim") {
    assert.equal(d.entitlement.passes.length, 1);
    assert.equal(d.entitlement.passes[0]?.m, "bazi");
    assert.equal(d.entitlement.passes[0]?.n, 1);
    assert.equal(d.entitlement.member, null);
    assert.ok(d.entitlement.tid, "签发前必须先有编号");
  }
});

test("分支6 claim 的权益叠加在请求现有凭证之上，不是覆盖", () => {
  const d = decideOrderStatus({ order: row(), deviceId: DEV, carried: CARRY, nowSec: NOW });
  assert.equal(d.kind, "claim");
  if (d.kind === "claim") {
    assert.equal(d.entitlement.passes[0]?.n, 2, "手里已有的券不该被新买的冲掉");
    assert.equal(d.entitlement.member, null);
  }
});

test("分支6 会员单 claim 出的是会员权益", () => {
  const d = decideOrderStatus({
    order: row({ plan: "member_year" }),
    deviceId: DEV,
    carried: null,
    nowSec: NOW,
  });
  assert.equal(d.kind, "claim");
  if (d.kind === "claim") assert.equal(d.entitlement.member, NOW + PLANS.member_year.days * DAY);
});

test("分支6 订单指向未知计划 → 抛错，调用方回 400", () => {
  // 库里的 plan 只可能由服务端从 PLANS 快照下来，所以这是个异常值。
  assert.throws(
    () => decideOrderStatus({ order: row({ plan: "tarot" }), deviceId: DEV, carried: null, nowSec: NOW }),
    (err: unknown) => err instanceof OrderFlowError && err.http === 400
  );
});

// ── 抢占是数据库的事：纯函数判不了，路由要重判 ─────────────

test("抢占失败后重判（订单已被并发请求交付）→ 走 delivered 分支", () => {
  // 纯函数说"该尝试抢占"，路由拿 claimOrderDelivery 去抢；抢不到说明订单
  // 在两次读之间被别人交付了，重读订单再判一次，这时必须落在 delivered 上。
  const first = decideOrderStatus({ order: row(), deviceId: DEV, carried: null, nowSec: NOW });
  assert.equal(first.kind, "claim");

  const fresh = row(DELIVERED);
  const again = decideOrderStatus({ order: fresh, deviceId: DEV, carried: null, nowSec: NOW });
  assert.equal(again.kind, "delivered");
  if (again.kind === "delivered") assert.deepEqual(again.reissue, SNAP);
});

// ── entitlementFor ───────────────────────────────────────

test("entitlementFor：会员走 grantMember，单次走 grantPass", () => {
  const member = entitlementFor(PLANS.member_month, EMPTY_ENTITLEMENT, NOW);
  assert.equal(member.member, NOW + PLANS.member_month.days * DAY);
  assert.deepEqual(member.passes, [], "会员单不该顺手发券");

  const single = entitlementFor(PLANS.bazi, EMPTY_ENTITLEMENT, NOW);
  assert.equal(single.member, null, "单次单不该顺手发会员");
  assert.equal(single.passes.length, 1);
  assert.equal(single.passes[0]?.m, "bazi");
  assert.equal(single.passes[0]?.n, 1);
  assert.equal(single.passes[0]?.e, NOW + PLANS.bazi.days * DAY);
});

test("entitlementFor 在现有凭证上续期 / 叠加，而不是覆盖", () => {
  const member = entitlementFor(PLANS.member_year, CARRY, NOW);
  assert.equal(member.passes.length, 1, "兑会员不该吞掉手里那张券");
  assert.ok((member.member ?? 0) > NOW);

  const single = entitlementFor(PLANS.bazi, CARRY, NOW);
  assert.equal(single.passes[0]?.n, 2, "同模式的券应当叠加");
  assert.equal(single.member, null);
});

test("entitlementFor 的输出必定带 tid —— 服务端台账靠它记账", () => {
  for (const plan of [PLANS.bazi, PLANS.member_month, PLANS.member_year]) {
    const ent = entitlementFor(plan, EMPTY_ENTITLEMENT, NOW);
    assert.ok(
      typeof ent.tid === "string" && ent.tid.length > 0,
      `${plan.id} 的输出没有 tid：台账的键会退化成所有券共用的 undefined:0:1`
    );
  }
});

// ── 纯函数本身 ───────────────────────────────────────────

test("decideOrderStatus 不修改入参（纯函数）", () => {
  const order = Object.freeze(row());
  const carried = Object.freeze({
    v: 1 as const,
    tid: "carried-2",
    member: null,
    passes: [{ m: "bazi", n: 1, e: NOW + DAY }],
  });
  const before = JSON.stringify({ order, carried });

  const d = decideOrderStatus({
    order,
    deviceId: DEV,
    carried: carried as Entitlement,
    nowSec: NOW,
  });

  assert.equal(d.kind, "claim");
  assert.equal(JSON.stringify({ order, carried }), before, "入参被改过了");
});

test("同样的输入永远得到同样的结论（判定不夹带时钟或别的隐藏状态）", () => {
  // 用一份**已有编号**的凭证：没有编号时 withTid() 会现铸一个新号（那是它的职责），
  // 所以那一支本来就不该逐位相同。要钉的是判定自身不看时钟、不看隐藏状态。
  const input = { order: row(), deviceId: DEV, carried: CARRY, nowSec: NOW };
  assert.deepEqual(decideOrderStatus(input), decideOrderStatus(input));
  assert.deepEqual(decideOrderStatus(input), decideOrderStatus({ ...input }));
});

// ── isConfirmable：与 orders.sql 的 confirm_order 同口径 ──

test("isConfirmable：pending 与 expired 可确认，paid 不可", () => {
  // 对应 confirm_order 的 `where status in ('pending','expired')`：
  // 用户超时后才付款，单已过期但钱真到了，允许确认把它复活才不会丢单。
  assert.equal(isConfirmable("pending"), true);
  assert.equal(isConfirmable("expired"), true);
  assert.equal(isConfirmable("paid"), false);
  assert.equal(isConfirmable("unknown"), false);
});

// ── 架构：判定必须在 lib 里，路由只能是适配层 ──────────────

test("order-flow 零 next/* 依赖 —— 引入就再也测不了了", () => {
  // next@14.2.35 没有 exports 字段，裸 node 解析不了 node_modules/next/server。
  // 这条断言是上一轮翻车的现场留痕：判定一旦搬回路由，本文件就会
  // ERR_MODULE_NOT_FOUND。本文件能跑起来本身就是另一半证据。
  const src = stripComments(
    readFileSync(new URL("../src/lib/order-flow.ts", import.meta.url), "utf8")
  );
  assert.doesNotMatch(src, /from\s+["']next\//, "order-flow 不得 import next/*");
  assert.doesNotMatch(src, /require\(["']next\//, "order-flow 不得 require next/*");
});

test("轮询路由不自己算权益 —— 它只负责把凭证凑齐交给判定", () => {
  const route = stripComments(
    readFileSync(new URL("../src/app/api/order/status/route.ts", import.meta.url), "utf8")
  );
  assert.match(route, /decideOrderStatus\(/, "判定必须交给 order-flow");
  assert.match(route, /claimOrderDelivery\(/, "抢占必须由数据库的原子操作决定");
  assert.doesNotMatch(route, /grantMember\(|grantPass\(/, "权益计算属于 order-flow，路由不得自己造");
  // 越权与不存在一律 404；403 等于确认"这个订单号存在"。
  assert.doesNotMatch(route, /status:\s*403/, "轮询路由不该出现 403 —— 那是订单探测器");
});
