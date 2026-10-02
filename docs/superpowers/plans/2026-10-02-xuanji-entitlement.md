# 玄机 收费闭环与服务端权威 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让服务端成为收费的唯一权威 —— 付费解锁改为激活码，签名凭证在 `/api/fortune` 真正生效，免费额度收窄到只覆盖免费模式。

**Architecture:** 兑换激活码后签发一张 HMAC 签名的 httpOnly cookie（会员与单次通行证合并存放）。此后 `/api/fortune` 只验签、不查库 —— 权益就在 cookie 里。放行判定抽成零依赖纯函数 `decideAccess`，取代现有的 `decideQuota`。

**Tech Stack:** Next.js 14.2.35（App Router）、TypeScript 5（strict）、Tailwind、Supabase（Postgres）、Node 24（`node --test`）、DeepSeek API

设计依据：`docs/superpowers/specs/2026-10-02-xuanji-entitlement-design.md`

## Global Constraints

- Node 版本 ≥ 24，`node --test` 直接跑 TypeScript（原生类型擦除）
- **测试脚本必须是裸 `node --test`**，写 `node --test tests/` 会 `MODULE_NOT_FOUND` 硬失败
- **原生类型擦除的三条限制**，测试写法必须遵守：相对导入必须写显式 `.ts` 扩展名；不认 `@/*` 别名；无法 `import` `.tsx`
- **被单元测试直接引入的模块必须零 import**（`entitlement.ts` 例外 —— 它只 import `node:crypto` 这个内置模块，Node 能解析）。配置一律作为函数参数注入
- 应用代码（路由、组件、服务端模块）之间沿用既有 `@/` 别名，**不写扩展名**（`tsconfig.json` 的 `moduleResolution: "bundler"` 且未开 `allowImportingTsExtensions`，写了会编译失败）
- 测试文件放 `tests/`，扩展名 `.mts`
- 界面文案为简体中文，风格沿用现有站点的玄学口吻
- 提交信息格式沿用仓库既有风格：emoji + 中文描述
- 新增环境变量 `PASS_SECRET` 严禁加 `NEXT_PUBLIC_` 前缀
- 状态码沿用既有约定（`tests/route-contract.test.mts:46` 钉着的）：额度用尽 **429**、服务未就绪 **503**、付费模式未激活 **403**
- 拒绝文案沿用既有字符串，`tests/quota-policy.test.mts` 迁移后仍要匹配：全局熔断含「明天」，额度用尽含「免费次数」

## 文件结构

**新增**

| 文件 | 职责 |
|---|---|
| `src/lib/entitlement.ts` | 凭证的签发 / 验签 / 合并 / 消耗。纯函数，只 import `node:crypto` |
| `src/lib/access.ts` | 放行判定。零 import，`isFree` 与 `nowSec` 注入 |
| `src/lib/server/runtime.ts` | 服务端环境装配：env 读取、Supabase admin 客户端、内存兜底开关、`passSecret()` |
| `src/lib/server/codes.ts` | 激活码核销。Supabase 实现 + 开发用内存兜底 |
| `src/lib/contact.ts` | 站长联系方式与发码说明（前端文案用，待用户填值） |
| `src/app/api/redeem/route.ts` | 兑换接口 |
| `src/app/api/entitlement/route.ts` | 权益查询接口 |
| `src/components/EntitlementProvider.tsx` | 权益上下文，全站共享一次请求 |
| `scripts/gen-codes.mjs` | 发码脚本 |
| `supabase/redeem.sql` | 建表与核销函数 |
| `tests/entitlement.test.mts`、`tests/access.test.mts`、`tests/no-fake-unlock.test.mts` | 测试 |

**修改**

| 文件 | 改动 |
|---|---|
| `src/lib/pricing.ts` | 增加 `REDEEM_IP_DAILY_LIMIT` 与 `SINGLE_PASS_DAYS` |
| `src/lib/server/usage-store.ts` | 抽出环境装配到 `runtime.ts`；增加通用 `readCount` / `bumpCount` |
| `src/app/api/fortune/route.ts` | 验凭证 + 改用 `decideAccess` |
| `src/components/PaymentModal.tsx` | 「已完成支付」换成激活码输入 |
| `src/components/FortuneForm.tsx` | 删本地 `hasPaid` / `member`；删分享文案里残留的 `?ref=` |
| `src/app/member/page.tsx` | 删 `setMember` / `setMemberExpiry` |
| `src/components/Header.tsx`、`src/components/QuotaBanner.tsx` | 会员状态改读上下文 |
| `src/lib/store.ts` | 删会员相关的四个函数 |
| `src/app/layout.tsx` | 挂载 `EntitlementProvider` |
| `README.md`、`.env.example` | 补 `PASS_SECRET` 与发码说明 |

**删除**

| 文件 | 原因 |
|---|---|
| `src/lib/quota-policy.ts` | 由 `access.ts` 取代。两模块职责重叠必然漂移；其测试迁移进 `access.test.mts` |
| `tests/quota-policy.test.mts` | 同上 |

> 两者都在 **Task 5** 删除，不在 Task 2。路由到 Task 5 才切到 `decideAccess`，提前删会让
> Task 2–4 之间每个任务边界都留下编译不过的仓库，任务无法独立验收。

---

### Task 1: 凭证模块

HMAC 签名的凭证是整个方案的安全根基。先把它做成可完整单测的纯函数。

**Files:**
- Create: `src/lib/entitlement.ts`
- Test: `tests/entitlement.test.mts`

**Interfaces:**
- Consumes: 无（只 import `node:crypto`）
- Produces:
  - `const ENTITLEMENT_VERSION = 1`
  - `interface Pass { m: string; n: number; e: number }`
  - `interface Entitlement { v: 1; member: number | null; passes: Pass[] }`
  - `interface EntitlementSummary { member: boolean; expiresAt?: number; passes: { mode: string; remaining: number }[] }`
  - `const EMPTY_ENTITLEMENT: Entitlement`
  - `sign(ent: Entitlement, secret: string): string`
  - `verify(token: string | undefined | null, secret: string, nowSec: number): Entitlement | null`
  - `prune(ent: Entitlement, nowSec: number): Entitlement | null`
  - `isMemberActive(ent: Entitlement, nowSec: number): boolean`
  - `grantMember(ent: Entitlement, days: number, nowSec: number): Entitlement`
  - `grantPass(ent: Entitlement, mode: string, n: number, days: number, nowSec: number): Entitlement`
  - `consumePass(ent: Entitlement, mode: string, nowSec: number): Entitlement | null`
  - `toSummary(ent: Entitlement | null, nowSec: number): EntitlementSummary`

- [ ] **Step 1: 写失败的测试**

创建 `tests/entitlement.test.mts`：

```ts
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
  assert.deepEqual(got, ent);
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
  const after = consumePass(one, "tarot", NOW);
  assert.equal(after, null, "只剩一张券、用掉后整份凭证应消失，调用方据此清 cookie");
});

test("消耗会员不产生变化（会员不走消耗路径）", () => {
  const m = member(30);
  assert.deepEqual(consumePass(m, "tarot", NOW), m);
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/lib/entitlement.ts'`

- [ ] **Step 3: 实现 entitlement.ts**

创建 `src/lib/entitlement.ts`：

