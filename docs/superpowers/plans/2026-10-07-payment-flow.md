# 玄机支付流程改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把付费流程从「手输金额 + 邮件往返 + 人工发码」改成「金额服务端锁定 + 手机扫码直付 + 设备自动到账」，激活码退为跨设备兜底。

**Architecture:** 新增 `orders` 表与五个 SQL 函数承载订单状态机；`/api/order` 建单，`/api/order/status` 轮询并在设备匹配时把权益签进现有的 HMAC cookie；权益快照存在订单行上以保证响应丢失后可恢复。支付渠道抽象成 `pay.ts` 一个函数，为将来接聚合支付留缝。

**Tech Stack:** Next.js 14 App Router（`runtime = "nodejs"`）、TypeScript、Supabase（Postgres + RPC）、Tailwind、`node --test`

**Spec:** `docs/superpowers/specs/2026-10-07-xuanji-payment-design.md`

## Global Constraints

- 价格唯一来源是 `src/lib/pricing.ts`。任何路由、组件、SQL 都不得写死数字。`tests/no-hardcoded-prices.test.mts` 会检查。
- 权益唯一载体是 HMAC 签名的 `xj_pass` cookie（`src/lib/server/pass-cookie.ts`）。不引入第二套权益机制。
- 权益变更必须过 `withTid()`。`withPassCookie()` 内部已经统一过一道，不要绕过它。
- 所有 `security definer` 的 SQL 函数必须在 `supabase/security.sql` 里补 `revoke ... from public`（`supabase/redeem.sql:35` 的注释指的就是这个坑）。
- 服务端专用变量严禁加 `NEXT_PUBLIC_` 前缀。
- 生产环境未配 Supabase 时一律 503 拒绝服务，不静默降级（`src/lib/server/runtime.ts` 的 `allowMemoryFallback`）。
- 测试文件用 `node:test` + `node:assert/strict`。直接 import `src/` 模块时写相对路径带 `.ts` 后缀（见 `tests/entitlement-merge.test.mts`）。
- 测试运行命令：`node --test --import ./scripts/ts-loader.mjs`（Task 0 落地后的 `package.json` `test` 脚本）。裸 `node --test` 解析不了 `@/` 别名。
- `tsconfig.json` 的 `target` 是 `ES2020`，`allowImportingTsExtensions` 已打开。`src/lib/server/codes.ts:30` 有一条注释说 target 未设、需用 `Array.from()` 绕开 TS2802 —— **那条注释已经过时**，不要再照着它写。
- 应用代码之间用 `@/` 别名且不带扩展名。挂上 `ts-loader` 后 `@/` 在 `node --test` 下同样可解析，所以新模块**不必**为了可测而改用相对导入。
- `tests/*-contract.test.mts` 这类文件是把源码当文本读进来做字符串断言，不 import 源码。真正 import 源码的测试以 `tests/entitlement-merge.test.mts` 为准。
- 提交信息用中文，格式 `主体：为什么`（见 `git log`）。

## 文件结构

**新建：**

| 文件 | 职责 |
|---|---|
| `supabase/orders.sql` | `orders` 表 + 六个 SQL 函数 |
| `src/lib/pay.ts` | 支付渠道接缝：plan → 付款指示 |
| `src/lib/server/order-store.ts` | 订单数据层（含内存兜底） |
| `src/app/api/order/route.ts` | POST 建单 |
| `src/app/api/order/status/route.ts` | GET 轮询 + 自动到账 |
| `src/app/api/order/claim/route.ts` | POST 提交交易单号 |
| `src/app/api/order/code/route.ts` | POST 兜底取激活码 |
| `scripts/confirm-order.mjs` | 对账与确认（站长日常用） |
| `tests/pay.test.mts` | 接缝单测 |
| `tests/order-store.test.mts` | 订单状态机单测 |
| `tests/order-contract.test.mts` | 四个路由的契约测试 |
| `tests/codes-mint.test.mts` | 发码格式与唯一性 |

**修改：**

| 文件 | 改动 |
|---|---|
| `src/lib/pricing.ts` | 新增 `PLANS` 单一来源，`MODES`/`MEMBER_PLANS` 改为派生；新增 `ORDER_TTL_MINUTES`、`ORDER_IP_DAILY_LIMIT` |
| `src/lib/server/codes.ts` | 抽出并导出 `mintCode()` |
| `scripts/gen-codes.mjs` | 改为调用 `mintCode()`，删掉本地的 `ALPHABET`/`makeCode` |
| `supabase/security.sql` | 补六个新函数的 `revoke` |
| `scripts/check-supabase.mjs` | 体检认识 `orders` 表与六个函数 |
| `src/components/PaymentModal.tsx` | 固定金额、双渠道、轮询、获取激活码 |
| `src/app/member/page.tsx` | 传 `plan` prop |
| `src/components/FortuneForm.tsx` | 传 `plan` prop |
| `README.md` | 部署步骤补 `orders.sql`；上线清单补收款码路径 |

**新增静态资源（已备好并裁好，见 spec §6.3）：**

```
public/pay/wechat-6.60.png   ← PLANS.bazi.price
public/pay/wechat-9.90.png   ← PLANS.member_month.price
public/pay/wechat-69.00.png  ← PLANS.member_year.price
```

每价位一张**带固定金额**的微信收款码（微信支持设金额），所以扫码后金额已填好，用户不需要手输。文件名由 `PLANS` 的价格 `toFixed(2)` 推导，不写死。

三张图已由用户提供、并用 `.tmp/crop-qr.mjs` 裁成 559×559 方图入库（原始海报是 1260×1615 竖版，二维码只占约 40% 宽且印着收款人显示名）。**改价必须同时重做图片** —— 图片上的金额是物理的。

**当前只做微信**（用户 2026-10-07 决定不做支付宝）；`PayChannel.id` 类型仍保留 `"alipay" | "wechat"`，渠道清单里只列微信 —— 渠道集合易变，用数组承载它，加回支付宝只是补一行。

---

### Task 0: 修好测试基线（预存故障）

分支起点上 `npm test` 是红的，而且比看起来更糟。

`tests/ip-hash.test.mts` 与 `tests/paid-loop.test.mts` 在 **import 阶段**就崩，原因是裸 `node --test` 解析不了 `@/lib` 别名：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib'
  imported from .../src/lib/server/usage-store.ts
```

崩溃发生在注册测试之前，所以这两个文件里的用例**根本没跑**。实测对比：

| 命令 | 测试数 | 通过 | 失败 |
|---|---|---|---|
| `node --test` | 411 | 409 | 2 |
| `node --test --import ./scripts/ts-loader.mjs` | **431** | 431 | 0 |

差的 20 个不是修复带来的，是一直没跑的那批。

`scripts/ts-loader.mjs` 本来就是为这件事写的（它的注释：「让裸 node 能直接 import `src/` 下的应用代码」），只是 `package.json` 的 test 脚本没挂上它。

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: 无
- Produces: `npm test` 全绿；此后 `node --test` 的所有调用点都必须带 `--import ./scripts/ts-loader.mjs`（本计划后续任务的验证命令已按此写好）

- [ ] **Step 1: 记录修复前的状态**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 411` / `pass 409` / `fail 2`（用来确认你确实复现了这个问题）

- [ ] **Step 2: 改 test 脚本**

`package.json` 的 `scripts.test` 由：

```json
"test": "node --test"
```

改为：

```json
"test": "node --test --import ./scripts/ts-loader.mjs"
```

不要动其它脚本。`ts-loader.mjs` 只注册一个解析钩子，不转译 —— Node 24 本身能擦除类型直接跑 `.ts`。

- [ ] **Step 3: 验证**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 431` / `pass 431` / `fail 0`

若数字不是 431，说明本机的测试集合与写计划时不同（新增或删除了测试文件）。**只要 `fail 0` 即可**，不要为了凑数字去改动测试。

- [ ] **Step 4: 确认没有把别的东西带坏**

Run: `npx tsc --noEmit`
Expected: 无错误

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add package.json
git commit -m "测试挂上 ts-loader：别名解析不了，两个文件整批用例一直没跑"
```

---

### Task 1: `pricing.ts` 单表化

价格目前分在 `MODES`（`src/lib/pricing.ts:77`）与 `MEMBER_PLANS`（`src/lib/pricing.ts:88`）两处。订单需要「plan → 价格 + 权益」的单一映射。并存就是第三份真相，所以 `MODES` 与 `MEMBER_PLANS` 必须改为派生。

**Files:**
- Modify: `src/lib/pricing.ts`
- Test: `tests/pricing.test.mts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type PlanId = "bazi" | "member_month" | "member_year"`
  - `interface Plan { id: PlanId; name: string; price: number; kind: "single" | "member"; mode?: Mode; days: number }`
  - `const PLANS: Record<PlanId, Plan>`
  - `function isPlanId(v: string): v is PlanId`
  - `const ORDER_TTL_MINUTES = 30`
  - `const ORDER_IP_DAILY_LIMIT = 20`

- [ ] **Step 1: 写失败的测试**

在 `tests/pricing.test.mts` 末尾追加：

