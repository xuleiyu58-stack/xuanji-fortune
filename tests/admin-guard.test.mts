import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_CONFIRM_BY,
  ADMIN_FAIL_LIMIT,
  checkAdmin,
  adminRateKey,
  constantTimeEqual,
} from "../src/lib/server/admin-guard.ts";
import { hashIp, readCount } from "../src/lib/server/usage-store.ts";

/**
 * 确认页准入的回归守卫。
 *
 * 这一层是全站**唯一**新开的对外管理面，而它守的东西只有一个：那把钥匙。
 * 所以这里钉的不是"函数返回了什么"，而是几条不能松的性质 ——
 * 缺密钥必须停用、密钥不对必须拒绝、失败必须有限、成功不许消耗额度。
 *
 * 它不测 HTTP 状态码：404 的表达在调用方（页面 notFound()、接口空体 404），
 * 那属于接线，由手工验证与 order 的端到端脚本覆盖。
 */

const KEY = "test-admin-key-0123456789abcdefghijklmnopqrstuvwxyz";

/** checkAdmin 只用得到这一个请求头，与 admin-guard 收的 HeadersLike 同形。 */
const reqFrom = (ip: string) => ({
  headers: { get: (name: string) => (name === "x-forwarded-for" ? ip : null) },
});

/**
 * 用例要改环境变量，用完必须还原 —— node --test 同一个文件里的用例共用一个进程，
 * 泄漏一个 ADMIN_KEY 出去，后面每条断言都会在"另一个部署状态"下跑。
 */
async function withAdminKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ADMIN_KEY;
  if (value === undefined) delete process.env.ADMIN_KEY;
  else process.env.ADMIN_KEY = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = saved;
  }
}

// ── 常量时间比较 ────────────────────────────────────────────

test("常量时间比较：同串为真，异串为假", () => {
  assert.equal(constantTimeEqual(KEY, KEY), true);
  assert.equal(constantTimeEqual("abcdef", "abcdeg"), false);
});

test("长度不等时返回 false 而不是抛异常", () => {
  // timingSafeEqual 对不等长的 buffer 直接抛 —— 漏了长度前置检查，
  // 表现就是"随便发个长度不对的密钥就能让接口 500"，而不是安静地拒绝。
  assert.doesNotThrow(() => constantTimeEqual("a", "abcdef"));
  assert.equal(constantTimeEqual("a", "abcdef"), false);
  assert.equal(constantTimeEqual("", KEY), false);
  assert.equal(constantTimeEqual(KEY, ""), false);
});

test("按字节比较：多字节字符不会被误判成相等", () => {
  // 若实现改成按字符长度判断，这两条就会翻车
  assert.equal(constantTimeEqual("密钥", "密钥"), true);
  assert.equal(constantTimeEqual("密钥", "密钥x"), false);
  assert.equal(constantTimeEqual("密钥", "密鈅"), false);
});

// ── 限流键 ──────────────────────────────────────────────────

test("限流键是 admin:<ipHash>，与其它维度同表不同域", () => {
  const key = adminRateKey("deadbeef");
  assert.equal(key, "admin:deadbeef");
  // 不该撞上 usage-store 的既有维度（撞上就等于确认页的失败会吃掉用户的额度）
  assert.ok(!key.startsWith("ip:") && !key.startsWith("dev:") && !key.startsWith("preview:"));
});

// ── 准入判定 ────────────────────────────────────────────────

test("未配置 ADMIN_KEY：一律不放行，哪怕请求里带着值", async () => {
  await withAdminKey(undefined, async () => {
    assert.deepEqual(await checkAdmin(reqFrom("203.0.113.1"), KEY), {
      ok: false,
      reason: "unconfigured",
    });
    assert.deepEqual(await checkAdmin(reqFrom("203.0.113.1"), null), {
      ok: false,
      reason: "unconfigured",
    });
  });
});

test("密钥正确才放行", async () => {
  await withAdminKey(KEY, async () => {
    assert.deepEqual(await checkAdmin(reqFrom("203.0.113.2"), KEY), { ok: true });
  });
});

test("没带密钥 / 空密钥 / 错误密钥一律不放行", async () => {
  await withAdminKey(KEY, async () => {
    for (const provided of [null, undefined, "", "wrong", `${KEY}x`]) {
      assert.deepEqual(
        await checkAdmin(reqFrom("203.0.113.3"), provided),
        { ok: false, reason: "bad-key" },
        `provided=${JSON.stringify(provided)} 不该被放行`
      );
    }
  });
});

test("成功的访问不计入失败次数", async () => {
  await withAdminKey(KEY, async () => {
    const ip = "203.0.113.4";
    assert.deepEqual(await checkAdmin(reqFrom(ip), KEY), { ok: true });
    assert.deepEqual(await checkAdmin(reqFrom(ip), KEY), { ok: true });
    // 直接把计数读出来看，而不是"再多试几次看它会不会被限"——
    // 后者在 ADMIN_FAIL_LIMIT 被调大之后会变成一条永远通过的假断言。
    assert.equal(await readCount(adminRateKey(hashIp(ip))), 0, "成功路径不该消耗失败额度");
  });
});

test("失败按 IP 限次：到上限后连正确密钥也不再受理", async () => {
  await withAdminKey(KEY, async () => {
    const ip = "203.0.113.5";
    for (let i = 1; i <= ADMIN_FAIL_LIMIT; i += 1) {
      assert.deepEqual(
        await checkAdmin(reqFrom(ip), `wrong-${i}`),
        { ok: false, reason: "bad-key" },
        `第 ${i} 次失败应当仍是 bad-key（还没到上限）`
      );
    }
    assert.equal(await readCount(adminRateKey(hashIp(ip))), ADMIN_FAIL_LIMIT, "失败计数应当累计到上限");
    // 到上限之后**连正确密钥也不再放行**：否则攻击者只要蒙对一次就能继续试，
    // 而这正是这道闸门要挡住的事。
    assert.deepEqual(await checkAdmin(reqFrom(ip), KEY), { ok: false, reason: "rate-limited" });
    assert.deepEqual(await checkAdmin(reqFrom(ip), "wrong"), { ok: false, reason: "rate-limited" });
  });
});

test("限次是**按 IP** 的：另一台机器不受牵连", async () => {
  await withAdminKey(KEY, async () => {
    const blocked = "203.0.113.6";
    for (let i = 0; i < ADMIN_FAIL_LIMIT; i += 1) await checkAdmin(reqFrom(blocked), "wrong");
    assert.deepEqual(await checkAdmin(reqFrom(blocked), KEY), { ok: false, reason: "rate-limited" });
    // 站长自己那台手机不会被别人的爆破连坐 —— 这是他第二天还能干活的前提
    assert.deepEqual(await checkAdmin(reqFrom("203.0.113.7"), KEY), { ok: true });
  });
});

// ── 审计标识 ────────────────────────────────────────────────

test("页面确认的审计标识与脚本确认区分开", () => {
  // 日后对账时要说得出"这一单是页面点的还是命令行确认的"，
  // 所以两者必须不同名（confirm-order.mjs 传的是 "cli"）。
  assert.equal(ADMIN_CONFIRM_BY, "admin-page");
  assert.notEqual(ADMIN_CONFIRM_BY, "cli");
});