```ts
/**
 * 权益凭证。
 *
 * 兑换激活码后，服务端签发一张签名 cookie。此后判定权益只验签、不查库 ——
 * 权益就在这张凭证里。密钥由调用方注入（从环境变量读是 server 层的事），
 * 本模块只 import 内置的 node:crypto，因此能被 node --test 直接跑。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ENTITLEMENT_VERSION = 1;

export interface Pass {
  /** 模式：bazi / tarot / love */
  m: string;
  /** 剩余次数 */
  n: number;
  /** 失效 unix 秒 */
  e: number;
}

export interface Entitlement {
  v: 1;
  /** 会员到期 unix 秒；非会员为 null */
  member: number | null;
  passes: Pass[];
}

export interface EntitlementSummary {
  member: boolean;
  expiresAt?: number;
  passes: { mode: string; remaining: number }[];
}

export const EMPTY_ENTITLEMENT: Entitlement = { v: 1, member: null, passes: [] };

const DAY_SECONDS = 86400;

function encodePayload(ent: Entitlement): string {
  return Buffer.from(JSON.stringify(ent), "utf8").toString("base64url");
}

function macOf(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function sign(ent: Entitlement, secret: string): string {
  const payload = encodePayload(ent);
  return `${payload}.${macOf(payload, secret)}`;
}

export function isMemberActive(ent: Entitlement, nowSec: number): boolean {
  return ent.member !== null && ent.member > nowSec;
}

/**
 * 剔除过期项。整份凭证空掉时返回 null —— 调用方据此清除 cookie，
 * 而不是写一个空壳回去。
 */
export function prune(ent: Entitlement, nowSec: number): Entitlement | null {
  const member = ent.member !== null && ent.member > nowSec ? ent.member : null;
  const passes = ent.passes.filter((p) => p.n > 0 && p.e > nowSec);
  if (member === null && passes.length === 0) return null;
  return { v: ENTITLEMENT_VERSION, member, passes };
}

function parseEntitlement(raw: unknown, nowSec: number): Entitlement | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== ENTITLEMENT_VERSION) return null;

  const member =
    typeof o.member === "number" && Number.isFinite(o.member) ? o.member : null;

  const passes: Pass[] = [];
  if (Array.isArray(o.passes)) {
    for (const item of o.passes) {
      if (typeof item !== "object" || item === null) continue;
      const p = item as Record<string, unknown>;
      if (typeof p.m !== "string") continue;
      if (typeof p.n !== "number" || !Number.isInteger(p.n) || p.n <= 0) continue;
      if (typeof p.e !== "number" || !Number.isFinite(p.e)) continue;
      passes.push({ m: p.m, n: p.n, e: p.e });
    }
  }

  return prune({ v: ENTITLEMENT_VERSION, member, passes }, nowSec);
}

export function verify(
  token: string | undefined | null,
  secret: string,
  nowSec: number
): Entitlement | null {
  if (typeof token !== "string" || token.length === 0) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  // 必须先比长度：timingSafeEqual 对不等长的 buffer 直接抛异常
  const expected = Buffer.from(macOf(payload, secret), "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  return parseEntitlement(raw, nowSec);
}

/** 续期时从现有到期时间往后接，而不是从今天重算 —— 否则提前续费会亏掉剩余天数。 */
export function grantMember(ent: Entitlement, days: number, nowSec: number): Entitlement {
  const base = isMemberActive(ent, nowSec) ? (ent.member as number) : nowSec;
  return { v: ENTITLEMENT_VERSION, member: base + days * DAY_SECONDS, passes: ent.passes };
}

/** 同模式的券合并：次数相加，到期取较晚者。 */
export function grantPass(
  ent: Entitlement,
  mode: string,
  n: number,
  days: number,
  nowSec: number
): Entitlement {
  const e = nowSec + days * DAY_SECONDS;
  const existing = ent.passes.find((p) => p.m === mode);
  const passes = existing
    ? ent.passes.map((p) => (p.m === mode ? { m: mode, n: p.n + n, e: Math.max(p.e, e) } : p))
    : [...ent.passes, { m: mode, n, e }];
  return { v: ENTITLEMENT_VERSION, member: ent.member, passes };
}

/** 用掉一次该模式的券。返回 null 表示整份凭证已空，调用方应清除 cookie。 */
export function consumePass(
  ent: Entitlement,
  mode: string,
  nowSec: number
): Entitlement | null {
  const passes = ent.passes
    .map((p) => (p.m === mode ? { ...p, n: p.n - 1 } : p))
    .filter((p) => p.n > 0 && p.e > nowSec);
  return prune({ ...ent, passes }, nowSec);
}

export function toSummary(ent: Entitlement | null, nowSec: number): EntitlementSummary {
  const alive = ent ? prune(ent, nowSec) : null;
  if (!alive) return { member: false, passes: [] };
  const summary: EntitlementSummary = {
    member: isMemberActive(alive, nowSec),
    passes: alive.passes.map((p) => ({ mode: p.m, remaining: p.n })),
  };
  if (summary.member && alive.member !== null) summary.expiresAt = alive.member;
  return summary;
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 新增 16 条 entitlement 测试全绿，既有测试不受影响

- [ ] **Step 5: 提交**

```bash
git add src/lib/entitlement.ts tests/entitlement.test.mts
git commit -m "🔑 新增权益凭证：HMAC 签名 cookie，验签不查库"
```

---

### Task 2: 放行判定

把 `quota-policy.ts` 的判定扩成「凭证优先」。原来的测试**迁移**进 `access.test.mts` 并扩展凭证分支；
旧模块本身留到 Task 5 再删（那时路由才切换过去，见下面的说明）。

**Files:**
- Create: `src/lib/access.ts`
- Test: `tests/access.test.mts`

> **`quota-policy.ts` 的移除不在这里做。** 它此刻仍被 `route.ts` 引用，删掉会让仓库编译不过 ——
> 那样 Task 2、3、4 之间每个边界都留着一个红着的构建，任务无法独立验收。
> 改到 Task 5：先把路由切到 `decideAccess`，再删旧模块。

**Interfaces:**
- Consumes: 无（零 import，保持一致）
- Produces:
  - `interface UsageCounts { device: number; ip: number; global: number }`
  - `interface QuotaLimits { device: number; ip: number; global: number }`
  - `interface AccessEntitlement { member: number | null; passes: { m: string; n: number; e: number }[] }`
  - `type AccessDecision = { allow: true; consume: "none" | "quota" | { mode: string } } | { allow: false; status: 403 | 429 | 503; reason: "global" | "paid" | "device" | "ip"; message: string }`
  - `decideAccess(mode: string, counts: UsageCounts, limits: QuotaLimits, entitlement: AccessEntitlement | null, isFree: boolean, nowSec: number): AccessDecision`

  注意 `AccessEntitlement` 与 `Entitlement`（Task 1）结构兼容但是**独立声明**的 —— 这样 `access.ts` 保持零 import。`{ mode: string }` 这个对象形态表示「消耗一次该模式的单次券」。

- [ ] **Step 1: 写失败的测试**

创建 `tests/access.test.mts`。原有的 `quota-policy` 测试全部迁进来（补上 `isFree` 与 `entitlement` 参数），再补凭证相关的分支：

```ts
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/lib/access.ts'`

- [ ] **Step 3: 实现 access.ts**

创建 `src/lib/access.ts`：