```ts
import { PLANS, isPlanId, MODES, MEMBER_PLANS } from "../src/lib/pricing.ts";

test("PLANS 是价格的唯一来源，MODES 与 MEMBER_PLANS 由它派生", () => {
  assert.equal(MODES.bazi.price, PLANS.bazi.price);
  assert.equal(MODES.bazi.title, PLANS.bazi.name);

  const month = MEMBER_PLANS.find((p) => p.id === "member_month");
  const year = MEMBER_PLANS.find((p) => p.id === "member_year");
  assert.equal(month?.price, PLANS.member_month.price);
  assert.equal(month?.days, PLANS.member_month.days);
  assert.equal(year?.price, PLANS.member_year.price);
  assert.equal(year?.days, PLANS.member_year.days);
});

test("价格数值与改造前一致（改这个测试等于改价，先想清楚）", () => {
  assert.equal(PLANS.bazi.price, 6.6);
  assert.equal(PLANS.member_month.price, 9.9);
  assert.equal(PLANS.member_year.price, 69);
  assert.equal(PLANS.bazi.kind, "single");
  assert.equal(PLANS.bazi.mode, "bazi");
  assert.equal(PLANS.member_month.kind, "member");
});

test("单次计划的 days 与 SINGLE_PASS_DAYS 同源", () => {
  assert.equal(PLANS.bazi.days, SINGLE_PASS_DAYS);
});

test("isPlanId 只认已知计划", () => {
  assert.equal(isPlanId("bazi"), true);
  assert.equal(isPlanId("member_year"), true);
  assert.equal(isPlanId("member_lifetime"), false);
  assert.equal(isPlanId("__proto__"), false, "不能把原型链上的键当计划");
});
```

文件顶部若尚未 import `SINGLE_PASS_DAYS`，一并加上。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --import ./scripts/ts-loader.mjs tests/pricing.test.mts`
Expected: FAIL —— `PLANS` 未定义 / 导入报错

- [ ] **Step 3: 实现**

在 `src/lib/pricing.ts` 的 `SINGLE_PASS_DAYS`（第 19 行）之后插入：

```ts
/** 订单有效期（分钟）。过期后前端提示重新下单，但过期单仍可被人工确认。 */
export const ORDER_TTL_MINUTES = 30;

/** 建单接口按 IP 的每日上限。防的是无限建 pending 单把对账列表炸掉。 */
export const ORDER_IP_DAILY_LIMIT = 20;

export type PlanId = "bazi" | "member_month" | "member_year";

/**
 * 可售计划。**这是全站价格的唯一来源。**
 *
 * `MODES` 与 `MEMBER_PLANS` 都由它派生 —— 三者并存就是三份真相，
 * 而价格的每一处不一致最终都会变成"界面写着 6.6、实际扣了 9.9"这种
 * 只有用户能发现的错误。
 */
export interface Plan {
  id: PlanId;
  name: string;
  /** 单位：元 */
  price: number;
  kind: "single" | "member";
  /** kind === "single" 时必有 */
  mode?: Mode;
  /** kind === "member" 时为有效天数；single 用 SINGLE_PASS_DAYS */
  days: number;
}

export const PLANS: Record<PlanId, Plan> = {
  bazi: {
    id: "bazi",
    name: "八字命理",
    price: 6.6,
    kind: "single",
    mode: "bazi",
    days: SINGLE_PASS_DAYS,
  },
  member_month: { id: "member_month", name: "月卡", price: 9.9, kind: "member", days: 30 },
  member_year: { id: "member_year", name: "年卡", price: 69, kind: "member", days: 365 },
};

export function isPlanId(value: string): value is PlanId {
  // 用 hasOwnProperty：`"toString" in PLANS` 会命中原型链，把它当计划放过去
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}
```

然后把 `MODES` 与 `MEMBER_PLANS` 的字面量改为派生：

```ts
export const MODES: Record<Mode, ModeInfo> = {
  bazi: { title: PLANS.bazi.name, price: PLANS.bazi.price },
};

export const MEMBER_PLANS: ReadonlyArray<MemberPlan> = [
  {
    id: "member_month",
    name: PLANS.member_month.name,
    price: PLANS.member_month.price,
    days: PLANS.member_month.days,
  },
  {
    id: "member_year",
    name: PLANS.member_year.name,
    price: PLANS.member_year.price,
    days: PLANS.member_year.days,
  },
];
```

保留 `MODES` 上方那两行关于「刻意不放 icon 字段」的注释，位置不变。

- [ ] **Step 4: 跑测试确认通过，并跑全量回归**

Run: `node --test --import ./scripts/ts-loader.mjs tests/pricing.test.mts tests/no-hardcoded-prices.test.mts`
Expected: PASS

Run: `node --test --import ./scripts/ts-loader.mjs`
Expected: 全绿。若 `no-hardcoded-prices.test.mts` 失败，说明有地方没走派生，回去改成从 `PLANS` 取。

- [ ] **Step 5: 提交**

```bash
git add src/lib/pricing.ts tests/pricing.test.mts
git commit -m "价格收敛到 PLANS 一张表：MODES 与 MEMBER_PLANS 改为派生"
```

---

### Task 2: 抽出 `mintCode()`

`ALPHABET` 目前在 `src/lib/server/codes.ts:23` 与 `scripts/gen-codes.mjs:13` 各写一遍，生成逻辑只在脚本里。`/api/order/code` 要服务端发码，不抽出来就是第三份。

**Files:**
- Modify: `src/lib/server/codes.ts`
- Modify: `scripts/gen-codes.mjs`
- Test: `tests/codes-mint.test.mts`（新建）

**Interfaces:**
- Consumes: Task 1 无依赖
- Produces: `function mintCode(): string` —— 返回 16 位 Crockford base32 大写码

- [ ] **Step 1: 写失败的测试**

新建 `tests/codes-mint.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mintCode, isValidCodeFormat, normalizeCode } from "../src/lib/server/codes.ts";

test("mintCode 产出 16 位、格式合法、无需规范化的大写码", () => {
  const code = mintCode();
  assert.equal(code.length, 16);
  assert.equal(isValidCodeFormat(code), true);
  // 生成即已规范：内部含小写或连字符会让"生成"与"核销"两处口径漂移
  assert.equal(normalizeCode(code), code);
});

test("mintCode 不含易混字符 I L O U", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = mintCode();
    assert.doesNotMatch(code, /[ILOU]/, `生成的码里出现了易混字符: ${code}`);
  }
});

test("mintCode 不重复", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) seen.add(mintCode());
  assert.equal(seen.size, 1000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --import ./scripts/ts-loader.mjs tests/codes-mint.test.mts`
Expected: FAIL —— `mintCode` 未导出

- [ ] **Step 3: 实现**

在 `src/lib/server/codes.ts` 顶部把 `node:crypto` 的 import 补上 `randomBytes`：

```ts
import { randomBytes } from "node:crypto";
```

在 `ALPHABET` 常量下方、`normalizeCode` 之前插入：

```ts
/** 激活码长度。16 位 Crockford base32 ≈ 80 bit 熵。 */
const CODE_LENGTH = 16;

/**
 * 发码。**生成逻辑只此一处。**
 *
 * 此前它只存在于 scripts/gen-codes.mjs 里，而 ALPHABET 在本文件与那个脚本
 * 各写了一遍。订单自动发码（/api/order/code）如果就地再写一遍，就是第三份 ——
 * 三份里任何一份的字符集被改动，都会让"生成的码核销不了"这种错误只在线上出现。
 */
export function mintCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}
```

- [ ] **Step 4: 改造脚本**

编辑 `scripts/gen-codes.mjs`：

1. 删掉本地的 `const ALPHABET = ...`（第 13 行）与 `function makeCode()`（第 26 行起）
2. 顶部 import 区加：

```js
import { mintCode } from "../src/lib/server/codes.ts";
```

若该脚本由 node 直接运行而无法解析 TS，参照仓库里已有的 `scripts/ts-loader.mjs` / `scripts/ts-resolve.mjs` 装载方式（`scripts/shot.mjs` 等脚本已在用），沿用同一套 `--import` 参数。**不要**为此在本脚本内复制一份生成逻辑。
3. 把脚本内所有 `makeCode()` 调用改为 `mintCode()`

- [ ] **Step 5: 验证脚本仍能生成合法码**

Run: `node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/gen-codes.mjs --kind member --days 30 --count 1 --batch smoke`
Expected: 不再报 `ERR_MODULE_NOT_FOUND`，走到需要 Supabase 才失败的那一步

（该脚本**没有 `--help` 分支** —— `parseArgs` 会把 `--help` 当成未识别参数。所以别用 `--help` 验证。
真正发码需要 Supabase；本步验证的是「import 能解析、`mintCode()` 被真的调用到」。）

Run: `node --test --import ./scripts/ts-loader.mjs tests/codes-mint.test.mts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/server/codes.ts scripts/gen-codes.mjs tests/codes-mint.test.mts
git commit -m "发码逻辑收到一处：脚本与订单自动发码共用 mintCode"
```

---

### Task 3: `orders.sql` 与数据库收口

**Files:**
- Create: `supabase/orders.sql`
- Modify: `supabase/security.sql`
- Modify: `scripts/check-supabase.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 六个 SQL 函数，签名如下（`order-store.ts` 按这些名字调 RPC）

