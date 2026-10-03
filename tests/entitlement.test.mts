import test from "node:test";
import assert from "node:assert/strict";
import {
  sign, verify, prune, isMemberActive, grantMember, grantPass, consumePass, toSummary,
  EMPTY_ENTITLEMENT, type Entitlement,
} from "../src/lib/entitlement.ts";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const NOW = 1_700_000_000;
const DAY = 86400;

function member(daysFromNow: number): Entitlement {
  return { v: 1, member: NOW + daysFromNow * DAY, passes: [] };
}

test("签发的凭证能被验回来", () => {
  const ent = member(30);
  const got = verify(sign(ent, SECRET), SECRET, NOW);
  // 签发会补上一个唯一编号，其余字段应原样还原
  assert.ok(got, "验签不应失败");
  assert.equal(got.member, ent.member);
  assert.deepEqual(got.passes, ent.passes);
  assert.match(got.tid ?? "", /^[A-Za-z0-9_-]{16}$/, "应带上 12 字节 base64url 的凭证编号");
});

test("每次签发的编号都不同 —— 台账靠它区分「哪一次授权」", () => {
  const a = verify(sign(member(30), SECRET), SECRET, NOW);
  const b = verify(sign(member(30), SECRET), SECRET, NOW);
  assert.notEqual(a?.tid, b?.tid, "两次签发的 tid 不该相同");
});

test("同一份载荷重复签名会保留已有的编号", () => {
  // 回写 cookie 时传的是已经带 tid 的对象，此时不该换编号 ——
  // 换了的话，服务端台账里那张凭证的消费记录就对不上了
  const ent: Entitlement = { ...member(30), tid: "fixedtokenid0001" };
  const got = verify(sign(ent, SECRET), SECRET, NOW);
  assert.equal(got?.tid, "fixedtokenid0001");
});

test("没有编号的凭证仍能验签（向后兼容旧 cookie）", () => {
  // 旧版本签发的凭证没有 tid。判定层会拒绝用它消费单次券，
  // 但验签本身不该失败 —— 会员权益仍应可用。
  const old = sign({ v: 1, member: NOW + 30 * DAY, passes: [] }, SECRET);
  const got = verify(old, SECRET, NOW);
  assert.ok(got, "旧凭证应仍可验签");
  assert.equal(got.member, NOW + 30 * DAY);
});

test("换一个密钥就验不过", () => {
  const token = sign(member(30), SECRET);
  assert.equal(verify(token, "another-secret-entirely-different!!", NOW), null);
});

test("篡改载荷必须失败", () => {
  const token = sign({ v: 1, member: null, passes: [] }, SECRET);
  const [payload, mac] = token.split(".");
  // 把载荷换成「会员到 2099 年」，签名不动
  const forged = Buffer.from(
    JSON.stringify({ v: 1, member: 4_000_000_000, passes: [] }), "utf8"
  ).toString("base64url");
  assert.equal(verify(`${forged}.${mac}`, SECRET, NOW), null);
  assert.notEqual(forged, payload);
});

test("签名长度不等时返回 null，而不是抛异常", () => {
  // timingSafeEqual 对不等长的 buffer 会直接 throw，必须先比长度
  assert.doesNotThrow(() => verify("abc.def", SECRET, NOW));
  assert.equal(verify("abc.def", SECRET, NOW), null);
});

test("载荷不是合法 JSON 时返回 null", () => {
  const bogus = Buffer.from("not json at all", "utf8").toString("base64url");
  const mac = sign(EMPTY_ENTITLEMENT, SECRET).split(".")[1];
  assert.equal(verify(`${bogus}.${mac}`, SECRET, NOW), null);
});

test("版本号不符时拒绝", () => {
  const wrongVersion = sign({ v: 2, member: NOW + DAY, passes: [] } as unknown as Entitlement, SECRET);
  assert.equal(verify(wrongVersion, SECRET, NOW), null);
});