```ts
/**
 * 放行判定。
 *
 * 只回答"这个请求该不该放行、放行后该扣什么"，不碰任何 I/O。
 * 纯函数、零 import —— 因此能被 node --test 直接跑。
 *
 * 判定顺序里有两处刻意安排：
 *   - 全局熔断排在最前，因为它是保护 API 账单的最后一道闸，会员也不例外
 *   - 凭证排在免费额度之前，因为会员用免费模式时不该被扣次数
 */

export interface UsageCounts {
  device: number;
  ip: number;
  global: number;
}

export interface QuotaLimits {
  device: number;
  ip: number;
  global: number;
}

/** 与 entitlement.ts 的 Entitlement 结构兼容。此处独立声明是为了保持本模块零 import。 */
export interface AccessEntitlement {
  member: number | null;
  passes: { m: string; n: number; e: number }[];
}

export type AccessDecision =
  | { allow: true; consume: "none" | "quota" | { mode: string } }
  | {
      allow: false;
      status: 403 | 429 | 503;
      reason: "global" | "paid" | "device" | "ip";
      message: string;
    };

const QUOTA_EXHAUSTED = "今日免费次数已用完，开通会员可无限次解读";

export function decideAccess(
  mode: string,
  counts: UsageCounts,
  limits: QuotaLimits,
  entitlement: AccessEntitlement | null,
  isFree: boolean,
  nowSec: number
): AccessDecision {
  // 1. 全局熔断 —— 无论持有什么凭证都不放行
  if (counts.global >= limits.global) {
    return {
      allow: false,
      status: 503,
      reason: "global",
      message: "今日测算人数较多，请明天再来",
    };
  }

  // 2. 凭证
  if (entitlement) {
    if (entitlement.member !== null && entitlement.member > nowSec) {
      return { allow: true, consume: "none" };
    }
    const pass = entitlement.passes.find((p) => p.m === mode && p.n > 0 && p.e > nowSec);
    if (pass) {
      return { allow: true, consume: { mode } };
    }
  }

  // 3. 免费模式走额度
  if (isFree) {
    if (counts.device >= limits.device) {
      return { allow: false, status: 429, reason: "device", message: QUOTA_EXHAUSTED };
    }
    if (counts.ip >= limits.ip) {
      return { allow: false, status: 429, reason: "ip", message: QUOTA_EXHAUSTED };
    }
    return { allow: true, consume: "quota" };
  }

  // 4. 付费模式而没有有效凭证 —— 不是频率问题，是权限问题，用 403 而非 429
  return {
    allow: false,
    status: 403,
    reason: "paid",
    message: "该模式需激活后使用",
  };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 14 条 access 测试全绿

- [ ] **Step 5: 确认接入前一切照旧**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS，tsc 无输出。`access.ts` 此刻还没有消费者 —— 这是刻意的，路由在 Task 5 才切过去。

- [ ] **Step 6: 提交**

```bash
git add src/lib/access.ts tests/access.test.mts
git commit -m "🎫 放行判定改为凭证优先：会员不扣额度，付费模式不再白嫖"
```

---

### Task 3: 数据层

把服务端环境装配抽出来（`usage-store` 和 `codes` 两个模块都要用同一份 Supabase admin 客户端），加激活码表与核销函数，再写发码脚本。

**Files:**
- Create: `src/lib/server/runtime.ts`、`src/lib/server/codes.ts`、`supabase/redeem.sql`、`scripts/gen-codes.mjs`
- Modify: `src/lib/pricing.ts`、`src/lib/server/usage-store.ts`、`.env.example`

**Interfaces:**
- Consumes: 无（这一层不做业务判定）
- Produces:
  - `runtime.ts`：`envValue(...names: string[]): string | undefined`、`isSupabaseConfigured(): boolean`、`admin(): SupabaseClient`、`allowMemoryFallback(): boolean`、`passSecret(): string | null`
  - `usage-store.ts` 新增：`readCount(key: string): Promise<number>`、`bumpCount(key: string): Promise<void>`
  - `codes.ts`：`interface RedeemOutcome { ok: boolean; kind?: "member" | "single"; mode?: string | null; days?: number }`、`redeemCode(code: string, who: string): Promise<RedeemOutcome>`
  - `pricing.ts` 新增：`REDEEM_IP_DAILY_LIMIT = 10`、`SINGLE_PASS_DAYS = 7`

> **本任务没有单元测试文件**，与既有的 `usage-store.ts` 同理：它全是 I/O 粘合层，单测只能测到 mock，真正要验的「核销是否恰好一次」在 SQL 里。由 Step 5 的类型检查与 Task 4 的端到端冒烟覆盖。这是刻意的取舍，不是遗漏。

- [ ] **Step 1: 给 pricing.ts 加两个常量**

在 `src/lib/pricing.ts` 第 2 行 `FREE_IP_DAILY_LIMIT` 之后插入：

```ts
/** 兑换接口按 IP 的每日尝试上限。80 bit 的码本就爆不了，这层防的是脚本噪声。 */
export const REDEEM_IP_DAILY_LIMIT = 10;
/** 单次通行证的有效天数。¥3.8 买的一次，不该永远躺在浏览器里。 */
export const SINGLE_PASS_DAYS = 7;
```

- [ ] **Step 2: 抽出服务端环境装配**

创建 `src/lib/server/runtime.ts`：

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 服务端环境装配。
 *
 * usage-store 与 codes 都要一个 Supabase admin 客户端、都要判断"没配 Supabase 时怎么办"，
 * 所以这两件事集中在这里，而不是各写一份。
 */

export function envValue(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    envValue("NEXT_PUBLIC_SUPABASE_URL") && envValue("SUPABASE_SERVICE_ROLE_KEY")
  );
}

let _admin: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "数据层未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  if (!_admin) {
    _admin = createClient(
      envValue("NEXT_PUBLIC_SUPABASE_URL")!,
      envValue("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
  }
  return _admin;
}

/**
 * 没配 Supabase 时能不能退化为进程内内存。
 * 开发环境可以（单人调试够用），生产环境必须拒绝服务 —— 宁可 503，也不能敞着口子。
 */
export function allowMemoryFallback(): boolean {
  if (isSupabaseConfigured()) return false;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "数据层未配置且运行于生产环境：无法限流与核销，拒绝提供服务。请配置 Supabase。"
    );
  }
  return true;
}

/** 凭证签名密钥。未配置时返回 null，调用方据此把凭证视为不存在。 */
export function passSecret(): string | null {
  return envValue("PASS_SECRET") ?? null;
}
```

- [ ] **Step 3: 改造 usage-store.ts 用上 runtime，并加通用计数**

`src/lib/server/usage-store.ts` 改为（**整份替换**）：

```ts
import type { UsageCounts } from "@/lib/access";
import { admin, allowMemoryFallback, envValue } from "@/lib/server/runtime";
import { createHash } from "node:crypto";

/**
 * 用量计数。
 *
 * 三个维度共用一张表：dev:<设备>、ip:<IP哈希>、global。
 *
 * Vercel 的 serverless 函数是无状态的，计数必须落在函数之外 —— 放内存里
 * 每次冷启动就归零，那等于没限流。所以生产走 Supabase。
 *
 * 环境装配（admin 客户端、内存兜底开关）在 runtime.ts 里，与激活码核销共用。
 */

const GLOBAL_KEY = "global";
const DEVICE_PREFIX = "dev:";
const IP_PREFIX = "ip:";

export const deviceKey = (deviceId: string) => `${DEVICE_PREFIX}${deviceId}`;
export const ipKey = (ipHash: string) => `${IP_PREFIX}${ipHash}`;

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function dailyGlobalBudget(): number {
  const raw = envValue("DEEPSEEK_DAILY_BUDGET");
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/**
 * 以北京时间的自然日为界。
 * 受众在国内，而 Vercel 跑在 UTC —— 直接用 UTC 日期的话，用户会在下午 8 点"跨天"重置。
 */
export function today(): string {
  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 开发环境的内存兜底。仅进程内有效，多实例部署下不成立。 */
const memory: { day: string; bucket: Map<string, number>; warned: boolean } = {
  day: "",
  bucket: new Map(),
  warned: false,
};

function memoryBucket(): Map<string, number> {
  const d = today();
  if (memory.day !== d) {
    memory.day = d;
    memory.bucket = new Map();
  }
  if (!memory.warned) {
    memory.warned = true;
    console.warn(
      "[usage-store] 未配置 Supabase，限流退化为进程内内存计数。仅供本地开发，切勿用于生产。"
    );
  }
  return memory.bucket;
}

export async function readCount(key: string): Promise<number> {
  if (allowMemoryFallback()) return memoryBucket().get(key) ?? 0;

  const { data, error } = await admin()
    .from("usage")
    .select("count")
    .eq("key", key)
    .eq("day", today())
    .maybeSingle();

  if (error) throw new Error(`读取用量失败: ${error.message}`);
  return (data?.count as number | undefined) ?? 0;
}

export async function bumpCount(key: string): Promise<void> {
  if (allowMemoryFallback()) {
    const b = memoryBucket();
    b.set(key, (b.get(key) ?? 0) + 1);
    return;
  }

  // 走 rpc 做原子自增：并发下 select-then-update 会丢计数
  const { error } = await admin().rpc("bump_usage", { k: key });
  if (error) throw new Error(`写入用量失败: ${error.message}`);
}

export async function readUsage(deviceId: string, ipHash: string): Promise<UsageCounts> {
  const keys = [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY];

  if (allowMemoryFallback()) {
    const b = memoryBucket();
    return {
      device: b.get(keys[0]) ?? 0,
      ip: b.get(keys[1]) ?? 0,
      global: b.get(keys[2]) ?? 0,
    };
  }

  const { data, error } = await admin()
    .from("usage")
    .select("key, count")
    .in("key", keys)
    .eq("day", today());

  if (error) throw new Error(`读取用量失败: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.count as number]));
  return {
    device: byKey.get(keys[0]) ?? 0,
    ip: byKey.get(keys[1]) ?? 0,
    global: byKey.get(keys[2]) ?? 0,
  };
}

export async function bumpUsage(deviceId: string, ipHash: string): Promise<void> {
  if (allowMemoryFallback()) {
    const b = memoryBucket();
    for (const k of [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY]) {
      b.set(k, (b.get(k) ?? 0) + 1);
    }
    return;
  }

  await Promise.all(
    [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY].map((k) => bumpCount(k))
  );
}
```

> 注意 `readUsage` / `bumpUsage` 的内存分支现在通过 `allowMemoryFallback()` 判断，而它会在**生产环境未配 Supabase 时抛错**。这正是既有行为，语义没变：宁可 503，也不能敞着口子。

- [ ] **Step 4: 写建表与核销 SQL**

创建 `supabase/redeem.sql`：

```sql
-- 激活码表。
--
-- 与 schema.sql 分开放，是因为 schema.sql 已经在线上执行过，
-- 往里面追加会让人不确定该重跑哪一段。这一段单独执行一次即可。

create table if not exists public.redeem_codes (
  code        text primary key,          -- 16 位 Crockford base32（去 I L O U），80 bit 熵
  kind        text not null,             -- 'member' | 'single'
  mode        text,                      -- kind='single' 时必填
  days        int  not null default 0,   -- kind='member' 时的有效天数
  batch       text,                      -- 批次号，便于按批发放与对账
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by text                       -- 兑换时的设备指纹，排查纠纷用
);