| 函数 | 参数 | 返回 |
|---|---|---|
| `create_order` | `p_plan text, p_amount numeric, p_device uuid, p_ttl_minutes int` | `setof orders` |
| `confirm_order` | `p_id uuid, p_by text, p_provider text` | `setof orders` |
| `expire_stale_orders` | 无 | `int` |
| `claim_order_delivery` | `p_id uuid, p_device uuid, p_granted jsonb` | `setof orders` |
| `mark_code_issued` | `p_id uuid, p_device uuid` | `setof orders` |
| `unconfirm_order` | `p_id uuid` | `setof orders` |

- [ ] **Step 1: 写 `supabase/orders.sql`**

```sql
-- 订单表与状态机。
--
-- 与 schema.sql / redeem.sql 分开放，理由同 redeem.sql 开头那段：
-- 那些已经在线上执行过，往里面追加会让人不确定该重跑哪一段。

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  plan            text not null,                    -- bazi | member_month | member_year
  amount          numeric(10,2) not null,           -- 服务端按 pricing.ts 快照，绝不信客户端
  status          text not null default 'pending',  -- pending | paid | expired
  provider        text,                             -- 用户声称的渠道：alipay | wechat
  payer_ref       text,                             -- 用户提交的交易单号
  device_id       uuid,                             -- 下单设备，自动到账靠它
  granted         jsonb,                            -- 交付时的权益快照，见 claim_order_delivery
  delivered_at    timestamptz,                      -- 权益已落设备（幂等闸）
  code_issued_at  timestamptz,                      -- 已发过激活码（幂等闸）
  paid_at         timestamptz,
  confirmed_by    text,                             -- 谁确认的，对账用
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_device_idx on public.orders (device_id);

-- ── 状态机 ────────────────────────────────────────────────
--
-- 全部转换是单条 UPDATE ... WHERE status = ...，靠数据库原子性而不是
-- 应用层判断。这样"确认到账"与"过期清理"同时跑到也不冲突：先到的赢，
-- 后到的是空操作。

create or replace function public.expire_stale_orders()
returns int
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.orders
       set status = 'expired'
     where status = 'pending'
       and expires_at < now()
    returning 1
  )
  select count(*)::int from expired;
$$;

-- 允许 pending 与 expired 两种来源：真实坏情况是用户下了单、页面开着、
-- 半小时后才付款 —— 单已过期但钱真付了。允许确认"复活"它才不会丢单。
create or replace function public.confirm_order(p_id uuid, p_by text, p_provider text)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set status = 'paid',
         paid_at = now(),
         confirmed_by = p_by,
         provider = coalesce(p_provider, provider)
   where id = p_id
     and status in ('pending', 'expired')
  returning *;
$$;

create or replace function public.create_order(
  p_plan text,
  p_amount numeric,
  p_device uuid,
  p_ttl_minutes int
)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.expire_stale_orders();
  return query
    insert into public.orders (plan, amount, device_id, expires_at)
    values (p_plan, p_amount, p_device, now() + make_interval(mins => p_ttl_minutes))
    returning *;
end;
$$;

-- 原子抢占交付权。并发双击轮询、或用户开两个标签页时，两个请求都会读到
-- delivered_at is null 并各签一份权益 —— 只有拿到行的那个请求有权签发。
--
-- granted 由调用方算好传进来（它依赖请求里现有的 cookie 权益，SQL 算不了）。
-- 万一响应在网络上丢了，这份快照就是重发的依据。
create or replace function public.claim_order_delivery(
  p_id uuid,
  p_device uuid,
  p_granted jsonb
)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set delivered_at = now(),
         granted = p_granted
   where id = p_id
     and status = 'paid'
     and delivered_at is null
     and device_id = p_device
  returning *;
$$;

create or replace function public.mark_code_issued(p_id uuid, p_device uuid)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set code_issued_at = now()
   where id = p_id
     and status = 'paid'
     and code_issued_at is null
     and device_id = p_device
  returning *;
$$;

-- 只在用户什么都还没拿到时可撤。一旦权益发出去了就不许回头 ——
-- "撤销了但权益还在"是比"确认错了"更难查的状态。
create or replace function public.unconfirm_order(p_id uuid)
returns setof public.orders
language sql
security definer
set search_path = public
as $$
  update public.orders
     set status = 'pending',
         paid_at = null,
         confirmed_by = null
   where id = p_id
     and status = 'paid'
     and delivered_at is null
     and code_issued_at is null
  returning *;
$$;

revoke all on function public.expire_stale_orders() from anon, authenticated;
revoke all on function public.confirm_order(uuid, text, text) from anon, authenticated;
revoke all on function public.create_order(text, numeric, uuid, int) from anon, authenticated;
revoke all on function public.claim_order_delivery(uuid, uuid, jsonb) from anon, authenticated;
revoke all on function public.mark_code_issued(uuid, uuid) from anon, authenticated;
revoke all on function public.unconfirm_order(uuid) from anon, authenticated;

-- ⚠️ 上面这一组不够 —— 函数还从 `public` 角色继承着 EXECUTE。收口在 supabase/security.sql。
```

- [ ] **Step 2: 在 `supabase/security.sql` 补收口**

先读该文件确认既有写法，然后按同样风格追加这六个函数的 `revoke ... from public`。要点与 `redeem.sql:35` 的注释一致：`revoke ... from anon, authenticated` 挡不住从 `public` 角色继承来的 EXECUTE。

- [ ] **Step 3: 更新体检脚本**

在 `scripts/check-supabase.mjs` 的表清单里加 `orders`，函数清单里加：

```
create_order, confirm_order, expire_stale_orders,
claim_order_delivery, mark_code_issued, unconfirm_order
```

体检脚本失败时会告诉用户"去哪一步做什么"，新条目沿用同一套文案格式。

- [ ] **Step 4: 执行并验证**

Run: `node --env-file=.env.local scripts/check-supabase.mjs`
Expected: 逐项通过，包含新表与新函数。若报缺表，确认 `orders.sql` 已在 Supabase SQL Editor 执行过。

- [ ] **Step 5: 提交**

```bash
git add supabase/orders.sql supabase/security.sql scripts/check-supabase.mjs
git commit -m "订单表与状态机：确认、交付、发码三处幂等闸都由数据库定"
```

---

### Task 4: 支付接缝 `pay.ts`

**Files:**
- Create: `src/lib/pay.ts`
- Test: `tests/pay.test.mts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `PLANS`、`PlanId`
- Produces:
  - `interface PayChannel { id: "alipay" | "wechat"; label: string; qrSrc: string }`
  - `type PayInstruction = { kind: "qr"; amount: number; channels: PayChannel[] } | { kind: "redirect"; amount: number; url: string }`
  - `function payInstructionFor(planId: PlanId): PayInstruction`

- [ ] **Step 1: 写失败的测试**

新建 `tests/pay.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { payInstructionFor } from "../src/lib/pay.ts";
import { PLANS } from "../src/lib/pricing.ts";

test("金额来自 PLANS，不是调用方传进来的", () => {
  const inst = payInstructionFor("bazi");
  assert.equal(inst.amount, PLANS.bazi.price);
  assert.equal(inst.kind, "qr");
});

test("金额格式化为两位小数，用于拼收款码文件名", () => {
  const inst = payInstructionFor("bazi");
  assert.equal(inst.kind, "qr");
  if (inst.kind !== "qr") return;
  assert.deepEqual(inst.channels.map((c) => c.qrSrc), ["/pay/wechat-6.60.png"]);
});

test("年卡拼出 69.00 而不是 69", () => {
  // 两位小数不是洁癖：69 与 69.00 会指向两张不同的图，而只有一张存在
  const inst = payInstructionFor("member_year");
  assert.equal(inst.kind, "qr");
  if (inst.kind !== "qr") return;
  assert.ok(inst.channels[0]!.qrSrc.endsWith("-69.00.png"), inst.channels[0]!.qrSrc);
});

test("每个计划都给出微信渠道", () => {
  for (const planId of ["bazi", "member_month", "member_year"] as const) {
    const inst = payInstructionFor(planId);
    assert.equal(inst.kind, "qr");
    if (inst.kind !== "qr") return;
    assert.deepEqual(
      inst.channels.map((c) => c.id),
      ["wechat"],
      `${planId} 缺少渠道`
    );
  }
});

