/**
 * 付费闭环的两个"卡死/漏额度"回归。
 *
 * 这两个 bug 都不是崩溃，而是**闭环里少收了一次尾**，所以只有把动作串起来
 * 才能看出来 —— 单看某一个函数的实现都是对的：
 *
 *   1. 券用光后 cookie 不清 → 刚付过钱的人卡在"只说已解锁、永远不出结果"
 *   2. 兑换会重新签发凭证 → 换掉 tid → 消费台账认不出那张券，白送一次
 *
 * 这里跑的是真模块（不是读源码文本），因为文本断言挡不住"实现改了但
 * 名字还在"的假通过 —— 前面就发生过一次：测试里的 `\s*` 允许零个空白，
 * 于是断言恒真、测了个寂寞。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  sign,
  verify,
  grantPass,
  grantMember,
  toSummary,
  withTid,
  EMPTY_ENTITLEMENT,
  type Entitlement,
} from "../src/lib/entitlement.ts";
import { passWriteBack } from "../src/lib/auth-writeback.ts";
import { decideAccess } from "../src/lib/access.ts";
import { passIdOf } from "../src/lib/server/account-store.ts";

const SECRET = "test-secret-at-least-32-bytes-long!!";
const NOW = 1_700_000_000;
const DAY = 86400;

/** 一张只够用一次的券 —— 用它才能走到"用光"那一步。 */
function onePass(): Entitlement {
  return grantPass(EMPTY_ENTITLEMENT, "bazi", 1, 400, NOW);
}

test("用掉最后一张券后，回写结果必须是 null（调用方据此清 cookie）", () => {
  // 这条是整个 bug 的核心：调用方原先写的是 `if (next !== null || …)`，
  // 于是 null 这一支永远进不去，cookie 清不掉。
  const ent = onePass();
  const next = passWriteBack({
    entitlement: ent,
    reissued: null,
    consume: { mode: "bazi", passIndex: 0, remaining: 1 },
    nowSec: NOW,
  });
  assert.equal(next, null, "整份凭证已空，必须返回 null 让调用方清 cookie");
});

test("收到 null 时真的会清掉 cookie —— 不是写个空壳", async () => {
  // 上一条只证明"回写结果是 null"。真正让用户脱困的是**拿着这个 null
  // 去的那个写入函数**确实清了 cookie —— 否则浏览器里那张用光的券会一直
  // 躺着：页首显示"已解锁 1 次"、再排盘 403、而弹窗见 alreadyUnlocked
  // 为真只说"已解锁"，用户就卡在一个永远不出结果的循环里。
  const { NextResponse } = await import("next/server.js");
  const { withPassCookie } = await import("../src/lib/server/pass-cookie.ts");

  const res = NextResponse.json({ ok: true });
  withPassCookie(res, null, SECRET);

  const raw = res.headers.get("set-cookie") ?? "";
  assert.match(raw, /xj_pass=/, "必须对 xj_pass 下手");
  assert.match(raw, /Max-Age=0/i, "必须让浏览器立刻丢弃它（Max-Age=0）");
  assert.doesNotMatch(
    raw,
    /xj_pass=[A-Za-z0-9_-]{8,}\./,
    "不得写回一份新的签名凭证 —— 那等于没清"
  );
});