alter table public.redeem_codes enable row level security;
revoke all on public.redeem_codes from anon, authenticated;

-- 原子核销：只有把 redeemed_at 从 null 改成 now 的那一次调用会返回行。
-- 并发下不会双花 —— 这正是把这件事放在数据库而不是应用层做的理由。
create or replace function public.redeem_code(c text, who text)
returns table (kind text, mode text, days int)
language sql
security definer
set search_path = public
as $$
  update public.redeem_codes
     set redeemed_at = now(), redeemed_by = who
   where code = c and redeemed_at is null
  returning redeem_codes.kind, redeem_codes.mode, redeem_codes.days;
$$;

revoke all on function public.redeem_code(text, text) from anon, authenticated;

create index if not exists redeem_codes_batch_idx on public.redeem_codes (batch);
```

- [ ] **Step 5: 实现 codes.ts**

创建 `src/lib/server/codes.ts`：

```ts
import { admin, allowMemoryFallback, envValue } from "@/lib/server/runtime";

/**
 * 激活码核销。
 *
 * 核销的原子性由数据库保证（supabase/redeem.sql 的 redeem_code 函数），
 * 这里只负责取参数、调函数、翻译结果。
 *
 * 没配 Supabase 时退化为进程内内存：码从 DEV_REDEEM_CODES 显式播种，
 * 格式 `码:kind:mode:days` 逗号分隔，例如：
 *   DEV_REDEEM_CODES=XMEMBER30:member::30,XTAROT1:single:tarot:1
 * 刻意不做"任意码都放行"的魔术 —— 那种兜底一旦漏到生产就是灾难。
 */

export interface RedeemOutcome {
  ok: boolean;
  kind?: "member" | "single";
  mode?: string | null;
  days?: number;
}

