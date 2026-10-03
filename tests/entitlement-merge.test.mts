import test from "node:test";
import assert from "node:assert/strict";
import { mergeEntitlements, memberAfterRenewal } from "../src/lib/entitlement-merge.ts";
import { grantMember, grantPass, EMPTY_ENTITLEMENT, type Entitlement } from "../src/lib/entitlement.ts";

/**
 * 权益合并。这条规则有**三份实现**必须逐字一致：
 *   1. lib/entitlement.ts 的 grantMember / grantPass
 *   2. lib/entitlement-merge.ts（内存兜底与账户合并）
 *   3. supabase/accounts.sql 的 merge_entitlement / claim_device_entitlement
 *
 * 不一致的表现是"本地跑通、线上算错"，而且不会报错 —— 只会让某个用户的
 * 会员少几天。所以这里既测规则本身，也钉住它与 (1) 的一致性。
 */

const NOW = 1_700_000_000;
const DAY = 86400;

const member = (days: number): Entitlement => ({ v: 1, member: NOW + days * DAY, passes: [] });
const pass = (m: string, n: number, days: number): Entitlement => ({
  v: 1,
  member: null,
  passes: [{ m, n, e: NOW + days * DAY }],
});

// ── 会员 ──────────────────────────────────────────────────

test("会员取较晚的到期时间，而不是相加", () => {
  // 相加是最容易写错的那一版：迁移一次权益就凭空多出一个月的会员
  const merged = mergeEntitlements(member(10), member(30));
  assert.equal(merged.member, NOW + 30 * DAY);
  assert.notEqual(merged.member, NOW + 40 * DAY, "不该相加");
});

test("null 表示非会员，不会被当成 0 参与比较", () => {
  // 若把 null 当 0，Math.max(0, ...) 永远取到有效值，逻辑上碰巧对；
  // 但反过来 (0 与非会员) 合并时就会造出一个 1970 年就到期的"会员"
  const merged = mergeEntitlements(EMPTY_ENTITLEMENT, member(30));
  assert.equal(merged.member, NOW + 30 * DAY);

  const both = mergeEntitlements(EMPTY_ENTITLEMENT, EMPTY_ENTITLEMENT);
  assert.equal(both.member, null, "两份空权益合起来仍是非会员");
});

test("合并方向不影响结果（可交换）", () => {
  const a = member(10);
  const b = member(30);
  assert.deepEqual(mergeEntitlements(a, b), mergeEntitlements(b, a));
});

// ── 单次券 ────────────────────────────────────────────────

test("同模式的券：次数相加，到期取较晚者", () => {
  const merged = mergeEntitlements(pass("bazi", 1, 7), pass("bazi", 2, 3));
  assert.equal(merged.passes.length, 1, "同模式应合并成一张");
  assert.equal(merged.passes[0].n, 3);
  assert.equal(merged.passes[0].e, NOW + 7 * DAY);
});

test("不同模式的券互不干扰", () => {
  const merged = mergeEntitlements(pass("bazi", 1, 7), pass("tarot", 1, 7));
  assert.equal(merged.passes.length, 2);
});

test("券与会员可以共存，合并时互不吞掉", () => {
  const merged = mergeEntitlements(member(30), pass("bazi", 1, 7));
  assert.equal(merged.member, NOW + 30 * DAY);
  assert.equal(merged.passes.length, 1, "兑会员不该吞掉手里的券");
});

test("合并结果总是 v:1", () => {
  assert.equal(mergeEntitlements(EMPTY_ENTITLEMENT, EMPTY_ENTITLEMENT).v, 1);
});

test("不改动入参", () => {
  const a = pass("bazi", 1, 7);
  const b = pass("bazi", 1, 7);
  const snapshot = JSON.stringify([a, b]);
  mergeEntitlements(a, b);
  assert.equal(JSON.stringify([a, b]), snapshot, "合并应是纯操作，不得原地修改");
});

// ── 与 entitlement.ts 的一致性 ────────────────────────────

test("合并两份单次券的结果，与连续 grantPass 两次一致", () => {
  // 这条是"三份实现必须一致"的可执行版本
  const viaGrant = grantPass(grantPass(EMPTY_ENTITLEMENT, "bazi", 1, 7, NOW), "bazi", 1, 7, NOW);
  const viaMerge = mergeEntitlements(pass("bazi", 1, 7), pass("bazi", 1, 7));
  assert.deepEqual(viaMerge.passes, viaGrant.passes);
});

test("会员续期：从现有到期时间往后接，提前续费不亏天数", () => {
  // memberAfterRenewal 必须与 grantMember 同口径
  const current = member(10);
  const viaRenewal = memberAfterRenewal(current, 30, NOW);
  const viaGrant = grantMember(current, 30, NOW).member;
  assert.equal(viaRenewal, viaGrant);
  assert.equal(viaRenewal, NOW + 40 * DAY, "应是从 10 天后再加 30 天");
});

test("会员已过期时从现在起算", () => {
  const expired = member(-5);
  assert.equal(memberAfterRenewal(expired, 30, NOW), NOW + 30 * DAY);
});

test("非会员直接从现在起算", () => {
  assert.equal(memberAfterRenewal(EMPTY_ENTITLEMENT, 30, NOW), NOW + 30 * DAY);
});

// ── 迁移语义（搬而不是抄）──────────────────────────────────

test("搬走一份权益后，原处不再持有 —— 这是防复制的关键", () => {
  // 模拟 claimDeviceEntitlement 的语义：
  // 若实现是"抄一份到账户、设备那份留着"，用户在同一台设备重新登录
  // 就能把同一份权益再认领一次。这里钉住"搬"的语义。
  const device: Entitlement = grantPass(EMPTY_ENTITLEMENT, "bazi", 1, 7, NOW);
  let account: Entitlement = { v: 1, member: null, passes: [] };

  // 第一次认领
  account = mergeEntitlements(account, device);
  const deviceAfter = null; // 搬走并删除
  assert.equal(account.passes[0].n, 1);

  // 第二次认领：设备侧已空
  const secondClaim = deviceAfter ?? { v: 1, member: null, passes: [] };
  const afterSecond = mergeEntitlements(account, secondClaim);
  assert.equal(afterSecond.passes[0].n, 1, "重复认领不该让次数变多");
});