test("过期的会员不算有效", () => {
  const expired = member(-1);
  assert.equal(isMemberActive(expired, NOW), false);
  assert.equal(verify(sign(expired, SECRET), SECRET, NOW), null, "过期后整份凭证应判无效");
});

test("过期的单次券在 prune 时被剔除", () => {
  const ent: Entitlement = { v: 1, member: null, passes: [{ m: "tarot", n: 1, e: NOW - 1 }] };
  assert.equal(prune(ent, NOW), null);
});

test("grantMember 从现有到期时间接续，而不是从今天重算", () => {
  const renewed = grantMember(member(10), 30, NOW);
  assert.equal(renewed.member, NOW + 10 * DAY + 30 * DAY);
});

test("会员已过期时 grantMember 从现在起算", () => {
  const renewed = grantMember(member(-5), 30, NOW);
  assert.equal(renewed.member, NOW + 30 * DAY);
});

test("合并同模式的券：次数相加，到期取较晚者", () => {
  const first = grantPass(EMPTY_ENTITLEMENT, "tarot", 1, 7, NOW);
  const second = grantPass(first, "tarot", 1, 7, NOW + 3 * DAY);
  assert.equal(second.passes.length, 1);
  assert.equal(second.passes[0].n, 2);
  assert.equal(second.passes[0].e, NOW + 3 * DAY + 7 * DAY);
});

test("不同模式的券互不干扰", () => {
  const a = grantPass(EMPTY_ENTITLEMENT, "tarot", 1, 7, NOW);
  const b = grantPass(a, "bazi", 1, 7, NOW);
  assert.equal(b.passes.length, 2);
});

test("兑换会员不会吞掉已有的单次券", () => {
  const withPass = grantPass(EMPTY_ENTITLEMENT, "tarot", 1, 7, NOW);
  const withMember = grantMember(withPass, 30, NOW);
  assert.equal(withMember.passes.length, 1);
  assert.equal(isMemberActive(withMember, NOW), true);
});

test("消耗到 0 的券被移除，全空时返回 null", () => {
  const one = grantPass(EMPTY_ENTITLEMENT, "tarot", 1, 7, NOW);
  const after = consumePass(one, 0, NOW);
  assert.equal(after, null, "只剩一张券、用掉后整份凭证应消失，调用方据此清 cookie");
});

test("按下标消耗：只扣指定的那一张，不碰同模式的其它券", () => {
  // 台账按 tid:下标 记账，所以必须能精确扣到某一张
  const ent: Entitlement = {
    v: 1,
    member: null,
    passes: [
      { m: "bazi", n: 1, e: NOW + 7 * DAY },
      { m: "bazi", n: 2, e: NOW + 7 * DAY },
    ],
  };
  const after = consumePass(ent, 1, NOW);
  assert.ok(after, "还有券，不该整份消失");
  assert.equal(after.passes.length, 2, "第一张仍是 1 次，未被误扣");
  assert.equal(after.passes[0].n, 1);
  assert.equal(after.passes[1].n, 1, "被指定的第二张从 2 减到 1");
});

test("下标越界时不抛异常，也不能凭空多扣", () => {
  const ent = grantPass(EMPTY_ENTITLEMENT, "bazi", 2, 7, NOW);
  for (const bad of [-1, 5]) {
    const after = consumePass(ent, bad, NOW);
    assert.equal(after?.passes[0].n, 2, `下标 ${bad} 不该扣掉任何一次`);
  }
});

test("消耗会员不产生变化（会员不走消耗路径）", () => {
  const m = member(30);
  assert.deepEqual(consumePass(m, 0, NOW), m);
});

test("toSummary 把内部结构翻译成前端用的形状", () => {
  const ent = grantPass(member(30), "tarot", 2, 7, NOW);
  const s = toSummary(ent, NOW);
  assert.equal(s.member, true);
  assert.equal(s.expiresAt, NOW + 30 * DAY);
  assert.deepEqual(s.passes, [{ mode: "tarot", remaining: 2 }]);
});

test("toSummary 对 null 给出干净的空态", () => {
  assert.deepEqual(toSummary(null, NOW), { member: false, passes: [] });
});