/** Crockford base32：去掉易混的 I L O U。32 整除 256，取模无偏。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function isValidCodeFormat(code: string): boolean {
  return code.length === 16 && [...code].every((ch) => ALPHABET.includes(ch));
}

const memoryCodes = new Map<string, { kind: string; mode: string | null; days: number }>();
let memorySeeded = false;

function seedMemory(): void {
  if (memorySeeded) return;
  memorySeeded = true;
  for (const entry of (envValue("DEV_REDEEM_CODES") ?? "").split(",")) {
    const [code, kind, mode, days] = entry.split(":");
    if (!code || !kind) continue;
    memoryCodes.set(normalizeCode(code), {
      kind,
      mode: mode || null,
      days: Number.parseInt(days ?? "0", 10) || 0,
    });
  }
}

export async function redeemCode(code: string, who: string): Promise<RedeemOutcome> {
  if (allowMemoryFallback()) {
    seedMemory();
    const hit = memoryCodes.get(code);
    if (!hit) return { ok: false };
    memoryCodes.delete(code); // 只能核销一次
    return { ok: true, kind: hit.kind as "member" | "single", mode: hit.mode, days: hit.days };
  }

  const { data, error } = await admin().rpc("redeem_code", { c: code, who });
  if (error) throw new Error(`核销失败: ${error.message}`);

  const row = (data as { kind: string; mode: string | null; days: number }[] | null)?.[0];
  if (!row) return { ok: false };

  return { ok: true, kind: row.kind as "member" | "single", mode: row.mode, days: row.days };
}
```

- [ ] **Step 6: 写发码脚本**

创建 `scripts/gen-codes.mjs`：

```js
/**
 * 批量生成激活码。
 *
 * 用法（在仓库根目录）：
 *   node --env-file=.env.local scripts/gen-codes.mjs --kind member --days 30 --count 20 --batch 2026-10
 *   node --env-file=.env.local scripts/gen-codes.mjs --kind single --mode tarot --count 50 --batch 2026-10
 *
 * 刻意不做管理后台：一个只用于发码的网页要额外的密钥与暴露面，脚本够了。
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function makeCode() {
  // 32 整除 256，随机字节取模 32 是无偏的
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`缺少环境变量 ${name}。请确认 .env.local 已配好 Supabase。`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind;
  const count = Number.parseInt(args.count ?? "10", 10);

  if (kind !== "member" && kind !== "single") {
    console.error("--kind 必须是 member 或 single");
    process.exit(1);
  }
  const days = kind === "member" ? Number.parseInt(args.days ?? "30", 10) : 0;
  const mode = kind === "single" ? args.mode : null;
  if (kind === "single" && !mode) {
    console.error("--kind single 时必须给 --mode（bazi / tarot / love）");
    process.exit(1);
  }
  if (!Number.isInteger(count) || count <= 0 || count > 500) {
    console.error("--count 必须是 1..500 的整数");
    process.exit(1);
  }

  const db = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  const rows = [];
  const seen = new Set();
  while (rows.length < count) {
    const code = makeCode();
    if (seen.has(code)) continue; // 生日碰撞概率极低，但重复插入会整批失败，挡一下
    seen.add(code);
    rows.push({ code, kind, mode, days, batch: args.batch ?? null });
  }

  const { error } = await db.from("redeem_codes").insert(rows);
  if (error) {
    console.error("写入失败：", error.message);
    console.error("若提示表不存在，先在 Supabase SQL Editor 执行 supabase/redeem.sql");
    process.exit(1);
  }

  const header = kind === "member" ? `会员 ${days} 天` : `单次 · ${mode}`;
  console.log(`\n已生成 ${count} 个激活码（${header}${args.batch ? ` · 批次 ${args.batch}` : ""}）：\n`);
  for (const r of rows) console.log(r.code);
  console.log("\n发放方式：用户付款后把其中一个发给对方，站内输入即解锁。一码只能用一次。\n");
}

main();
```

- [ ] **Step 7: 补 .env.example**

在 `src` 之外的 `.env.example` 末尾追加：

```bash
# ── 权益凭证 ────────────────────────────────────────────────
# 服务端专用。签署会员/通行证 cookie 的密钥，≥32 字节随机。
# 泄露 = 任何人可自签会员。轮换会使已发出的全部凭证失效（届时重新发码）。
# 生成：node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
PASS_SECRET=

# 仅开发用：没配 Supabase 时用内存兜底核销激活码。
# 格式 `码:kind:mode:days`，逗号分隔；kind 为 member 时 mode 留空。
# DEV_REDEEM_CODES=XMEMBER30:member::30,XTAROT1:single:tarot:1
```

- [ ] **Step 8: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误输出。`quota-policy.ts` 此刻仍在仓库里，路由也还没切换 —— 这一步不该有任何红。

- [ ] **Step 9: 确认脚本语法正确**

Run: `node --check scripts/gen-codes.mjs`
Expected: 无输出（语法通过）

- [ ] **Step 10: 提交**

```bash
git add src/lib/pricing.ts src/lib/server/runtime.ts src/lib/server/codes.ts src/lib/server/usage-store.ts supabase/redeem.sql scripts/gen-codes.mjs .env.example
git commit -m "🗄️ 数据层：激活码表与原子核销、服务端环境装配、发码脚本"
```

---

### Task 4: 兑换与权益接口

**Files:**
- Create: `src/app/api/redeem/route.ts`、`src/app/api/entitlement/route.ts`

**Interfaces:**
- Consumes: Task 1 的 `verify` / `sign` / `grantMember` / `grantPass` / `toSummary` / `EMPTY_ENTITLEMENT`；Task 3 的 `redeemCode` / `normalizeCode` / `isValidCodeFormat` / `readCount` / `bumpCount` / `hashIp` / `passSecret` / `allowMemoryFallback`；`pricing.ts` 的 `REDEEM_IP_DAILY_LIMIT` / `SINGLE_PASS_DAYS`
- Produces: `POST /api/redeem`（200 带 `{ success, entitlement }` 与 `Set-Cookie: xj_pass`；400 码无效；429 尝试过频；503 未就绪）、`GET /api/entitlement`（200 带 `EntitlementSummary`）

- [ ] **Step 1: 写兑换路由**

创建 `src/app/api/redeem/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  EMPTY_ENTITLEMENT,
  grantMember,
  grantPass,
  sign,
  toSummary,
  verify,
  type Entitlement,
} from "@/lib/entitlement";
import { isValidCodeFormat, normalizeCode, redeemCode } from "@/lib/server/codes";
import { passSecret } from "@/lib/server/runtime";
import { bumpCount, hashIp, readCount } from "@/lib/server/usage-store";
import { REDEEM_IP_DAILY_LIMIT, SINGLE_PASS_DAYS } from "@/lib/pricing";

// 用到 node:crypto 做 IP 哈希与签名，必须显式声明 Node 运行时
export const runtime = "nodejs";

const DEVICE_COOKIE = "xj_dev";
const PASS_COOKIE = "xj_pass";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

function setPassCookie(res: NextResponse, token: string | null): NextResponse {
  if (token === null) {
    res.cookies.set(PASS_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  res.cookies.set(PASS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const raw = (body as { code?: unknown } | null)?.code;
  if (typeof raw !== "string") {
    return NextResponse.json({ success: false, error: "请输入激活码" }, { status: 400 });
  }
  const code = normalizeCode(raw);
  if (!isValidCodeFormat(code)) {
    // 格式不对就直接回绝，不必浪费一次数据库往返
    return NextResponse.json({ success: false, error: "激活码无效或已被使用" }, { status: 400 });
  }

  const secret = passSecret();
  if (!secret) {
    console.error("缺少 PASS_SECRET，无法签发权益凭证");
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const ipHash = hashIp(clientIp(req));
  const attemptKey = `redeem:${ipHash}`;

  try {
    if ((await readCount(attemptKey)) >= REDEEM_IP_DAILY_LIMIT) {
      return NextResponse.json(
        { success: false, error: "尝试过于频繁，请稍后再试" },
        { status: 429 }
      );
    }
    // 计数含成功与失败：只统计成功会让失败路径无限可试
    await bumpCount(attemptKey);
  } catch (err) {
    console.error("兑换限次失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  let outcome;
  try {
    // 用户在 /fortune 之外直接兑换时还没有设备 cookie，这是正常路径，记 anon
    const who = req.cookies.get(DEVICE_COOKIE)?.value.slice(0, 8) ?? "anon";
    outcome = await redeemCode(code, who);
  } catch (err) {
    console.error("核销失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  if (!outcome.ok) {
    // 刻意不区分"不存在"与"已用" —— 区分了就等于给爆破者一个进度条
    return NextResponse.json({ success: false, error: "激活码无效或已被使用" }, { status: 400 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const current = verify(req.cookies.get(PASS_COOKIE)?.value, secret, nowSec) ?? EMPTY_ENTITLEMENT;

  // 合并而非覆盖：已有一张未用的塔罗券时再兑换会员码，券不该被吞掉
  const merged: Entitlement =
    outcome.kind === "member"
      ? grantMember(current, outcome.days ?? 0, nowSec)
      : grantPass(current, outcome.mode ?? "", 1, SINGLE_PASS_DAYS, nowSec);

  const res = NextResponse.json({
    success: true,
    entitlement: toSummary(merged, nowSec),
  });
  return setPassCookie(res, sign(merged, secret));
}
```

- [ ] **Step 2: 写权益查询路由**

创建 `src/app/api/entitlement/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { toSummary, verify } from "@/lib/entitlement";
import { passSecret } from "@/lib/server/runtime";

export const runtime = "nodejs";

const PASS_COOKIE = "xj_pass";

const EMPTY = { member: false, passes: [] as { mode: string; remaining: number }[] };

export async function GET(req: NextRequest) {
  const secret = passSecret();
  if (!secret) {
    // 未配置签名密钥时把权益一律视为不存在 —— 免费模式仍可用，付费模式自然不可用
    return NextResponse.json(EMPTY);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const ent = verify(req.cookies.get(PASS_COOKIE)?.value, secret, nowSec);
  return NextResponse.json(toSummary(ent, nowSec));
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 4: 端到端冒烟（内存兜底）**

不需要 Supabase 就能验完这条链路。往 `.env.local` **追加**三行（保留已有的 `DEEPSEEK_API_KEY`，Task 5 还要用它验放行）：

```bash
cat >> .env.local <<'EOF'
PASS_SECRET=dev-secret-at-least-32-bytes-long!!!!
DEV_REDEEM_CODES=XMEMBER30AAAAAAA:member::30,XTART1BBBBBBBBBB:single:tarot:1
EOF
```

> 两个种子码都是 **16 位**、且只用了 Crockford 字母表里的字符（去掉了 I L O U）——
> 否则会被 `isValidCodeFormat` 挡在门外，冒烟第一步就红。
> `.env.local` 已被 `.gitignore` 忽略，不会进仓库。

启动开发服务器并开另一个终端：

```bash
npm run dev
```

```bash
# 1. 未持凭证 → 空态
curl -s localhost:3000/api/entitlement
# 期望：{"member":false,"passes":[]}

# 2. 兑换会员码 → 拿到 cookie
curl -s -c /tmp/xj.txt -X POST localhost:3000/api/redeem \
  -H 'Content-Type: application/json' -d '{"code":"XMEMBER30AAAAAAA"}'
# 期望：{"success":true,"entitlement":{"member":true,"expiresAt":...,"passes":[]}}

# 3. 带 cookie 查询 → 会员生效
curl -s -b /tmp/xj.txt localhost:3000/api/entitlement
# 期望：{"member":true,...}

# 4. 同一个码再兑一次 → 400
curl -s -b /tmp/xj.txt -X POST localhost:3000/api/redeem \
  -H 'Content-Type: application/json' -d '{"code":"XMEMBER30AAAAAAA"}'
# 期望：{"success":false,"error":"激活码无效或已被使用"}

# 5. 格式不对的码 → 400，且不消耗数据库往返
curl -s -X POST localhost:3000/api/redeem \
  -H 'Content-Type: application/json' -d '{"code":"short"}'
# 期望：{"success":false,"error":"激活码无效或已被使用"}

# 6. 单次券
curl -s -c /tmp/xj2.txt -X POST localhost:3000/api/redeem \
  -H 'Content-Type: application/json' -d '{"code":"XTART1BBBBBBBBBB"}'
# 期望：{"success":true,"entitlement":{"member":false,"passes":[{"mode":"tarot","remaining":1}]}}

# 7. 篡改 cookie 载荷 → 权益失效
FORGED=$(node -e 'console.log(Buffer.from(JSON.stringify({v:1,member:4000000000,passes:[]})).toString("base64url")+".AAAA")')
curl -s -H "Cookie: xj_pass=$FORGED" localhost:3000/api/entitlement
# 期望：{"member":false,"passes":[]}
```

- [ ] **Step 5: 提交**

```bash
git add src/app/api/redeem/route.ts src/app/api/entitlement/route.ts
git commit -m "🎟️ 新增兑换与权益接口：一码一次，签发签名凭证"
```

---

### Task 5: /api/fortune 接入凭证

**Files:**
- Modify: `src/app/api/fortune/route.ts`
- Modify: `tests/route-contract.test.mts`
- Delete: `src/lib/quota-policy.ts`、`tests/quota-policy.test.mts`（路由切过去之后，旧模块才没人用）

**Interfaces:**
- Consumes: Task 1 的 `verify` / `sign` / `consumePass` / `toSummary`；Task 2 的 `decideAccess`；Task 3 的 `passSecret`
- Produces: `/api/fortune` 的响应新增 `entitlement` 字段（`EntitlementSummary`），并在消耗单次券时重新签发 `xj_pass`

- [ ] **Step 1: 先改测试（这是本任务的验收标准）**

`tests/route-contract.test.mts` 的 `decideQuota(counts` 断言会随模块改名而失效，同时要补上"先验凭证"这一条。把第 28-34 行那条测试替换为：

```ts
test("凭证校验发生在放行判定之前", () => {
  const iVerify = src.indexOf("verify(req.cookies.get(PASS_COOKIE)");
  const iAccess = src.indexOf("decideAccess(checked.mode");
  const iAi = src.indexOf("await getFortune(");
  assert.ok(iVerify >= 0, "未验凭证");
  assert.ok(iAccess >= 0, "未调用 decideAccess");
  assert.ok(iAi >= 0, "未调用 getFortune");
  assert.ok(iVerify < iAccess, "必须先验凭证 —— 否则会员身份无从得知");
  assert.ok(iAccess < iAi, "必须先判放行再调用 AI，否则限流拦不住任何请求");
});
```

并在文件末尾追加：

```ts
test("付费模式不再能吃免费额度", () => {
  assert.match(src, /isFreeMode/, "必须按模式区分免费与付费，否则付费模式在服务端可白嫖");
});

test("消耗单次券时重新签发凭证", () => {
  assert.match(src, /consumePass/, "单次券用掉后必须把次数减回去，否则一次付款无限次使用");
});

test("拒绝时回传服务端状态码", () => {
  assert.match(src, /decision\.status/, "限流状态码应由判定结果给出，而不是路由里另写一套");
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— 四条新断言中至少三条失败（现有路由里没有 `PASS_COOKIE`、没有 `decideAccess`、没有 `consumePass`）

- [ ] **Step 3: 重写 /api/fortune**

`src/app/api/fortune/route.ts` 整份替换：

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getFortune } from "@/lib/ai";
import { MODES, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT, isFreeMode, type Mode } from "@/lib/pricing";
import { validateFortuneRequest } from "@/lib/validation";
import { decideAccess } from "@/lib/access";
import { consumePass, sign, toSummary, verify } from "@/lib/entitlement";
import { readUsage, bumpUsage, hashIp, dailyGlobalBudget } from "@/lib/server/usage-store";
import { passSecret } from "@/lib/server/runtime";

// 用到 node:crypto 做 IP 哈希与签名，必须显式声明 Node 运行时
export const runtime = "nodejs";

const DEVICE_COOKIE = "xj_dev";
const PASS_COOKIE = "xj_pass";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const YEAR_SECONDS = COOKIE_MAX_AGE;

function clientIp(req: NextRequest): string {
  // Vercel 会在 x-forwarded-for 里给出真实来源，取第一段
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

function withDeviceCookie(res: NextResponse, deviceId: string, isNew: boolean): NextResponse {
  if (isNew) {
    res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: YEAR_SECONDS,
    });
  }
  return res;
}

function withPassCookie(res: NextResponse, token: string | null): NextResponse {
  if (token === null) {
    res.cookies.set(PASS_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  res.cookies.set(PASS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR_SECONDS,
  });
  return res;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const checked = validateFortuneRequest(body, Object.keys(MODES));
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
  }

  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existing ?? randomUUID();
  const isNewDevice = existing === undefined;
  const ipHash = hashIp(clientIp(req));

  const nowSec = Math.floor(Date.now() / 1000);
  const secret = passSecret();
  // 没配密钥时把权益视为不存在：免费模式照常可用，付费模式自然不可用
  const entitlement = secret
    ? verify(req.cookies.get(PASS_COOKIE)?.value, secret, nowSec)
    : null;

  let counts;
  try {
    counts = await readUsage(deviceId, ipHash);
  } catch (err) {
    // 读不到计数就不能放行 —— 限流失效时宁可拒绝，也不能敞开烧钱
    console.error("用量读取失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const decision = decideAccess(
    checked.mode,
    counts,
    { device: FREE_DAILY_QUOTA, ip: FREE_IP_DAILY_LIMIT, global: dailyGlobalBudget() },
    entitlement,
    isFreeMode(checked.mode as Mode),
    nowSec
  );

  if (!decision.allow) {
    return withDeviceCookie(
      NextResponse.json(
        { success: false, error: decision.message, remaining: 0 },
        { status: decision.status }
      ),
      deviceId,
      isNewDevice
    );
  }

  const result = await getFortune(checked.mode, checked.input);

  if (!result.success) {
    // 失败不记账：服务端出错不该由用户承担额度或次数
    return withDeviceCookie(
      NextResponse.json(result, { status: 500 }),
      deviceId,
      isNewDevice
    );
  }

  let remaining = Math.max(0, FREE_DAILY_QUOTA - counts.device);
  let updatedEntitlement = entitlement;

  if (decision.consume === "quota") {
    remaining = Math.max(0, FREE_DAILY_QUOTA - (counts.device + 1));
    try {
      await bumpUsage(deviceId, ipHash);
    } catch (err) {
      // 记账失败不影响本次结果，但要留痕
      console.error("用量记账失败:", err);
      remaining = Math.max(0, remaining - 1); // 记不上账就按更保守的数字显示
    }
  } else if (typeof decision.consume === "object") {
    // 单次券：只在 AI 成功之后才扣减
    updatedEntitlement = consumePass(entitlement!, decision.consume.mode, nowSec);
  }

  const res = NextResponse.json({
    ...result,
    remaining,
    entitlement: toSummary(updatedEntitlement, nowSec),
  });

  const withDevice = withDeviceCookie(res, deviceId, isNewDevice);
  // 只有单次券在消耗时才需要重签 —— 会员与免费路径的凭证没有变化
  return typeof decision.consume === "object"
    ? withPassCookie(withDevice, updatedEntitlement ? sign(updatedEntitlement, secret!) : null)
    : withDevice;
}
```

- [ ] **Step 4: 删除被取代的模块与它的测试**

路由已切到 `decideAccess`，`decideQuota` 至此无人引用。`access.ts` 完全覆盖了它的职责 ——
留着两个判定模块，将来改一处忘另一处就是线上事故。

```bash
git rm src/lib/quota-policy.ts tests/quota-policy.test.mts
```

- [ ] **Step 5: 确认没有残留引用**

Run: `grep -rn "quota-policy\|decideQuota" src/ tests/`
Expected: 无输出

- [ ] **Step 6: 运行测试与类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS，tsc 无输出

- [ ] **Step 7: 端到端验证放行与拒绝**

沿用 Task 4 的 `.env.local` 与开发服务器：

```bash
# 未持凭证打付费模式 → 403（此前会白送 3 次）
curl -s -X POST localhost:3000/api/fortune \
  -H 'Content-Type: application/json' -d '{"mode":"bazi","birthDate":"1990-01-01"}'
# 期望：{"success":false,"error":"该模式需激活后使用"}

# 未持凭证打免费模式 → 正常走额度（会调用 DeepSeek，需真实 key）
curl -s -X POST localhost:3000/api/fortune \
  -H 'Content-Type: application/json' -d '{"mode":"daily"}'
# 期望：200，响应里带 remaining 与 entitlement

# 持会员凭证打付费模式 → 放行（不再 429）
curl -s -b /tmp/xj.txt -X POST localhost:3000/api/fortune \
  -H 'Content-Type: application/json' -d '{"mode":"bazi","birthDate":"1990-01-01"}'
# 期望：200

# 持单次券打塔罗 → 200，且响应里的 entitlement.passes 变为空
curl -s -b /tmp/xj2.txt -c /tmp/xj2.txt -X POST localhost:3000/api/fortune \
  -H 'Content-Type: application/json' -d '{"mode":"tarot","question":"test"}'
# 期望：200，entitlement.passes 为 []

# 券用完之后再打一次 → 403
curl -s -b /tmp/xj2.txt -X POST localhost:3000/api/fortune \
  -H 'Content-Type: application/json' -d '{"mode":"tarot","question":"test"}'
# 期望：{"success":false,"error":"该模式需激活后使用"}
```

- [ ] **Step 8: 构建**

Run: `npx next build`
Expected: 构建成功

- [ ] **Step 9: 提交**

```bash
git add src/app/api/fortune/route.ts tests/route-contract.test.mts
git rm src/lib/quota-policy.ts tests/quota-policy.test.mts
git commit -m "🔐 路由接入凭证：会员豁免额度，付费模式必须持证"
```

---

### Task 6: 支付弹窗改成兑换

**Files:**
- Create: `src/lib/contact.ts`
- Modify: `src/components/PaymentModal.tsx`

**Interfaces:**
- Consumes: Task 1 的 `EntitlementSummary` 类型；`@/lib/pricing` 的 `formatPrice`
- Produces: `PaymentModal` 的新 props —— `{ open, onClose, title, price, onRedeemed: (summary: EntitlementSummary) => void }`（`onConfirm` 移除）

- [ ] **Step 1: 建联系方式配置**

创建 `src/lib/contact.ts`：

```ts
/**
 * 站长联系方式。
 *
 * 激活码是手工发放的 —— 用户付款后必须知道找谁要码，否则整条链路断层。
 * 上线前必须把这里填上真实值；留空时界面会显示"暂未设置"的兜底文案。
 */
