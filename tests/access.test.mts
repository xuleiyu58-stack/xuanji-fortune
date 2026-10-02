import test from "node:test";
import assert from "node:assert/strict";
import { decideAccess, type AccessEntitlement } from "../src/lib/access.ts";

const LIMITS = { device: 3, ip: 6, global: 300 };
const NOW = 1_700_000_000;
const DAY = 86400;
const NONE: AccessEntitlement | null = null;

const MEMBER: AccessEntitlement = { member: NOW + 30 * DAY, passes: [] };
const EXPIRED_MEMBER: AccessEntitlement = { member: NOW - 1, passes: [] };
const TAROT_PASS: AccessEntitlement = { member: null, passes: [{ m: "tarot", n: 1, e: NOW + 7 * DAY }] };
const SPENT_PASS: AccessEntitlement = { member: null, passes: [{ m: "tarot", n: 0, e: NOW + 7 * DAY }] };
const EXPIRED_PASS: AccessEntitlement = { member: null, passes: [{ m: "tarot", n: 1, e: NOW - 1 }] };

// ── 迁移自 quota-policy.test.mts ──────────────────────────────

test("全部未超限时放行", () => {
  const d = decideAccess("daily", { device: 0, ip: 0, global: 0 }, LIMITS, NONE, true, NOW);
  assert.equal(d.allow, true);
  if (d.allow) assert.equal(d.consume, "quota");
});

test("恰好差一次时仍然放行", () => {
  const d = decideAccess("daily", { device: 2, ip: 5, global: 299 }, LIMITS, NONE, true, NOW);
  assert.equal(d.allow, true);
});

test("设备额度用尽则拒绝，原因是 device", () => {
  const d = decideAccess("daily", { device: 3, ip: 3, global: 10 }, LIMITS, NONE, true, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) {
    assert.equal(d.reason, "device");
    assert.equal(d.status, 429);
    assert.match(d.message, /免费次数/);
  }
});

test("设备未超但 IP 超限则拒绝，原因是 ip", () => {
  const d = decideAccess("daily", { device: 1, ip: 6, global: 10 }, LIMITS, NONE, true, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.reason, "ip");
});

test("全局熔断优先于其它维度", () => {
  const d = decideAccess("daily", { device: 99, ip: 99, global: 300 }, LIMITS, NONE, true, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) {
    assert.equal(d.reason, "global");
    assert.equal(d.status, 503);
    assert.match(d.message, /明天/);
  }
});

test("设备与 IP 同时超限时优先报设备", () => {
  const d = decideAccess("daily", { device: 5, ip: 9, global: 50 }, LIMITS, NONE, true, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.reason, "device");
});

test("拒绝时必须给出可读文案，不能是空串", () => {
  const cases: [string, AccessEntitlement | null, boolean][] = [
    ["daily", NONE, true],
    ["bazi", NONE, false],
  ];
  for (const [mode, ent, isFree] of cases) {
    for (const counts of [
      { device: 3, ip: 0, global: 0 },
      { device: 0, ip: 6, global: 0 },
      { device: 0, ip: 0, global: 300 },
    ]) {
      const d = decideAccess(mode, counts, LIMITS, ent, isFree, NOW);
      assert.equal(d.allow, false);
      if (!d.allow) {
        assert.ok(d.message.length > 0, `${d.reason} 的文案是空的`);
        assert.equal(typeof d.message, "string");
      }
    }
  }
});

test("额度为 0 时一律拒绝", () => {
  const zero = { device: 0, ip: 0, global: 0 };
  const d = decideAccess("daily", { device: 0, ip: 0, global: 0 }, zero, NONE, true, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.reason, "global");
});

// ── 凭证分支 ──────────────────────────────────────────────

test("会员放行且不消耗任何额度", () => {
  const d = decideAccess("bazi", { device: 99, ip: 99, global: 5 }, LIMITS, MEMBER, false, NOW);
  assert.equal(d.allow, true);
  if (d.allow) assert.equal(d.consume, "none", "会员不扣额度，也不消耗单次券");
});

test("会员用免费模式同样不扣额度", () => {
  const d = decideAccess("daily", { device: 0, ip: 0, global: 0 }, LIMITS, MEMBER, true, NOW);
  assert.equal(d.allow, true);
  if (d.allow) assert.equal(d.consume, "none");
});

test("过期的会员不算会员", () => {
  const d = decideAccess("bazi", { device: 0, ip: 0, global: 0 }, LIMITS, EXPIRED_MEMBER, false, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.reason, "paid");
});

test("单次券放行并要求消耗一次", () => {
  const d = decideAccess("tarot", { device: 99, ip: 99, global: 5 }, LIMITS, TAROT_PASS, false, NOW);
  assert.equal(d.allow, true);
  if (d.allow) assert.deepEqual(d.consume, { mode: "tarot" });
});

test("单次券不影响其它模式", () => {
  const d = decideAccess("bazi", { device: 0, ip: 0, global: 0 }, LIMITS, TAROT_PASS, false, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.reason, "paid");
});

test("用完的券与过期的券都不放行", () => {
  for (const ent of [SPENT_PASS, EXPIRED_PASS]) {
    const d = decideAccess("tarot", { device: 0, ip: 0, global: 0 }, LIMITS, ent, false, NOW);
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "paid");
  }
});

test("付费模式不再吃免费额度（未持凭证一律 403）", () => {
  // 此前 bazi/tarot/love 在服务端能白嫖 3 次/日 —— 那时判定不看 mode
  for (const mode of ["bazi", "tarot", "love"]) {
    const d = decideAccess(mode, { device: 0, ip: 0, global: 0 }, LIMITS, NONE, false, NOW);
    assert.equal(d.allow, false, `${mode} 不该在未激活时放行`);
    if (!d.allow) {
      assert.equal(d.status, 403);
      assert.equal(d.reason, "paid");
    }
  }
});

test("全局熔断对会员同样生效", () => {
  // 这道闸保护的是 API 账单，不是公平性 —— 会员也不能把它绕过去
  const d = decideAccess("bazi", { device: 0, ip: 0, global: 300 }, LIMITS, MEMBER, false, NOW);
  assert.equal(d.allow, false);
  if (!d.allow) {
    assert.equal(d.reason, "global");
    assert.equal(d.status, 503);
  }
});