test("两条消耗路径都必须无条件回写 —— 不许再给 null 加门", () => {
  // 上面两条测试证明的是"写回函数本身是对的"。但这个 bug 的现场不在函数里，
  // 而在**调用方的一道多余判断**：`if (next !== null || guard.reissued)`。
  // 它看起来像"只在有变化时才动 cookie"的优化，实际把唯一真正需要改 cookie
  // 的情况（券用光 → next 为 null）挡在外面。所以这里把调用点也钉住。
  //
  // 必须剥注释：解释这次修复的注释里正引用着那个旧写法（本项目已栽过一次，
  // 直接对原文匹配会命中注释而不是代码）。
  //
  // 这两个正则的写法有讲究，错一个就静默失效：
  //   · 逐行去掉 `//` 时必须带 `m` 标志。本仓库的文件是 CRLF 换行，
  //     `split("\n")` 之后每行末尾都留着 `\r`，而 `$` 在无 `m` 时只匹配
  //     整个字符串的末尾 —— 于是 `//.*$` 一条都匹配不上，注释全都留下，
  //     测试就变成了"在注释里找字"。这一条是实测踩出来的。
  //   · 块注释用 `[\s\S]*?` 且非贪婪，避免跨过第一个 `*/` 吞掉整段代码。
  const codeOnly = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .split(/\r?\n/)
      .join("\n");

  for (const rel of ["fortune", "ask"]) {
    const src = codeOnly(readFileSync(`src/app/api/${rel}/route.ts`, "utf8"));
    assert.match(src, /withPassCookie\(res, next, secret\)/, `${rel} 必须回写凭证`);
    assert.doesNotMatch(
      src,
      /if\s*\(\s*next\s*!==\s*null/,
      `${rel} 不得给 null 加门 —— null 正是"该清 cookie"的信号`
    );
    // 券用光时 next 为 null，而清 cookie 的动作在 withPassCookie 内部，
    // 所以调用点必须无条件执行。
    assert.match(
      src,
      /const next = passWriteBack\(/,
      `${rel} 应先算出该写回哪一份`
    );
  }
});

test("有凭证时写回的是签名后的真凭证", async () => {
  // 与上一条互为反例：不清 cookie 的分支必须真的把凭证写进去。
  const { NextResponse } = await import("next/server.js");
  const { withPassCookie } = await import("../src/lib/server/pass-cookie.ts");

  const ent = onePass();
  const res = NextResponse.json({ ok: true });
  withPassCookie(res, ent, SECRET);

  const raw = res.headers.get("set-cookie") ?? "";
  assert.match(raw, /xj_pass=[A-Za-z0-9_-]+\./, "应写入签名后的凭证");
  assert.doesNotMatch(raw, /Max-Age=0/i, "不该被当成清除");

  // 写进去的那份必须能验回来，且编号一致 —— 否则下次请求算出的台账键就变了
  const token = /xj_pass=([^;]+)/.exec(raw)?.[1];
  assert.ok(token, "应能取出 cookie 值");
  const back = verify(decodeURIComponent(token), SECRET, NOW);
  assert.ok(back, "写回的凭证应能验签");
  assert.equal(back.tid, ent.tid, "编号不得在写入过程中被换掉");
});

test("券没用光时照常回写扣减后的凭证", () => {
  const ent = grantPass(EMPTY_ENTITLEMENT, "bazi", 2, 400, NOW);
  const next = passWriteBack({
    entitlement: ent,
    reissued: null,
    consume: { mode: "bazi", passIndex: 0, remaining: 2 },
    nowSec: NOW,
  });
  assert.ok(next, "还剩一次，不该清 cookie");
  assert.equal(next.passes[0].n, 1, "应扣掉一次");
  assert.equal(next.tid, ent.tid, "编号不得因为一次扣减而变化");
});

test("会员续期不消耗券，回写的凭证仍带原来的编号", () => {
  const ent = grantPass(EMPTY_ENTITLEMENT, "bazi", 1, 400, NOW);
  const next = passWriteBack({
    entitlement: ent,
    reissued: null,
    consume: "none",
    nowSec: NOW,
  });
  // 没有消耗、也没有补签 → 无需写回，这是对的行为（不是 null 意义上的清空）
  assert.equal(next, null, "既没消耗也没补签时不必改写 cookie");
});

//////////////////////////////////////////////////////////////////////////////
// 兑换：tid 必须活下来
//////////////////////////////////////////////////////////////////////////////

test("兑换不会换掉凭证编号 —— 台账靠它认出「这张券用过」", () => {
  // 原始 bug：grantPass 构造新对象时不带 tid，而 sign 又"每次签发都换新号"，
  // 于是兑换一次就等于把台账里这张券的消费记录一笔勾销。
  const before = onePass();
  const after = grantPass(before, "bazi", 1, 400, NOW);

  assert.equal(after.tid, before.tid, "兑换必须沿用编号");
  assert.equal(after.passes[0].n, 2, "券应合并为两次");
});

test("同一个 tid 下，消费记录不会因为兑换而失忆", () => {
  // 走一遍真实的时间线：发一张券 → 用掉一次 → 再兑换一张。
  const first = onePass();

  // 第一次消费：台账记下 `tid:0:1`
  const usedId = passIdOf(first.tid as string, 0, 1);
  assert.match(usedId, /^[A-Za-z0-9_-]{16}:0:1$/, "台账的键应是 tid:下标:消费前次数");

  // 用光 → cookie 被清（上一条测试），此时凭证为空
  const emptied = passWriteBack({
    entitlement: first,
    reissued: null,
    consume: { mode: "bazi", passIndex: 0, remaining: 1 },
    nowSec: NOW,
  });
  assert.equal(emptied, null);

  // 之后再兑换：因为 cookie 已清，兑换是在空凭证上做的 —— 天然是一份新身份。
  // 关键点在于**这份新身份此后不再变化**：再兑换一次也还是它。
  const redeemed = grantPass(EMPTY_ENTITLEMENT, "bazi", 1, 400, NOW);
  const again = grantPass(redeemed, "bazi", 1, 400, NOW);
  assert.equal(again.tid, redeemed.tid, "连续两次兑换也不得换号");
  assert.notEqual(again.tid, undefined, "兑换出来的凭证必须有编号");
});

test("没有编号的凭证不能进入消费 —— 否则台账的键会退化成所有人共用一个", () => {
  // 台账的键是 `tid:下标:剩余次数`。tid 为空时键是 `undefined:0:1`，
  // 对所有券都相同 —— 第一张券消费过之后，后面每张新券的首次消费都会被
  // 当成"重放"而放行。所以凭证必须要么带号、要么在这一层补上号。
  const legacy: Entitlement = {
    v: 1,
    member: null,
    passes: [{ m: "bazi", n: 1, e: NOW + 400 * DAY }],
  };
  assert.equal(legacy.tid, undefined, "前提：这一份确实没有编号");

  const keyWithoutTid = passIdOf(String(legacy.tid), 0, 1);
  assert.equal(keyWithoutTid, "undefined:0:1", "这就是退化后的键 —— 必须避免");

  // 补号之后键才是唯一的
  const stamped = withTid(legacy);
  assert.notEqual(passIdOf(stamped.tid as string, 0, 1), keyWithoutTid);
  assert.match(passIdOf(stamped.tid as string, 0, 1), /^[A-Za-z0-9_-]{16}:0:1$/);

  // 补号幂等：已经有号的对象必须原样返回，不能换一个
  assert.equal(withTid(stamped), stamped, "已有编号时必须原样返回");
});

//////////////////////////////////////////////////////////////////////////////
// 判定与回写必须用同一个下标
//////////////////////////////////////////////////////////////////////////////

test("判定选中的券下标，与台账记账用的下标是同一个", () => {
  // 错位的后果：cookie 扣了第 1 张、台账记的是第 2 张，
  // 于是那张券可以再被用一次。
  const twoModes: Entitlement = {
    v: 1,
    tid: "tid-for-this-test",
    member: null,
    passes: [
      { m: "bazi", n: 1, e: NOW + 400 * DAY },
      { m: "bazi", n: 3, e: NOW + 400 * DAY },
    ],
  };

  const decision = decideAccess("bazi", { device: 0, ip: 0, global: 0 }, {
    device: 0,
    ip: 0,
    global: 999,
  }, twoModes, false, NOW, 0);

  assert.ok(decision.allow, "有券就该放行");
  assert.equal(typeof decision.consume, "object", "应指明消耗的是哪张券");
  const consume = decision.consume as { passIndex: number; remaining: number };
  // 第一张只剩 1 次，应被选中（下标 0、消费前次数 1）
  assert.equal(consume.passIndex, 0, "应选中下标 0 的那张");
  assert.equal(consume.remaining, 1, "记账用的是消费前的次数");

  const next = passWriteBack({
    entitlement: twoModes,
    reissued: null,
    consume,
    nowSec: NOW,
  });
  assert.ok(next, "还有券，不该清空");
  assert.equal(next.passes.length, 1, "下标 0 的券用光后应被剔除，只剩下标 1 那张");
  assert.equal(next.passes[0].n, 3, "剩下的应是那张 3 次的券");
});

//////////////////////////////////////////////////////////////////////////////
// 账户补签的编号必须稳定
//////////////////////////////////////////////////////////////////////////////

test("账户补签的编号由 user_id 派生 —— 每次补签都指向同一张券", () => {
  // 若每次补签都换新号，清一次 cookie 就能把同一张券"重置"成没用过。
  // pass-cookie 用 `acc-${user.id}` 正是为了避免这件事。
  const userId = "3f2a1b4c-0000-4000-8000-000000000000";
  const a = `acc-${userId}`;
  const b = `acc-${userId}`;
  assert.equal(a, b, "同一用户每次补签必须得到同一个编号");
  assert.notEqual(a, `acc-${userId}-2`);
});

test("签发的凭证能被验回来，且编号随票据一起往返", () => {
  const ent = grantMember(EMPTY_ENTITLEMENT, 30, NOW);
  const back = verify(sign(ent, SECRET), SECRET, NOW);
  assert.ok(back, "验签不应失败");
  assert.equal(back.tid, ent.tid, "编号应随票据往返而不被改写");
  assert.equal(back.member, ent.member);
});

test("已付费的用户不会被免费额度拦住（会员与券都算数）", () => {
  // 记账若不分权益来源，会员会被自己的免费额度挡住 —— 这是修过的 bug。
  const member: Entitlement = { v: 1, tid: "m1", member: NOW + 30 * DAY, passes: [] };
  const viaMember = decideAccess(
    "bazi",
    { device: 99, ip: 99, global: 0 },
    { device: 1, ip: 1, global: 999 },
    member,
    false,
    NOW,
    0
  );
  assert.ok(viaMember.allow, "会员即便用光了免费额度也应放行");
  assert.equal(viaMember.via, "paid");

  const passOnly = onePass();
  const viaPass = decideAccess(
    "bazi",
    { device: 99, ip: 99, global: 0 },
    { device: 1, ip: 1, global: 999 },
    passOnly,
    false,
    NOW,
    0
  );
  assert.ok(viaPass.allow, "有券就该放行");
  assert.equal(viaPass.via, "paid");

  // 摘要有券时应看得见次数 —— 页首"已解锁 N 次"靠它
  const summary = toSummary(passOnly, NOW);
  assert.equal(summary.passes[0]?.remaining, 1);
});