export const CONTACT_LABEL = ""; // 例："微信 xuange2026"
export const CONTACT_READY = CONTACT_LABEL.trim().length > 0;
```

- [ ] **Step 2: 改造 PaymentModal**

`src/components/PaymentModal.tsx` 整份替换：

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Seal } from "./Glyph";
import { CONTACT_LABEL, CONTACT_READY } from "@/lib/contact";
import type { EntitlementSummary } from "@/lib/entitlement";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  price: string;
  onRedeemed: (summary: EntitlementSummary) => void;
}

export default function PaymentModal({ open, onClose, title, price, onRedeemed }: Props) {
  const [step, setStep] = useState<"pay" | "redeem">("pay");
  // 收款码是站长的外部资源，缺失时给出可读的占位，而不是一个碎图标
  const [qrFailed, setQrFailed] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    setStep("pay");
    setCode("");
    setError(null);
    onClose();
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        const summary = data.entitlement as EntitlementSummary;
        setStep("pay");
        setCode("");
        onRedeemed(summary);
      } else {
        setError(data.error || "激活码无效");
      }
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative mystic-card rounded-xl p-8 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "pay" ? (
              <>
                <div className="flex justify-center mb-4"><Seal char="缘" size={48} /></div>
                <h3
                  className="text-xl text-gold mb-2"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  {title}
                </h3>
                <div className="price-tag mb-4 justify-center">
                  <span className="symbol">¥</span>
                  <span className="amount">{price}</span>
                </div>

                <div className="bg-white rounded-lg p-3 mb-4 mx-auto flex flex-col items-center">
                  <p className="text-gray-700 text-xs mb-2 font-medium">支付宝扫码支付</p>
                  {qrFailed ? (
                    <div className="w-52 h-64 flex items-center justify-center rounded border border-dashed border-gray-300 px-4 text-center">
                      <span className="text-gray-400 text-xs leading-relaxed">
                        收款码暂未就绪
                        <br />
                        请稍后再试
                      </span>
                    </div>
                  ) : (
                    <>
                      {/* 收款码是整张竖版海报（1260×1890），强塞进正方形会让二维码缩到约 100px、
                          扫不动。所以只固定宽度、按原始比例显示（渲染约 208×312，二维码约 180px）。 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/qrcode.jpg"
                        alt="支付宝收款码"
                        className="w-52 h-auto rounded"
                        onError={() => setQrFailed(true)}
                      />
                      <p className="text-gray-400 text-[10px] mt-2">长按识别或截图扫描</p>
                    </>
                  )}
                </div>

                <div className="text-paper-100/45 text-xs mb-6 leading-relaxed">
                  付款后将支付截图发给我，即可获得激活码。
                  <br />
                  {CONTACT_READY ? (
                    <span className="text-gold-300">{CONTACT_LABEL}</span>
                  ) : (
                    <span className="text-vermillion-400/70">联系方式暂未设置</span>
                  )}
                </div>

                <div className="flex gap-3">
                  <button onClick={handleClose} className="btn-mystic flex-1 !py-2 !text-sm">
                    取消
                  </button>
                  <button
                    onClick={() => setStep("redeem")}
                    className="btn-primary flex-1 !py-2 !text-sm"
                  >
                    我已付款
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleRedeem}>
                <div className="flex justify-center mb-5"><Seal char="圆" size={64} /></div>
                <h3
                  className="text-xl text-gold mb-3"
                  style={{ fontFamily: "'Noto Serif SC', serif" }}
                >
                  输入激活码
                </h3>
                <p className="text-paper-100/45 text-xs mb-5 leading-relaxed">
                  一码只能用一次，请勿转发他人。
                </p>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXXXXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-center tracking-[0.2em] text-paper-100/80 placeholder:text-paper-100/20 focus:border-gold-300/50 focus:outline-none transition-colors mb-4"
                />
                {error && (
                  <p className="text-vermillion-400 text-xs mb-4">{error}</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setStep("pay"); setError(null); }}
                    className="btn-mystic flex-1 !py-2 !text-sm"
                  >
                    返回
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || code.trim().length === 0}
                    className="btn-primary flex-1 !py-2 !text-sm disabled:opacity-50"
                  >
                    {submitting ? "验证中..." : "立即解锁"}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 报出 `FortuneForm.tsx` 与 `member/page.tsx` 仍在传 `onConfirm` —— 这两处在 Task 7 改。

> 若想让每一步都保持可编译，可以在 Task 7 完成后再回头跑本步。这里先记下预期错误，不要为了让 tsc 安静而临时加回 `onConfirm`。

- [ ] **Step 4: 提交**

```bash
git add src/lib/contact.ts src/components/PaymentModal.tsx
git commit -m "🎟️ 支付弹窗改为激活码兑换：点一下就白嫖的口子关上"
```

---

### Task 7: 前端权益改由服务端驱动

删掉所有本地会员状态，改由 `/api/entitlement` 驱动。回归守卫测试是本任务的验收标准。

**Files:**
- Create: `src/components/EntitlementProvider.tsx`、`tests/no-fake-unlock.test.mts`
- Modify: `src/app/layout.tsx`、`src/components/FortuneForm.tsx`、`src/components/Header.tsx`、`src/components/QuotaBanner.tsx`、`src/app/member/page.tsx`、`src/lib/store.ts`

**Interfaces:**
- Consumes: `GET /api/entitlement`、Task 6 的 `PaymentModal`
- Produces: `useEntitlement(): { summary: EntitlementSummary; loading: boolean; refresh: () => Promise<void>; setSummary: (s: EntitlementSummary) => void }`

- [ ] **Step 1: 写回归守卫测试**

创建 `tests/no-fake-unlock.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../src/", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