test("金额取自 PLANS，年卡是 69 而不是别的", () => {
  const inst = payInstructionFor("member_year");
  assert.equal(inst.amount, PLANS.member_year.price);
  assert.equal(inst.amount, 69);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --import ./scripts/ts-loader.mjs tests/pay.test.mts`
Expected: FAIL —— 找不到 `../src/lib/pay.ts`

- [ ] **Step 3: 实现**

新建 `src/lib/pay.ts`：

```ts
/**
 * 支付接缝。
 *
 * 当前实现是**方案 A（零资质）**：站长的个人收款码 + 人工确认到账。
 * 命理类过不了 ICP 备案、也开不了官方支付商户号，所以没有回调能力 ——
 * 这是资质问题，不是代码问题。
 *
 * 这里刻意保留一个联合类型而不是直接返回收款码列表：等拿到聚合支付资质时，
 * 改的是本文件加弹窗里一个 case，订单表、状态机、路由、权益签发全都不用动。
 * 不留这个缝，那时就得把整个订单流程再拆一遍。
 */
import { PLANS, type PlanId } from "@/lib/pricing";

export interface PayChannel {
  id: "alipay" | "wechat";
  label: string;
  qrSrc: string;
}

export type PayInstruction =
  | { kind: "qr"; amount: number; channels: PayChannel[] }
  | { kind: "redirect"; amount: number; url: string };

/**
 * 启用的收款渠道。**当前只做微信**（用户 2026-10-07 决定不做支付宝）。
 *
 * 用数组而不是单个值：渠道集合已经被改过一次（设计时两个、实现时一个），
 * 说明它易变。加回支付宝只是往这里补一行，类型与 UI 都不用动。
 */
const PROVIDERS: { id: PayChannel["id"]; label: string }[] = [
  { id: "wechat", label: "微信" },
];

/**
 * 收款码图片路径。
 *
 * 两位小数是必须的：金额直接参与拼路径，`69` 与 `69.00` 会指向两张不同的图，
 * 而只有一张存在 —— 表现是年卡的收款码裂图，月卡的正常，很难从现象反推。
 *
 * 每价位一张图，是因为微信收款码**可以**设固定金额，扫码后金额已填好。
 * 这也意味着改价必须同时重做图片：图片上的金额是物理的、改不了。
 * 改价后 `qrSrcFor` 会去找一张不存在的图 → 弹窗显示「暂未就绪」。
 * 宁可显示未就绪，也不要出现「页面标 6.6、扫码付出 6.9」。
 */
export function qrSrcFor(provider: string, amount: number): string {
  return `/pay/${provider}-${amount.toFixed(2)}.png`;
}

export function payInstructionFor(planId: PlanId): PayInstruction {
  const plan = PLANS[planId];
  return {
    kind: "qr",
    amount: plan.price,
    channels: PROVIDERS.map((p) => ({ ...p, qrSrc: qrSrcFor(p.id, plan.price) })),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --import ./scripts/ts-loader.mjs tests/pay.test.mts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/pay.ts tests/pay.test.mts
git commit -m "支付接缝：渠道与金额收在一个函数里，将来换聚合支付只动这一处"
```

---

### Task 5: 订单数据层 `order-store.ts`

**Files:**
- Create: `src/lib/server/order-store.ts`
- Test: `tests/order-store.test.mts`（新建）

**Interfaces:**
- Consumes: Task 3 的六个 SQL 函数；`admin` / `isSupabaseConfigured`（`src/lib/server/runtime.ts`）
- Produces:

```ts
interface OrderRow {
  id: string;
  plan: string;
  amount: number;
  status: "pending" | "paid" | "expired";
  provider: string | null;
  payerRef: string | null;
  deviceId: string | null;
  granted: unknown;
  deliveredAt: string | null;
  codeIssuedAt: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

createOrder(input: { plan: string; amount: number; deviceId: string; ttlMinutes: number }): Promise<OrderRow>
getOrder(id: string): Promise<OrderRow | null>
confirmOrder(id: string, by: string, provider: string | null): Promise<OrderRow | null>
claimOrderDelivery(id: string, deviceId: string, granted: unknown): Promise<OrderRow | null>
markCodeIssued(id: string, deviceId: string): Promise<OrderRow | null>
unconfirmOrder(id: string): Promise<OrderRow | null>
setPayerRef(id: string, deviceId: string, payerRef: string, provider: string | null): Promise<OrderRow | null>
listRecentOrders(sinceMs: number): Promise<OrderRow[]>
```

- [ ] **Step 1: 写失败的测试**

新建 `tests/order-store.test.mts`。内存兜底路径（未配 Supabase 时）可完整单测：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --import ./scripts/ts-loader.mjs tests/order-store.test.mts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现**

新建 `src/lib/server/order-store.ts`。照 `account-store.ts` 的既有范式：内存兜底 + RPC 两条路径，同一组函数名。

```ts
import { randomUUID } from "node:crypto";
import { admin, isSupabaseConfigured } from "@/lib/server/runtime";

/**
 * 订单数据层。
 *
 * 状态的每一次转换都交给数据库函数做原子 UPDATE，本文件只负责取参数、
 * 调 RPC、把行翻译成 camelCase。理由与 codes.ts 一致：并发下
 * "先读后写"会双花，只有 `UPDATE ... WHERE 前置条件 RETURNING` 能保证唯一。
 *
 * 未配 Supabase 时走内存兜底（照 usage-store 的既有范式），本地能跑通；
 * 生产环境由运行时直接 503。
 */

export interface OrderRow {
  id: string;
  plan: string;
  amount: number;
  status: "pending" | "paid" | "expired";
  provider: string | null;
  payerRef: string | null;
  deviceId: string | null;
  granted: unknown;
  deliveredAt: string | null;
  codeIssuedAt: string | null;
  paidAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

function allowMemory(): boolean {
  return !isSupabaseConfigured() && process.env.NODE_ENV !== "production";
}

/** 内存兜底下的订单表。键是订单 id。 */
const memoryOrders = new Map<string, OrderRow>();

/** 把数据库返回的 snake_case 行翻译成 OrderRow。 */
function toRow(raw: Record<string, unknown>): OrderRow {
  return {
    id: raw.id as string,
    plan: raw.plan as string,
    amount: Number(raw.amount),
    status: raw.status as OrderRow["status"],
    provider: (raw.provider ?? null) as string | null,
    payerRef: (raw.payer_ref ?? null) as string | null,
    deviceId: (raw.device_id ?? null) as string | null,
    granted: raw.granted ?? null,
    deliveredAt: (raw.delivered_at ?? null) as string | null,
    codeIssuedAt: (raw.code_issued_at ?? null) as string | null,
    paidAt: (raw.paid_at ?? null) as string | null,
    confirmedBy: (raw.confirmed_by ?? null) as string | null,
    createdAt: raw.created_at as string,
    expiresAt: raw.expires_at as string,
  };
}

/** 内存兜底下的过期清理，语义与 expire_stale_orders() 一致。 */
function expireMemory(): void {
  const now = Date.now();
  for (const o of memoryOrders.values()) {
    if (o.status === "pending" && new Date(o.expiresAt).getTime() < now) {
      o.status = "expired";
    }
  }
}

/** 调一个返回 setof orders 的函数，取第一行或 null。 */
async function rpcOne(fn: string, args: Record<string, unknown>): Promise<OrderRow | null> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(`调用 ${fn} 失败: ${error.message}`);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return row ? toRow(row) : null;
}

export async function createOrder(input: {
  plan: string;
  amount: number;
  deviceId: string;
  ttlMinutes: number;
}): Promise<OrderRow> {
  if (allowMemory()) {
    expireMemory();
    const now = Date.now();
    const row: OrderRow = {
      id: randomUUID(),
      plan: input.plan,
      amount: input.amount,
      status: "pending",
      provider: null,
      payerRef: null,
      deviceId: input.deviceId,
      granted: null,
      deliveredAt: null,
      codeIssuedAt: null,
      paidAt: null,
      confirmedBy: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.ttlMinutes * 60_000).toISOString(),
    };
    memoryOrders.set(row.id, row);
    return row;
  }

  const row = await rpcOne("create_order", {
    p_plan: input.plan,
    p_amount: input.amount,
    p_device: input.deviceId,
    p_ttl_minutes: input.ttlMinutes,
  });
  if (!row) throw new Error("建单失败：数据库未返回行");
  return row;
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  if (allowMemory()) {
    expireMemory();
    return memoryOrders.get(id) ?? null;
  }

  const { data, error } = await admin()
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`读取订单失败: ${error.message}`);
  return data ? toRow(data as Record<string, unknown>) : null;
}

export async function confirmOrder(
  id: string,
  by: string,
  provider: string | null
): Promise<OrderRow | null> {
  if (allowMemory()) {
    expireMemory();
    const o = memoryOrders.get(id);
    if (!o || (o.status !== "pending" && o.status !== "expired")) return null;
    o.status = "paid";
    o.paidAt = new Date().toISOString();
    o.confirmedBy = by;
    if (provider) o.provider = provider;
    return o;
  }

  return rpcOne("confirm_order", { p_id: id, p_by: by, p_provider: provider });
}

export async function claimOrderDelivery(
  id: string,
  deviceId: string,
  granted: unknown
): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.status !== "paid" || o.deliveredAt !== null || o.deviceId !== deviceId) {
      return null;
    }
    o.deliveredAt = new Date().toISOString();
    o.granted = granted;
    return o;
  }

  return rpcOne("claim_order_delivery", {
    p_id: id,
    p_device: deviceId,
    p_granted: granted,
  });
}

export async function markCodeIssued(id: string, deviceId: string): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.status !== "paid" || o.codeIssuedAt !== null || o.deviceId !== deviceId) {
      return null;
    }
    o.codeIssuedAt = new Date().toISOString();
    return o;
  }

  return rpcOne("mark_code_issued", { p_id: id, p_device: deviceId });
}

export async function unconfirmOrder(id: string): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.status !== "paid" || o.deliveredAt !== null || o.codeIssuedAt !== null) {
      return null;
    }
    o.status = "pending";
    o.paidAt = null;
    o.confirmedBy = null;
    return o;
  }

  return rpcOne("unconfirm_order", { p_id: id });
}

