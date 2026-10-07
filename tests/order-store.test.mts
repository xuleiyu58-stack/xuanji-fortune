/**
 * 订单数据层的行为测试。
 *
 * 这里跑的是**内存兜底路径**（测试环境没有配 Supabase），因为它能完整单测。
 * 关键在于这条路径必须与 supabase/orders.sql 的六个函数逐条同语义 ——
 * 一旦漂移，测试全绿而线上出错，那正是这个模块最容易翻车的地方。
 *
 * 所以下面每一条断言都对应 SQL 里的一条 WHERE 前置条件，而不是随手写的行为。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrder,
  getOrder,
  confirmOrder,
  claimOrderDelivery,
  markCodeIssued,
  unconfirmOrder,
  setPayerRef,
  listRecentOrders,
} from "../src/lib/server/order-store.ts";

const DEV = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

test("建单落 pending，金额原样存下", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  assert.equal(o.status, "pending");
  assert.equal(o.amount, 6.6);
  assert.equal(o.deviceId, DEV);
  assert.equal(o.deliveredAt, null);
  assert.ok(new Date(o.expiresAt).getTime() > Date.now(), "应有未来有效期");
});

test("未付款的订单不能交付权益", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  const claimed = await claimOrderDelivery(o.id, DEV, { v: 1, member: null, passes: [] });
  assert.equal(claimed, null, "pending 单不该能交付");
});

test("确认到账后可交付，且只能交付一次", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  assert.ok(await confirmOrder(o.id, "tester", "alipay"));

  const first = await claimOrderDelivery(o.id, DEV, { v: 1, member: null, passes: [] });
  assert.ok(first, "首次交付应成功");
  assert.ok(first.deliveredAt);

  const second = await claimOrderDelivery(o.id, DEV, { v: 1, member: null, passes: [] });
  assert.equal(second, null, "重复交付必须返回 null —— 这是并发双击的防线");
});

test("别人的设备不能交付我的订单", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  await confirmOrder(o.id, "tester", null);
  const stolen = await claimOrderDelivery(o.id, OTHER, { v: 1, member: null, passes: [] });
  assert.equal(stolen, null);
});

test("确认可作用于已过期订单（用户超时后才付款）", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: -1 });
  assert.equal((await getOrder(o.id))?.status, "pending");
  // ttl 为负 -> 已过期，下一次建单时会把它清掉
  await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  assert.equal((await getOrder(o.id))?.status, "expired");

  const back = await confirmOrder(o.id, "tester", null);
  assert.ok(back, "过期单也必须能被确认 —— 否则付了钱的用户丢单");
  assert.equal(back.status, "paid");
});

test("已交付的订单不许撤销", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  await confirmOrder(o.id, "tester", null);
  await claimOrderDelivery(o.id, DEV, { v: 1, member: null, passes: [] });
  assert.equal(await unconfirmOrder(o.id), null);
});

test("未交付的订单可以撤销，回到 pending", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  await confirmOrder(o.id, "tester", null);
  const undone = await unconfirmOrder(o.id);
  assert.ok(undone);
  assert.equal(undone.status, "pending");
  assert.equal(undone.paidAt, null);
});

test("发码只能一次", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  await confirmOrder(o.id, "tester", null);
  assert.ok(await markCodeIssued(o.id, DEV));
  assert.equal(await markCodeIssued(o.id, DEV), null);
});

test("提交交易单号不改变状态", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  const updated = await setPayerRef(o.id, DEV, "2026100722001", "alipay");
  assert.ok(updated);
  assert.equal(updated.status, "pending", "提交单号不等于到账");
  assert.equal(updated.payerRef, "2026100722001");
});

test("别人的设备不能给我的订单提交单号", async () => {
  const o = await createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
  assert.equal(await setPayerRef(o.id, OTHER, "x", null), null);
});

test("列表按创建时间倒序", async () => {
  const rows = await listRecentOrders(24 * 60 * 60 * 1000);
  assert.ok(rows.length >= 1);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      new Date(rows[i - 1]!.createdAt).getTime() >= new Date(rows[i]!.createdAt).getTime()
    );
  }
});