test("store 里不再有本地会员状态", () => {
  const store = read("lib/store.ts");
  for (const name of ["isMember", "setMember", "setMemberExpiry", "isMemberExpired"]) {
    assert.doesNotMatch(store, new RegExp(`export function ${name}\\b`), `store.ts 仍在导出 ${name}`);
  }
});

test("没有任何组件再写本地会员标记", () => {
  for (const rel of [
    "app/member/page.tsx",
    "components/FortuneForm.tsx",
    "components/QuotaBanner.tsx",
    "components/Header.tsx",
  ]) {
    const src = read(rel);
    assert.doesNotMatch(src, /\bsetMember\b/, `${rel} 仍在写本地会员状态`);
    assert.doesNotMatch(src, /xuanji_member\b/, `${rel} 仍在读本地会员标记`);
  }
});

test("付费解锁不再依赖本地 hasPaid 状态", () => {
  // 「点一下已完成支付就解锁」正是这轮要堵的口子
  assert.doesNotMatch(read("components/FortuneForm.tsx"), /hasPaid/);
});

test("支付弹窗走的是兑换接口，而不是直接放行", () => {
  const modal = read("components/PaymentModal.tsx");
  assert.match(modal, /\/api\/redeem/, "必须真的调用兑换接口");
  assert.doesNotMatch(modal, /onConfirm/, "旧的直接放行回调必须移除");
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— 四条全红（本地会员状态还在，弹窗也还是 `onConfirm`）

- [ ] **Step 3: 建权益上下文**

创建 `src/components/EntitlementProvider.tsx`：

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { EntitlementSummary } from "@/lib/entitlement";

/**
 * 权益状态。
 *
 * 会员身份的唯一真相在服务端的签名 cookie 里，前端这份只是它的显示副本。
 * 三个地方要用（Header 的徽章、QuotaBanner、FortuneForm 的按钮文案），
 * 放上下文里共享一次请求，而不是各拉一遍。
 */

const EMPTY: EntitlementSummary = { member: false, passes: [] };

interface State {
  summary: EntitlementSummary;
  loading: boolean;
  refresh: () => Promise<void>;
  setSummary: (s: EntitlementSummary) => void;
}

const EntitlementContext = createContext<State>({
  summary: EMPTY,
  loading: true,
  refresh: async () => {},
  setSummary: () => {},
});

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const [summary, setSummary] = useState<EntitlementSummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/entitlement", { cache: "no-store" });
      if (res.ok) setSummary((await res.json()) as EntitlementSummary);
    } catch {
      // 拉不到就维持现状：权益的真实判定在服务端，这里只是显示
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <EntitlementContext.Provider value={{ summary, loading, refresh, setSummary }}>
      {children}
    </EntitlementContext.Provider>
  );
}

export const useEntitlement = () => useContext(EntitlementContext);
```

- [ ] **Step 4: 挂载到 layout**

`src/app/layout.tsx`：在 import 区加一行，并包住 `{children}`。

```tsx
import { EntitlementProvider } from "@/components/EntitlementProvider";
```

```tsx
        <EntitlementProvider>
          {children}
        </EntitlementProvider>