export async function setPayerRef(
  id: string,
  deviceId: string,
  payerRef: string,
  provider: string | null
): Promise<OrderRow | null> {
  if (allowMemory()) {
    const o = memoryOrders.get(id);
    if (!o || o.deviceId !== deviceId) return null;
    o.payerRef = payerRef;
    if (provider) o.provider = provider;
    return o;
  }

  const { data, error } = await admin()
    .from("orders")
    .update({ payer_ref: payerRef, provider })
    .eq("id", id)
    .eq("device_id", deviceId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`提交交易单号失败: ${error.message}`);
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** 最近 N 毫秒内的订单，按创建时间倒序。对账脚本用。 */
export async function listRecentOrders(sinceMs: number): Promise<OrderRow[]> {
  const since = new Date(Date.now() - sinceMs).toISOString();

  if (allowMemory()) {
    expireMemory();
    return [...memoryOrders.values()]
      .filter((o) => o.createdAt >= since)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const { data, error } = await admin()
    .from("orders")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`读取订单列表失败: ${error.message}`);
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --import ./scripts/ts-loader.mjs tests/order-store.test.mts`
Expected: PASS

- [ ] **Step 5: 把 `orders` 加进 mock-supabase（若契约测试要用）**

`tests/mock-supabase.mjs` 目前只实现 `usage` 等表的 REST 与已知 RPC。Task 7 的契约测试要打真实路由，需要它认识 `orders`。

在 mock 的 RPC 分发表里加上六个新函数的内存实现，语义与 `supabase/orders.sql` 逐条一致（特别是 `claim_order_delivery` 必须只在 `delivered_at is null` 时返回行）。REST 侧加上 `orders` 的 `select`/`update` 支持。

Run: `node --test --import ./scripts/ts-loader.mjs tests/account-contract.test.mts`
Expected: 仍然全绿（确认没有破坏既有 mock 行为）

- [ ] **Step 6: 提交**

```bash
git add src/lib/server/order-store.ts tests/order-store.test.mts tests/mock-supabase.mjs
git commit -m "订单数据层：状态转换全部交给数据库函数，内存兜底与库同口径"
```

---

### Task 6: 建单与轮询路由

**Files:**
- Create: `src/app/api/order/route.ts`
- Create: `src/app/api/order/status/route.ts`
- Test: `tests/order-contract.test.mts`（新建）

**Interfaces:**
- Consumes: Task 1 `PLANS`/`isPlanId`/`ORDER_TTL_MINUTES`/`ORDER_IP_DAILY_LIMIT`；Task 4 `payInstructionFor`；Task 5 `createOrder`/`getOrder`/`claimOrderDelivery`；`withDeviceCookie`/`DEVICE_COOKIE`（`quota-guard.ts`）；`hashIp`/`readCount`/`bumpCount`（`usage-store.ts`）；`readEntitlement`/`withPassCookie`/`nowSec`（`pass-cookie.ts`）；`grantMember`/`grantPass`/`EMPTY_ENTITLEMENT`/`toSummary`（`entitlement.ts`）；`passSecret`（`runtime.ts`）；`putDeviceEntitlement`（`account-store.ts`）
- Produces:
  - `POST /api/order` → `{ success, orderId, amount, instruction, expiresAt }` 或 `{ success: false, error }`
  - `GET /api/order/status?id=` → `{ success, status, entitlement? }`

- [ ] **Step 1: 写失败的测试**

新建 `tests/order-contract.test.mts`，照 `tests/account-contract.test.mts` 的方式启动 `mock-supabase` 并把 `NEXT_PUBLIC_SUPABASE_URL` 指过去。至少覆盖：

```ts
// 1. 非法 plan 返回 400，且不建单
// 2. 请求体里塞 amount: 0.01 被忽略，返回的 amount 等于 PLANS.bazi.price
// 3. 未付款订单轮询只返回 status=pending，不带 entitlement
// 4. 别人的 device cookie 查订单返回 404（不是 403）
// 5. 确认到账后，同设备轮询拿到 entitlement，且 pass 数 +1
// 6. 连续轮询两次，第二次不再增加权益（幂等）
// 7. 建单超过 ORDER_IP_DAILY_LIMIT 次返回 429
```

具体断言按仓库既有契约测试的写法（`tests/account-contract.test.mts` 里有可直接照搬的起桩与请求辅助函数）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --import ./scripts/ts-loader.mjs tests/order-contract.test.mts`
Expected: FAIL —— 路由不存在，404

- [ ] **Step 3: 实现建单路由**

新建 `src/app/api/order/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isPlanId, ORDER_IP_DAILY_LIMIT, ORDER_TTL_MINUTES, PLANS } from "@/lib/pricing";
import { payInstructionFor } from "@/lib/pay";
import { createOrder } from "@/lib/server/order-store";
import { DEVICE_COOKIE, withDeviceCookie } from "@/lib/server/quota-guard";
import { bumpCount, hashIp, readCount } from "@/lib/server/usage-store";

/**
 * 建单。
 *
 * **只收 plan，绝不收金额。** 金额由服务端从 PLANS 取 —— 接受客户端传价格
 * 等于让用户自己定价，那是最容易被忽略、后果又最直接的一类漏洞。
 *
 * 限次是必须的：没有它，任何人都能无限建 pending 单，把对账列表冲垮，
 * 让站长在几百条垃圾里找那笔真付款。
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const rawPlan = (body as Record<string, unknown>).plan;
  if (typeof rawPlan !== "string" || !isPlanId(rawPlan)) {
    return NextResponse.json({ success: false, error: "该套餐不存在" }, { status: 400 });
  }
  const plan = PLANS[rawPlan];

  // 设备标识。与 /api/redeem 的做法一致：没有就现在发一个，不能等到排盘才发。
  const existingDevice = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice ?? randomUUID();
  const isNewDevice = existingDevice === undefined;

  let ipHash: string;
  try {
    ipHash = hashIp(
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "0.0.0.0"
    );
  } catch (err) {
    console.error("IP 哈希失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const orderKey = `order:${ipHash}`;
  try {
    const used = await readCount(orderKey);
    if (used >= ORDER_IP_DAILY_LIMIT) {
      return NextResponse.json(
        { success: false, error: "今日下单次数过多，请明天再来" },
        { status: 429 }
      );
    }
    await bumpCount(orderKey);
  } catch (err) {
    // 计数读不到就拒绝：这是建单入口，宁可 503 也不能让人无限塞订单
    console.error("建单限次失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  try {
    const order = await createOrder({
      plan: plan.id,
      amount: plan.price,
      deviceId,
      ttlMinutes: ORDER_TTL_MINUTES,
    });

    const res = NextResponse.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      instruction: payInstructionFor(plan.id),
      expiresAt: order.expiresAt,
    });
    return withDeviceCookie(res, deviceId, isNewDevice);
  } catch (err) {
    console.error("建单失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 4: 实现轮询路由**

新建 `src/app/api/order/status/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { isPlanId, PLANS } from "@/lib/pricing";
import { claimOrderDelivery, getOrder } from "@/lib/server/order-store";
import { DEVICE_COOKIE } from "@/lib/server/quota-guard";
import { EMPTY_ENTITLEMENT, grantMember, grantPass, toSummary, type Entitlement } from "@/lib/entitlement";
import { nowSec, readEntitlement, withPassCookie } from "@/lib/server/pass-cookie";
import { passSecret } from "@/lib/server/runtime";
import { putDeviceEntitlement } from "@/lib/server/account-store";

/**
 * 轮询订单状态；订单已到账且是本设备下的，就地签发权益。
 *
 * 这是全站第二个"把付款变成权限"的入口（另一个是 /api/redeem）。
 * 收尾逻辑刻意与 redeem 路由保持一致：读现有凭证 → 按计划类型签发 →
 * 写回 cookie。差别只在"凭什么给"——那边凭一个原子核销的激活码，
 * 这边凭一个原子抢占的订单交付权。
 */

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "缺少订单号" }, { status: 400 });
  }

  const secret = passSecret();
  if (!secret) {
    console.error("[order/status] 未配置 PASS_SECRET，无法签发权益凭证");
    return NextResponse.json(
      { success: false, error: "服务尚未配置完成，请稍后再试" },
      { status: 503 }
    );
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    // 没有设备号就不可能有人下过单。回 404 而不是 403 ——
    // 403 等于确认"这个订单号存在"，那就成了订单探测器。
    return NextResponse.json({ success: false, error: "订单不存在" }, { status: 404 });
  }

  let order;
  try {
    order = await getOrder(id);
  } catch (err) {
    console.error("读取订单失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  // 设备不匹配一律 404。不能区分"不存在"与"不是你的"。
  if (!order || order.deviceId !== deviceId) {
    return NextResponse.json({ success: false, error: "订单不存在" }, { status: 404 });
  }

  if (order.status !== "paid") {
    return NextResponse.json({ success: true, status: order.status });
  }

  const now = nowSec();
  const planId = order.plan;
  if (!isPlanId(planId)) {
    console.error(`[order/status] 订单指向未知计划: ${planId}`);
    return NextResponse.json(
      { success: false, error: "该订单对应的套餐已下线，请联系客服" },
      { status: 400 }
    );
  }
  const plan = PLANS[planId];

  const current = readEntitlement(req) ?? EMPTY_ENTITLEMENT;
  const next: Entitlement =
    plan.kind === "member"
      ? grantMember(current, plan.days, now)
      : grantPass(current, plan.mode ?? "", 1, plan.days, now);

  try {
    const claimed = await claimOrderDelivery(order.id, deviceId, next);
    if (claimed) {
      // 抢占成功：本次由我签发
      try {
        await putDeviceEntitlement(deviceId, next);
      } catch (err) {
        // 镜像写失败不影响本次开通（cookie 马上就写下去了），只影响日后能否迁进账户
        console.error("写入设备权益镜像失败（不影响本次开通）:", err);
      }
      const res = NextResponse.json({
        success: true,
        status: "paid",
        entitlement: toSummary(next, now),
      });
      return withPassCookie(res, next, secret);
    }
  } catch (err) {
    console.error("抢占交付权失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  // 抢占失败 = 本单已经交付过。
  //
  // 这里要处理一种会把用户坑死的情况：上次交付成功、cookie 也签好了，
  // 但响应在网络上丢了 —— 用户手里什么都没有，而订单已标记交付。
  // 所以只在**请求完全不带权益 cookie** 时，用订单上存的那份快照重签一次。
  //
  // 带着 cookie 就什么都不做：否则会把用户已经用掉的券复活，
  // 那正是 entitlement.ts 里 withTid() 注释反复警告的那类错误。
  const carried = readEntitlement(req);
  if (carried) {
    return NextResponse.json({ success: true, status: "paid", delivered: true });
  }

  const snapshot = order.granted as Entitlement | null;
  if (!snapshot) {
    // 理论上到不了：交付成功必定写了 granted。真到了说明数据被外部改过。
    console.error(`[order/status] 订单 ${order.id} 已交付但缺少权益快照`);
    return NextResponse.json(
      { success: false, error: "权益发放异常，请联系客服并提供订单号" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({
    success: true,
    status: "paid",
    entitlement: toSummary(snapshot, now),
  });
  return withPassCookie(res, snapshot, secret);
}
```

- [ ] **Step 5: 跑契约测试**

Run: `node --test --import ./scripts/ts-loader.mjs tests/order-contract.test.mts`
Expected: PASS

Run: `node --test --import ./scripts/ts-loader.mjs`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/app/api/order/route.ts src/app/api/order/status/route.ts tests/order-contract.test.mts
git commit -m "建单与轮询路由：金额只由服务端定，交付靠数据库抢占"
```

---

### Task 7: 交易单号与兜底发码路由

**Files:**
- Create: `src/app/api/order/claim/route.ts`
- Create: `src/app/api/order/code/route.ts`
- Modify: `tests/order-contract.test.mts`

**Interfaces:**
- Consumes: Task 5 `getOrder`/`setPayerRef`/`markCodeIssued`；Task 2 `mintCode`；`admin()`（`runtime.ts`）
- Produces:
  - `POST /api/order/claim` → `{ success }`
  - `POST /api/order/code` → `{ success, code }`

- [ ] **Step 1: 补契约测试**

在 `tests/order-contract.test.mts` 追加：

```ts
// 8.  pending 订单可以提交交易单号，但状态不变（提交 != 到账）
// 9.  别人的设备提交单号返回 404
// 10. 未付款订单取激活码返回 400
// 11. 已付款订单取激活码返回 16 位合法码，且第二次取返回 400（只能取一次）
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --import ./scripts/ts-loader.mjs tests/order-contract.test.mts`
Expected: FAIL —— 两个路由不存在

- [ ] **Step 3: 实现 `/api/order/claim`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getOrder, setPayerRef } from "@/lib/server/order-store";
import { DEVICE_COOKIE } from "@/lib/server/quota-guard";
import { MAX_PAYER_REF_LENGTH } from "@/lib/validation";

/**
 * 用户提交交易单号。
 *
 * 提交**不等于**到账 —— 这里不做任何校验（也无从校验：个人收款码没有
 * 可查询的接口）。它的作用有两个：给站长对账时一个明确的锚点（金额 + 时间
 * 之外多一条线索），以及留下纠纷凭证。
 *
 * 文案必须说清楚这一点。「已提交，稍后开通」会让用户以为付完就完事了，
 * 然后回来发现没开通 —— 比不提交更糟。
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const id = typeof b.orderId === "string" ? b.orderId : "";
  const payerRef = typeof b.payerRef === "string" ? b.payerRef.trim() : "";
  const provider = typeof b.provider === "string" ? b.provider : null;

  if (!id) {
    return NextResponse.json({ success: false, error: "缺少订单号" }, { status: 400 });
  }
  if (!payerRef) {
    return NextResponse.json({ success: false, error: "请填写交易单号" }, { status: 400 });
  }
  if (payerRef.length > MAX_PAYER_REF_LENGTH) {
    return NextResponse.json({ success: false, error: "交易单号过长" }, { status: 400 });
  }
  if (provider !== null && provider !== "alipay" && provider !== "wechat") {
    return NextResponse.json({ success: false, error: "付款渠道不正确" }, { status: 400 });
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    return NextResponse.json({ success: false, error: "订单不存在" }, { status: 404 });
  }

  try {
    const order = await getOrder(id);
    if (!order || order.deviceId !== deviceId) {
      return NextResponse.json({ success: false, error: "订单不存在" }, { status: 404 });
    }
    if (order.status !== "pending") {
      return NextResponse.json(
        { success: false, error: "该订单已处理，无需重复提交" },
        { status: 400 }
      );
    }

    await setPayerRef(id, deviceId, payerRef, provider);
    return NextResponse.json({
      success: true,
      notice: "已提交。我们核对到账后会为你开通，请保持本页面打开",
    });
  } catch (err) {
    console.error("提交交易单号失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
```

同时在 `src/lib/validation.ts` 加：

```ts
/** 交易单号上限。真实单号约 28 位，给足冗余但不接受无限长的输入。 */
export const MAX_PAYER_REF_LENGTH = 64;
```

- [ ] **Step 4: 实现 `/api/order/code`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { isPlanId, PLANS } from "@/lib/pricing";
import { getOrder, markCodeIssued } from "@/lib/server/order-store";
import { mintCode } from "@/lib/server/codes";
import { DEVICE_COOKIE } from "@/lib/server/quota-guard";
import { admin } from "@/lib/server/runtime";

/**
 * 跨设备兜底：把已到账的订单换成一个激活码。
 *
 * 用途是"手机付款、电脑在用"这类场景 —— 权益自动落到付款那台设备上，
 * 另一台设备只能靠码。有了它，redeem_codes 的原子核销与设备镜像
 * 全部原样复用，不需要第二套交付机制。
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "请求格式不正确" }, { status: 400 });
  }

  const id = (body as Record<string, unknown>).orderId;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ success: false, error: "缺少订单号" }, { status: 400 });
  }

  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!deviceId) {
    return NextResponse.json({ success: false, error: "订单不存在" }, { status: 404 });
  }

  try {
    const order = await getOrder(id);
    if (!order || order.deviceId !== deviceId) {
      return NextResponse.json({ success: false, error: "订单不存在" }, { status: 404 });
    }
    if (order.status !== "paid") {
      return NextResponse.json({ success: false, error: "该订单尚未到账" }, { status: 400 });
    }
    if (!isPlanId(order.plan)) {
      console.error(`[order/code] 订单指向未知计划: ${order.plan}`);
      return NextResponse.json(
        { success: false, error: "该订单对应的套餐已下线，请联系客服" },
        { status: 400 }
      );
    }

    // 抢占发码权：只有拿到行的那次请求能发。重复点"获取激活码"不会
    // 变出第二个码 —— 否则一次付款能开两台设备。
    const claimed = await markCodeIssued(order.id, deviceId);
    if (!claimed) {
      return NextResponse.json(
        { success: false, error: "本单已发放过激活码，请查看之前的记录或联系客服" },
        { status: 400 }
      );
    }

    const plan = PLANS[order.plan];

    // 撞码概率极低，但主键冲突会让整次请求失败，所以重试几次
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = mintCode();
      const { error } = await admin()
        .from("redeem_codes")
        .insert({
          code,
          kind: plan.kind,
          mode: plan.kind === "single" ? plan.mode : null,
          days: plan.kind === "member" ? plan.days : 0,
          batch: order.id,
        });
      if (!error) {
        return NextResponse.json({ success: true, code });
      }
      if (error.code !== "23505") {
        console.error("发码失败:", error);
        // 发码权已经用掉了，但码没写进去。允许重试：把标记撤回。
        // 撤不掉也不致命 —— 用户联系客服即可，而客服手上有 order.id 能发码。
        const { error: undoErr } = await admin()
          .from("orders")
          .update({ code_issued_at: null })
          .eq("id", order.id);
        if (undoErr) console.error("撤回发码标记失败:", undoErr);
        return NextResponse.json(
          { success: false, error: "服务暂时不可用，请稍后再试" },
          { status: 503 }
        );
      }
    }
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  } catch (err) {
    console.error("发码失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `node --test --import ./scripts/ts-loader.mjs tests/order-contract.test.mts`
Expected: PASS

Run: `node --test --import ./scripts/ts-loader.mjs`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/app/api/order/claim/route.ts src/app/api/order/code/route.ts src/lib/validation.ts tests/order-contract.test.mts
git commit -m "交易单号与兜底发码：跨设备走激活码，复用既有原子核销"
```

**已知取舍（spec §13，实现时不要"顺手修好"）**：`markCodeIssued` **不检查** `deliveredAt`，所以先自动到账、再取激活码，会得到两份权益。这是刻意的 —— 堵它需要在 `/api/order/code` 里拒绝已交付的订单，而那会同时堵死「电脑上已自动到账、现在想给手机也开一个」这种合理需求。该漏需用户刻意操作才触发，单次上限 ¥69。真要收紧时改的是 `markCodeIssued` 的 SQL 前置条件（加 `and delivered_at is null`），一处即可。

---

### Task 8: 改造 `PaymentModal.tsx`

现有组件 props 是 `price: string`，付钱靠"截图发邮件 → 输激活码"。改造后金额由服务端返回、双渠道收款码、自动轮询到账、激活码降为兜底入口。

**Files:**
- Modify: `src/components/PaymentModal.tsx`
- Modify: `src/app/member/page.tsx:114-120`
- Modify: `src/components/FortuneForm.tsx:217-224`
- Test: `tests/home-experience.test.mjs`（既有字符串断言，需同步）

**Interfaces:**
- Consumes: `POST /api/order`、`GET /api/order/status`、`POST /api/order/claim`、`POST /api/order/code`；`refreshEntitlement`（`src/lib/entitlements.ts`）
- Produces: `PaymentModal` 新 props —— 去掉 `price`，加 `plan: PlanId`；`onRedeem` 与 `alreadyUnlocked` 保持不变

- [ ] **Step 1: 改 props 与调用方**

`PaymentModal.tsx` 的 `Props` 与解构改为：

```ts
import { PLANS, type PlanId } from "@/lib/pricing";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 买哪个计划。金额不从这里传 —— 由服务端按 PLANS 决定。 */
  plan: PlanId;
  onRedeem: (code: string) => Promise<string | null>;
  alreadyUnlocked?: boolean;
}
```

调用方：

- `src/app/member/page.tsx:118` —— 把 `price={formatPrice(selectedPlan.price)}` 换成 `plan={selectedPlan.id as PlanId}`，并删掉不再使用的 `formatPrice` import（若别处没用）
- `src/components/FortuneForm.tsx:221` —— 把 `price={formatPrice(modeInfo.price)}` 换成 `plan="bazi"`

`selectedPlan.id` 的类型只有改动路径：`MEMBER_PLANS` 的 `id` 目前是 `string`，用 `as PlanId` 显式收窄即可；若要更干净，可在 `pricing.ts` 把 `MemberPlan.id` 的类型改为 `PlanId`（推荐，且不影响既有测试）。

- [ ] **Step 2: 扩展状态机**

`step` 从 `"pay" | "code" | "done"` 改为 `"loading" | "pay" | "code" | "done"`，并加订单相关状态：

```ts
const [step, setStep] = useState<"loading" | "pay" | "code" | "done">("loading");
const [order, setOrder] = useState<{
  orderId: string;
  amount: number;
  instruction: Extract<PayInstruction, { kind: "qr" }>;
} | null>(null);
const [payError, setPayError] = useState<string | null>(null);
const [payerRef, setPayerRef] = useState("");
const [claimNotice, setClaimNotice] = useState<string | null>(null);
const [fetchCodeError, setFetchCodeError] = useState<string | null>(null);
```

打开时建单（替换原来的 `alreadyUnlocked` effect）：

```ts
useEffect(() => {
  if (!open) return;
  if (alreadyUnlocked) {
    setStep("done");
    return;
  }
  let cancelled = false;
  setStep("loading");
  setPayError(null);
  setOrder(null);
  setClaimNotice(null);
  setFetchCodeError(null);

  (async () => {
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !data?.success) {
        setPayError(data?.error ?? "下单失败，请稍后重试");
        setStep("pay");
        return;
      }
      if (data.instruction?.kind !== "qr") {
        setPayError("支付方式暂不可用，请联系站长");
        setStep("pay");
        return;
      }
      setOrder({
        orderId: data.orderId,
        amount: data.amount,
        instruction: data.instruction,
      });
      setStep("pay");
    } catch {
      if (cancelled) return;
      setPayError("网络连接失败，请稍后重试");
      setStep("pay");
    }
  })();

  return () => {
    cancelled = true;
  };
}, [open, alreadyUnlocked, plan]);
```

- [ ] **Step 3: 加轮询**

```ts
// 只在本弹窗打开、且已建单时轮询。到账即停。
useEffect(() => {
  if (!open || !order || step === "done") return;
  let stopped = false;

  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      const res = await fetch(`/api/order/status?id=${encodeURIComponent(order.orderId)}`);
      const data = await res.json().catch(() => null);
      if (stopped || !res.ok || !data?.success) return;
      if (data.status === "paid") {
        stopped = true;
        clearInterval(timer);
        setStep("done");
        await refreshEntitlement();
      }
    } catch {
      // 轮询失败静默重试 —— 弹错误只会打扰正在付款的人
    }
  }, 4000);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}, [open, order, step]);
```

顶部加 `import { refreshEntitlement } from "@/lib/entitlements";`。

- [ ] **Step 4: 重写 `step === "pay"` 的渲染**

替换现有的收款码区块（原 `qrcode.jpg` 那段）与说明列表。要点：

- 金额醒目展示：`¥{order.amount.toFixed(2)}`，并从 `PLANS[plan].name` 取套餐名
- **替换掉现有的「金额请手动输入 ¥X」提示**（`PaymentModal.tsx:153-155`）。收款码带了固定金额，扫码后金额已填好，所以那句提示现在是错的 —— 应改为「扫码即可，金额已为你填好 ¥X」
- **按 `order.instruction.channels` 循环渲染，不要写死渠道个数** —— 当前只有一个（微信），但渠道集合易变，写死两个或写死一个都会在下次调整时变成静默错误。每项渲染一张 `c.qrSrc` 的 `<img onError={() => setQrFailed(true)} />` 加一个 `c.label` 标题
- 只有一个渠道时不渲染任何渠道切换 UI，直接展示那张码
- 手机端提示改为「长按图片 → 识别图中二维码」
- 文案里的渠道名用 `c.label` 取，不要在 JSX 里写死「微信」二字（同一个理由）
- 保留 `qrFailed` 降级为「收款码暂未就绪」
- 保留**诚实的交付说明**，但改为三步：扫码付款（金额已填好，勿修改）→ 到账后本页自动开通 → 若换了设备，点下方「获取激活码」
- 加「我已付款，提交交易单号（选填）」折叠区：一个 input（`payerRef`）+ 两个渠道选择按钮 + 提交，成功后展示 `claimNotice`
- 底部按钮：主按钮「获取激活码」（`btn-mystic`，不是 `btn-primary` —— 主操作此刻是"去付款"），次按钮「取消」

**不要**再把 `CONTACT_EMAIL` 作为主路径写在这里；它降级到"付款遇到问题"一行小字。

- [ ] **Step 5: 重写 `step === "done"` 的文案**

原文案「权益已写入本机凭证，即刻生效」仍然对，但补一句：本机已自动开通；换设备请点「获取激活码」。

- [ ] **Step 6: 加「获取激活码」动作**

```ts
const handleFetchCode = async () => {
  if (!order) return;
  setFetchCodeError(null);
  setBusy(true);
  try {
    const res = await fetch("/api/order/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.orderId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      setFetchCodeError(data?.error ?? "获取失败，请稍后重试");
      return;
    }
    setCode(data.code);
    setStep("code");
  } catch {
    setFetchCodeError("网络连接失败，请稍后重试");
  } finally {
    setBusy(false);
  }
};
```

- [ ] **Step 7: 更新既有测试**

`tests/home-experience.test.mjs` 是对源文件做字符串断言。搜索其中与 `qrcode.jpg`、`已付款`、`price=` 相关的断言，按新文案与新 props 更新。**不要**为了让它通过而保留已删除的旧行为。

Run: `node --test --import ./scripts/ts-loader.mjs tests/home-experience.test.mjs`
Expected: PASS

- [ ] **Step 8: 类型检查与构建**

Run: `npx tsc --noEmit`
Expected: 无错误

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 9: 手工验收**

Run: `npm run dev`，打开首页 → 点付费 → 确认：金额显示为 `¥6.60`、两张收款码能显示、手机端长按能识别、不输金额。

（本机没有 `public/pay/` 图片时，两张码都会显示「暂未就绪」—— 这是预期降级，不是 bug。图片见 spec §15。）

- [ ] **Step 10: 提交**

```bash
git add src/components/PaymentModal.tsx src/app/member/page.tsx src/components/FortuneForm.tsx src/lib/pricing.ts tests/home-experience.test.mjs
git commit -m "付费弹窗：金额由服务端锁定，到账后本页自动开通"
```

---

### Task 9: 对账与确认脚本

**Files:**
- Create: `scripts/confirm-order.mjs`

**Interfaces:**
- Consumes: Task 5 的 `listRecentOrders`/`confirmOrder`/`unconfirmOrder`；`createClient`（`@supabase/supabase-js`）
- Produces: CLI，见下

- [ ] **Step 1: 实现**

照 `scripts/gen-codes.mjs` 的参数解析与环境变量检查写法实现。**注意：该脚本没有 `--help` 分支**（`parseArgs` 把未知参数当成未识别而报错），所以本脚本也不要假设有可照抄的 `--help` —— 要给就自己写一个。

调用方式与 `gen-codes.mjs` 对齐（它现在需要 loader，因为 import 链上有 `@/` 别名）：

```
node --import ./scripts/ts-loader.mjs --env-file=.env.local scripts/confirm-order.mjs ...
```

```
用法:
  node --env-file=.env.local scripts/confirm-order.mjs                 列出最近 2 小时
  node --env-file=.env.local scripts/confirm-order.mjs --hours 8       列出最近 8 小时
  node --env-file=.env.local scripts/confirm-order.mjs --id 8f3a       确认到账（id 支持前缀）
  node --env-file=.env.local scripts/confirm-order.mjs --undo 8f3a     撤销确认
```

输出格式（对齐宽度用 `padEnd`，中文按双宽处理或直接不追求完美对齐）：

```
最近 2 小时
  14:31  ¥6.60   八字单次   支付宝  2026100722001...  pending   8f3a1c2d
  14:28  ¥69.00  年卡       —      —                 pending   4b7e9a01

⚠ 1 笔已付款但未领取——用户付了钱没拿到东西，建议主动发码
  c1d0f5a8  ¥9.90  月卡
```

实现要点：

- `--id` 前缀匹配：在最近订单里找 `id.startsWith(前缀)` 的；**匹配到多条时列出候选并要求打更多位**，不能随便挑一条
- 确认时打印确认了哪一单（金额、套餐、设备号前 8 位），让误操作能立刻被发现
- `--undo` 命中"已交付"时打印为什么拒绝
- 「已付款但未领取」= `status === 'paid'` 且 `deliveredAt === null` 且 `codeIssuedAt === null`
- `--id` 命中不到时报「没找到，可能已超出 --hours 范围，试试加大它」

套餐名从 `PLANS` 取，不在这里另写一份中文名。

- [ ] **Step 2: 验证**

Run: `node --env-file=.env.local scripts/confirm-order.mjs --help`
Expected: 打印用法

Run: `node --env-file=.env.local scripts/confirm-order.mjs`
Expected: 打印「最近 2 小时」与表头；没有订单时不报错，打印一句「暂无订单」

- [ ] **Step 3: 端到端手工验收（需要本地 dev 与桩）**

按 `README.md`「账号体系的端到端验证」一节的方式起 mock 与 dev，然后：

1. 浏览器下单 → 拿到订单 id
2. 跑 `--id <前缀>` 确认
3. 浏览器弹窗应在数秒内翻到「已解锁」

- [ ] **Step 4: 提交**

```bash
git add scripts/confirm-order.mjs
git commit -m "对账脚本：按金额与时间列出待确认订单，并告警已付款未领取"
```

---

### Task 10: 文档与上线清单

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: 更新 README**

- **补齐 Task 0 造成的文档过时**（Task 0 审查时发现，当时受"只改一个文件"的约束没动）：
  - `README.md:306` 的注释把底层命令写成裸 `node --test`，应带上 `--import ./scripts/ts-loader.mjs`
  - `README.md:381-385` 说 `@/lib` 别名"在 `node` 直跑时解析不了"、模块必须用相对导入 —— 挂上 loader 后这句已经不对了
  - **尤其要紧的一条**：`README.md:382` 把 `node tests/xxx.test.mts` 当作 `spawn EPERM` 时的兜底命令，而这条兜底同样没挂 loader —— 也就是说它恰好对被修好的 `ip-hash` / `paid-loop` 仍然无效。应改为 `node --import ./scripts/ts-loader.mjs tests/xxx.test.mts`
- **补齐 Task 2 造成的文档过时**（Task 2 审查发现，当时受"只改三个文件"的约束没动）。`gen-codes.mjs` 现在 import 了 `codes.ts`，而 `codes.ts` 内部用 `@/` 别名，所以**它的调用方式必须挂 loader**，否则裸跑必然 `ERR_MODULE_NOT_FOUND`。需要改的调用点（逐个核对，不要只改 README）：
  - `README.md:297`、`README.md:298`、`README.md:446`、`README.md:447` —— 四处命令模板
  - **`scripts/export-codes.mjs:75`** —— 这条最要紧：它把命令**写进导出的对账 `.txt` 文件**。那是给站长照着操作的活动指令，不是历史记录；不改的话导出的文件里是一句跑不通的命令
  - 改法：在 `node` 之后插入 `--import ./scripts/ts-loader.mjs `
- **补齐 Task 2 审查的 Minor 项**（都属"下个动到该文件的任务顺手做掉"）：
  - `src/lib/server/codes.ts` 的 `isValidCodeFormat` 里硬写着 `code.length === 16`，而同文件新增了 `CODE_LENGTH = 16`。两者若有一天不同步，`mintCode()` 会产出校验器拒绝的码 —— 正是新注释里担心的"生成的码核销不了"。改用 `CODE_LENGTH`
  - 同文件的模块头注释仍只写「激活码核销。」，而它现在也负责发码，补一句
  - `tests/mock-supabase.mjs` 声明了 `ALPHABET` 却从未使用，删掉 —— 留着它，将来有人实现 mock 核销时会把它当第二份真相抄走
- 「部署 → 最小上线路径」第 2 步：SQL 清单加 `supabase/orders.sql`，并说明 `accounts.sql` 仍然不要跑
- 「上线前务必逐条确认」加两条：
  - 收款码放到 `public/pay/`，六个文件（支付宝/微信 × ¥6.60/9.90/69.00）
  - `scripts/confirm-order.mjs` 能跑通，且确认一单后浏览器能自动开通
- 「已知待办」把「订单表与管理后台」改为「管理后台」（订单表已完成），并补「聚合支付接入（需资质）」
- 「已刻意不做的事」补一条：尾数对账（原因：每个尾数要一张单独的收款码，图片数量失控；当前用交易单号消歧）
- 「测试」一节补新增的四个测试文件

- [ ] **Step 2: 更新 `.env.example`**

本次不新增必填变量。在文件里补一行说明：

```
# 支付流程不需要新变量：确认到账由 scripts/confirm-order.mjs 做，
# 它用上面那对 Supabase 变量。收款码是静态资源，放在 public/pay/。
```

- [ ] **Step 3: 全量验证**

Run: `node --test --import ./scripts/ts-loader.mjs`
Expected: 全绿

Run: `npx tsc --noEmit && npm run build`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add README.md .env.example
git commit -m "文档：上线清单补收款码与订单表，待办里划掉订单表"
```

---

## 本计划中写得不完整的步骤

以下几处的代码没有写全，执行时需要先读既有文件再补 —— 列在这里，是免得执行者以为它们是完备的：

| 位置 | 缺什么 | 为什么 |
|---|---|---|
| Task 3 Step 2 | `security.sql` 的收口代码 | 需要先读该文件确认既有写法（收口的格式与函数签名有关） |
| Task 5 Step 5 | `mock-supabase.mjs` 的六个 RPC 实现 | 该文件 21 KB，需要先读它的 RPC 分发表结构 |
| Task 6 Step 1 | `tests/order-contract.test.mts` 的完整测试代码 | 需要照搬 `tests/account-contract.test.mts` 的起桩与请求辅助函数 |
| Task 8 Step 4 | `step === "pay"` 的完整 JSX | 该组件 300 行，需先读全文再改；已给出精确的结构要点 |
| Task 9 Step 1 | `confirm-order.mjs` 的完整实现 | 已给出完整 CLI 契约与输出格式，实现需照 `gen-codes.mjs` 的参数解析风格 |

补给方式：执行到该步时先读对应文件，按已给的接口契约与格式实现，再把结果回填进本计划。

## 上线前必须人工确认的事

这部分计划里做不完，因为它依赖站长本人的账号与资质：

1. **三张微信收款码已在 `public/pay/`**（`wechat-6.60.png` / `wechat-9.90.png` / `wechat-69.00.png`，559×559 方图）。**图片上的金额是物理的** —— 若日后改价，必须同时重做对应图片，否则 `qrSrcFor` 找不到文件、弹窗显示「暂未就绪」。改价是「改 `PLANS` 一行 + 换图」两件事，不能只做一件
2. **价格已裁决为 6.60**：用户先前报的 6.9 是他第一版做错的图；13:11 重做的 6.60 图与代码一致。原 6.90 的海报仍在微信目录里（未入库），别误用
3. 确认弹窗里三档价位各自显示出**正确的收款码**（6.60 别显示成 9.90）—— 三张图肉眼极像，只有金额数字不同
4. **`supabase/orders.sql` 已在生产库执行**，且 `security.sql` 的收口也执行过。跑 `check-supabase.mjs` 确认
5. **开收款语音提醒** —— 确认唯一的人工环节不会被漏掉
6. 走一遍完整链路：下单 → 付款 → `confirm-order.mjs` → 页面自动开通 → 再点「获取激活码」在另一台设备兑换
