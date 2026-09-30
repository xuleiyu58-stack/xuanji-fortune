import test from "node:test";
import assert from "node:assert/strict";
import { decideQuota } from "../src/lib/quota-policy.ts";

const LIMITS = { device: 3, ip: 6, global: 300 };

test("全部未超限时放行", () => {
  assert.equal(decideQuota({ device: 0, ip: 0, global: 0 }, LIMITS).allowed, true);
});

test("恰好差一次时仍然放行", () => {
  assert.equal(decideQuota({ device: 2, ip: 5, global: 299 }, LIMITS).allowed, true);
});

test("设备额度用尽则拒绝，原因是 device", () => {
  const d = decideQuota({ device: 3, ip: 3, global: 10 }, LIMITS);
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.reason, "device");
    assert.match(d.message, /免费次数/);
  }
});

test("设备未超但 IP 超限则拒绝，原因是 ip", () => {
  const d = decideQuota({ device: 1, ip: 6, global: 10 }, LIMITS);
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.reason, "ip");
});

test("全局熔断优先于其它维度", () => {
  // 三个维度同时超限时，必须是 global —— 它才是那个说明"服务整体到顶了"的原因
  const d = decideQuota({ device: 99, ip: 99, global: 300 }, LIMITS);
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.reason, "global");
    assert.match(d.message, /明天/);
  }
});

test("设备与 IP 同时超限时优先报设备", () => {
  const d = decideQuota({ device: 5, ip: 9, global: 50 }, LIMITS);
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.reason, "device");
});

test("拒绝时必须给出可读文案，不能是空串", () => {
  for (const counts of [
    { device: 3, ip: 0, global: 0 },
    { device: 0, ip: 6, global: 0 },
    { device: 0, ip: 0, global: 300 },
  ]) {
    const d = decideQuota(counts, LIMITS);
    assert.equal(d.allowed, false);
    if (!d.allowed) {
      assert.ok(d.message.length > 0, `${d.reason} 的文案是空的`);
      assert.equal(typeof d.message, "string");
    }
  }
});

test("额度为 0 时一律拒绝", () => {
  const zero = { device: 0, ip: 0, global: 0 };
  const d = decideQuota({ device: 0, ip: 0, global: 0 }, zero);
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.reason, "global");
  assert.equal(decideQuota({ device: 0, ip: 0, global: 0 }, { device: 1, ip: 1, global: 1 }).allowed, true);
});