```

- [ ] **Step 5: 清理 store.ts 的本地会员状态**

`src/lib/store.ts`：删除 `KEYS` 里的 `MEMBER`、以及 `isMember` / `setMember` / `setMemberExpiry` / `isMemberExpired` 四个函数（第 16、47-65 行一带）。文件末尾补一段说明：

```ts
// 会员状态已改为服务端签发（见 lib/entitlement.ts 与 api/entitlement）。
// 本地这四个函数曾是「点一下就解锁」白嫖路径的一部分，于 2026-10-02 移除。
// getFreeQuota / consumeFreeQuota 保留，但降级为纯展示估算 ——
// 限流的真实依据在服务端，每次响应都会回传 remaining。
```

- [ ] **Step 6: 改 Header**

`src/components/Header.tsx`：
- 删掉 `import { getHistory, isMember } from "@/lib/store";` 里的 `isMember`，改为 `import { getHistory } from "@/lib/store";`
- 加 `import { useEntitlement } from "./EntitlementProvider";`
- 删掉 `const [member, setMember] = useState(false);`，改为 `const { summary } = useEntitlement();`
- `useEffect` 里删掉两处 `setMember(isMember())`（初始与 `onStorage` 内），只留 `setHasReadings`
- 渲染处的 `member &&` 改为 `summary.member &&`（第 63 行与第 90 行两处）

- [ ] **Step 7: 改 QuotaBanner**

`src/components/QuotaBanner.tsx`：
- 删掉 `import { getFreeQuota, isMember } from "@/lib/store";` 里的 `isMember`，改为 `import { getFreeQuota } from "@/lib/store";`
- 加 `import { useEntitlement } from "./EntitlementProvider";`
- 删掉 `const [member, setMember] = useState(false);` 与 `useEffect` 里的 `setMember(isMember())`
- 加 `const { summary } = useEntitlement();`，把 `if (member)` 改为 `if (summary.member)`

- [ ] **Step 8: 改 FortuneForm**

`src/components/FortuneForm.tsx`：

删掉第 7 行 import 里的 `isMember` 与第 58 行的 `hasPaid` state，改为用上下文。具体三处：

```tsx
import { consumeFreeQuota, saveReading, getFreeQuota } from "@/lib/store";
```

```tsx
import { useEntitlement } from "./EntitlementProvider";
```

```tsx
  const { summary, setSummary } = useEntitlement();
```

删掉 `const [member, setMember] = useState(false);` 与 `const [hasPaid, setHasPaid] = useState(false);`，以及 `useEffect` 里的 `setMember(isMember())`。

`handleSubmit` 改为：

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isFree) { if (!consumeFreeQuota()) { setPaymentOpen(true); return; } await callFortuneAPI(); return; }
    // 付费模式：持会员或持本模式的单次券都放行，其余一律走兑换
    if (summary.member || summary.passes.some((p) => p.mode === mode)) { await callFortuneAPI(); return; }
    setPaymentOpen(true);
  };
```

`handlePaymentConfirm` 改为：

```tsx
  const handlePaymentConfirm = async (ent: EntitlementSummary) => {
    setSummary(ent);
    setPaymentOpen(false);
    await callFortuneAPI();
  };
```

`callFortuneAPI` 里把 `setMember(isMember());` 删掉，改为以服务端回传的权益为准：

```tsx
        if (data.entitlement) setSummary(data.entitlement as EntitlementSummary);
```

文件顶部加类型导入：

```tsx
import type { EntitlementSummary } from "@/lib/entitlement";
```

`PaymentModal` 的调用处改为：

```tsx
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={isFree ? "今日免费次数已用完" : title} price={formatPrice(isFree ? MEMBER_PLANS[0].price : modeInfo.price)} onRedeemed={handlePaymentConfirm} />
```

按钮文案里的 `member` 改为 `summary.member`（第 114、134、136 行），"重新测算"按钮 `onClick` 里的 `setHasPaid(false)` 删掉。

分享文案里残留的 `?ref=` 一并删掉（邀请裂变已移除，该参数永远是空的）：

```tsx
    const shareText = `🔮 我在「玄机」算了一卦，太准了！\n\n${text.slice(0, 200)}...\n\n👉 ${window.location.origin}\n\n免费体验 AI 算命，知己命，掌人生！`;
```

- [ ] **Step 9: 改 member 页**

`src/app/member/page.tsx`：
- import 改为 `import { useEntitlement } from "@/components/EntitlementProvider";`，删掉 `import { isMember, setMember, setMemberExpiry } from "@/lib/store";`
- 删掉 `const [alreadyMember, setAlreadyMember] = useState(false);` 与 `useEffect(() => { setAlreadyMember(isMember()); }, []);`
- 加 `const { summary, setSummary } = useEntitlement();`
- `handleConfirm` 改为：

```tsx
  const handleConfirm = (ent: EntitlementSummary) => {
    setSummary(ent);
    setPurchased(true);
    setPaymentOpen(false);
  };
```

- `if (purchased || alreadyMember)` 改为 `if (purchased || summary.member)`
- `PaymentModal` 的 `onConfirm={handleConfirm}` 改为 `onRedeemed={handleConfirm}`
- 顶部加 `import type { EntitlementSummary } from "@/lib/entitlement";`

- [ ] **Step 10: 运行测试与类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全部 PASS（含 4 条新的守卫测试），tsc 无输出

- [ ] **Step 11: 构建**

Run: `npx next build`
Expected: 构建成功

- [ ] **Step 12: 提交**

```bash
git add src/ tests/no-fake-unlock.test.mts
git commit -m "🧹 前端权益改由服务端驱动：删掉全部本地会员假状态"
```

---

### Task 8: 文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 补 README**

在 `README.md` 的「环境变量」一节后插入：

````markdown
## 收费与激活码

付费模式（八字 / 塔罗 / 姻缘）的解锁凭证是**激活码**。没有商户资质做不了自动回调，
所以码由站长手工发放 —— 一次生成一批，不必逐单盯着。

**首次部署需要两步**：在 Supabase 的 SQL Editor 里执行 `supabase/redeem.sql`，
并在环境变量里配上 `PASS_SECRET`（生成方式见 `.env.example`）。

### 发码

```bash
node --env-file=.env.local scripts/gen-codes.mjs --kind member --days 30 --count 20 --batch 2026-10
node --env-file=.env.local scripts/gen-codes.mjs --kind single --mode tarot --count 50 --batch 2026-10
```

用户付款后，把其中一个码发给对方，站内输入即解锁。**一码只能用一次** ——
核销由数据库的 `redeem_code` 函数以原子 UPDATE 完成，并发下也不会双花。

### 权益是怎么生效的

兑换成功后服务端签发一张 HMAC 签名的 httpOnly cookie（`xj_pass`），
会员与单次通行证合并存放其中。此后每次测算只验签、不查库 —— 权益就在凭证里。

- 会员：全模式无限次，且**不消耗**每日免费额度
- 单次券：限一个模式、用一次、7 天内有效
- **全局熔断对会员同样生效** —— 那道闸保护的是 API 账单，不是公平性

### 换设备会怎样

凭证在 cookie 里，**换浏览器或清除 cookie 会「丢失」会员**。这是当前已知的局限，
根治需要账号体系。补救办法：`redeem_codes` 表里有 `batch` 与 `redeemed_by`，
可人工核查后补发一个码。

### PASS_SECRET

泄露等于任何人可自签会员。**轮换会使已发出的全部凭证失效**，届时需要重新发码。
````

- [ ] **Step 2: 修正「已知待办」**

把 README 末尾的「已知待办」一节替换为：

```markdown
## 已知待办

- 账号体系与 `readings` 上云（当前记录只在 localStorage，换设备即丢；会员也因此无法跨设备）
- 订单表与自动支付（需商户资质；当前用激活码替代）
- 管理后台（发码目前靠 `scripts/gen-codes.mjs`）
- 法律页：用户协议、隐私政策、免责声明（`Footer.tsx` 里两处 `href="#"` 是死链）
- **`src/lib/contact.ts` 里的联系方式 —— 不填则付费链路是断的**：给了码也没人知道找谁要
- 收款码 `public/qrcode.jpg` 是支付宝的，若将来换微信需同步改 `PaymentModal` 的文案与 `alt`
```

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "📝 README 补发码与凭证说明"
```

---

## 完成后的验收

逐条确认（`npm test` 全绿、`npx next build` 成功是前提）：

- [ ] 控制台执行 `localStorage.setItem('xuanji_member','true')` 后刷新，**不会**变成会员
- [ ] 未持凭证 POST `{mode:"bazi"}` → 403，不再白送 3 次
- [ ] 兑换有效码 → 200 且写入 `xj_pass`；再请求该模式 → 200
- [ ] 同一个码第二次兑换 → 400
- [ ] 手工篡改 cookie 载荷 → 权益失效
- [ ] 全局熔断触发时，会员请求同样被拒（503）
- [ ] 免费模式额度仍是 3 次/日，第 4 次 429
- [ ] 会员使用免费模式不扣免费额度
- [ ] 单次凭证用一次后 `remaining` 归零，再用 → 403
- [ ] `grep -rn "sk-\|PASS_SECRET" .next/static/` 无输出（密钥未进客户端包）
- [ ] `grep -rn "isMember\|setMember\|hasPaid" src/` 无输出

## 明确不在本轮

- 登录页与账号体系（会员无法跨设备，是已知局限）
- `readings` 上云
- 订单表、自动支付回调、管理后台
- 三个法律页与 `Footer.tsx` 的死链
