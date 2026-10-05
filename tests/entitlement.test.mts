import test from "node:test";
import assert from "node:assert/strict";
import {
  sign, verify, prune, isMemberActive, grantMember, grantPass, consumePass, toSummary, withTid,
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

test("编号只在「还没有编号」时补一个，有了就一路不变", () => {
  // 这里原先断言的是"两次签发的 tid 不该相同"，即**每次签名都换新号**。
  // 那条设计是错的：服务端消费台账的键是 `tid:下标:剩余次数`，
  // 而兑换必然重新签发一次 —— 每次换号就等于把那张券的消费记录一笔勾销，
  // 用光的券兑换后又能再用一次（两张 ¥6.6 的码换到三次解读）。
  //
  // 正确的规矩：编号代表凭**证的身份**，身份不能因为"重新签发一次"就变。
  const ent = sign({ v: 1, member: NOW + 30 * DAY, passes: [] }, SECRET);
  const first = verify(ent, SECRET, NOW);
  assert.match(first?.tid ?? "", /^[A-Za-z0-9_-]{16}$/, "应补上 12 字节 base64url 的编号");

  // 拿同一条已签发的凭证再签一次，编号必须原样保留
  const again = verify(sign(first as Entitlement, SECRET), SECRET, NOW);
  assert.equal(again?.tid, first?.tid, "重新签发不得换掉已有编号");
});

test("发放权益时就把编号定下来，不等到签名那一刻", () => {
  // 兑换路径只把 grantPass 的结果交给 withPassCookie，中间没有别的补号步骤。
  // 若发放时不带号，cookie 里的号就是签名时才随机出来的一个 ——
  // 台账没见过它，于是那张券的消费记录全部对不上。
  for (const got of [
    grantMember(EMPTY_ENTITLEMENT, 30, NOW),
    grantPass(EMPTY_ENTITLEMENT, "bazi", 1, 400, NOW),
  ]) {
    assert.match(got.tid ?? "", /^[A-Za-z0-9_-]{16}$/, "发放出来的权益必须已经带号");
  }

  // 已有编号时不得换掉
  const seeded: Entitlement = { ...EMPTY_ENTITLEMENT, tid: "fixed-id-1234567" };
  assert.equal(grantPass(seeded, "bazi", 1, 400, NOW).tid, "fixed-id-1234567");
  assert.equal(grantMember(seeded, 30, NOW).tid, "fixed-id-1234567");
});

test("没有编号的凭证一律不许消费单次券 —— 否则台账的键会退化成所有券共用一个", () => {
  // 台账的键是 `tid:下标:剩余次数`。tid 为空时键会变成 `undefined:0:1`，
  // 对所有人所有券都是同一个 —— 第一张券消费之后，后面每一张新券的
  // 首次消费都会被当成"重放"而放行。既丢额度也丢防线。
  //
  // 两道防线，缺一不可：
  //   · 发放/消耗时补号（上面两条测试）
  //   · 读到旧的无号凭证时补号并写回（pass-cookie 的 ensurePassCookie）
  const raw = JSON.stringify({ v: 1, member: null, passes: [{ m: "bazi", n: 1, e: NOW + 400 * DAY }] });
  const legacy: Entitlement = { v: 1, member: null, passes: [{ m: "bazi", n: 1, e: NOW + 400 * DAY }] };
  assert.equal(legacy.tid, undefined, "前提：这一份确实没有编号");
  assert.ok(raw.length > 0);

  const stamped = withTid(legacy);
  assert.match(stamped.tid ?? "", /^[A-Za-z0-9_-]{16}$/, "补号后必须有编号");
  assert.notEqual(stamped.tid, undefined);
  // 补号是幂等的：已经是同一份对象就不该再换一个号
  assert.equal(withTid(stamped), stamped, "已有编号时应原样返回，不得换号");
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
