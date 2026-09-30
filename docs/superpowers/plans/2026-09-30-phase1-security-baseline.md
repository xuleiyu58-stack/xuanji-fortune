# 玄机 阶段 1 — 安全底座 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让玄机站点可以安全公开 —— 堵住"任何人可无限调用 API 烧光余额"和"改个 localStorage 就是会员"两个致命漏洞，并把全站价格收敛到单一来源。

**Architecture:** 把授权与计费判断从浏览器搬到服务端。新建四个**零依赖的纯函数模块**（价格、校验、额度策略、转义），由 API 路由组合调用；额度计数落在 Supabase 的 `usage` 表，按设备 / IP / 全局三个维度记账。纯函数模块零 import 是刻意设计 —— Node 直接跑 TS 测试时跨模块导入需要显式 `.ts` 扩展名，会与 Next.js 的解析方式冲突，零依赖可以从根上绕开这个矛盾。

**Tech Stack:** Next.js 14.2.35（App Router）、TypeScript 5（strict）、Tailwind、Supabase（Postgres）、Node 24（`node --test`）、DeepSeek API

## Global Constraints

- Node 版本 ≥ 24（本机 v24.16.0）—— 依赖其原生 TypeScript 类型擦除能力
- `package.json` 设 `"type": "module"`；已实测 `next build` 在此设置下通过
- 设 `type: module` 的理由是**消除 `MODULE_TYPELESS_PACKAGE_JSON` 警告、避免多余的重解析开销、让模块语义确定**，而不是"否则跑不起来"。三种情形已实测：① 最近处无 `package.json` → 测试失败；② `package.json` 写 `"type": "commonjs"` → 测试失败；③ 有 `package.json` 但无 `type` 字段 → 通过，只吐警告（本仓库属此）。所以它是"输出干净与语义确定"的问题，不是"能不能跑"的问题
- **测试脚本必须是裸 `node --test`**。Node 24 不再把位置参数当作递归搜索的目录，写 `node --test tests/` 会以 `MODULE_NOT_FOUND` 硬失败（已实测）
- **原生类型擦除的三条限制**，后续任务的测试写法必须遵守：相对导入必须写显式 `.ts` 扩展名；不认 `@/*` 别名；无法 `import` `.tsx`。这三条已被下面的设计规避 —— 纯函数模块零依赖、测试只做相对路径导入、需要检查 `.tsx` 时按文本读取而非导入
- **被单元测试直接引入的模块必须是零 import**（`pricing.ts` / `validation.ts` / `quota-policy.ts` / `sanitize.ts`）；配置一律作为函数参数注入
- 应用代码之间沿用既有 `@/` 别名，不写扩展名
- 测试文件放 `tests/`，扩展名 `.mts`，引用源文件时写显式 `.ts` 扩展名
- Next.js 版本保持 14.2.35 不动
- **所有价格只能来自 `src/lib/pricing.ts`**，任何其它文件不得出现价格字面量
- 含密钥的环境变量严禁使用 `NEXT_PUBLIC_` 前缀
- 界面文案为简体中文，风格沿用现有站点的玄学口吻
- 提交信息格式沿用仓库既有风格：emoji + 中文描述

## 价格基准（唯一真相）

| 模式 | 价格 |
|---|---|
| `daily` 今日运势 | 免费 |
| `oracle` 灵签求签 | 免费 |
| `bazi` 八字命理 | ¥6.6 |
| `tarot` AI 塔罗 | ¥3.8 |
| `love` 姻缘配对 | ¥8.8 |
| `member_month` 月卡 | ¥9.9 / 30 天 |
| `member_year` 年卡 | ¥69 / 365 天 |

---

### Task 1: 测试基础设施

让 Node 能直接跑 TypeScript 单元测试。这是后续所有任务的前提。

**Files:**
- Modify: `package.json`
- Test: `tests/smoke.test.mts`（临时冒烟测试，验证完即删）

**Interfaces:**
- Consumes: 无
- Produces: `npm test` 能执行 `tests/` 下所有 `.test.mjs` 与 `.test.mts` 文件

- [ ] **Step 1: 写一个冒烟测试**

冒烟测试要**跨模块 import 一个 `.ts` 文件** —— 这正是后续任务里每个测试都会做的事，用它来证明这条链路真的通。

创建辅助模块 `tests/smoke-helper.ts`：

```ts
// 临时文件：本任务结束时连同冒烟测试一并删除
export function add(a: number, b: number): number {
  return a + b;
}
```

创建测试 `tests/smoke.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { add } from "./smoke-helper.ts";

test("能直接跑 TypeScript 测试", () => {
  assert.equal(add(1, 2), 3);
});
```

- [ ] **Step 2: 运行，确认问题存在**

Run: `npm test`
Expected: 测试 **通过（3/3）**，但输出里带一条警告：

```
[MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///.../tests/smoke-helper.ts
is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to .../package.json
```

> **这一步不会报错。** Node 24 的模块语法探测会让它自动按 ESM 重新解析，所以测试照样全绿。要修的是那条警告和多余的重解析开销，不是错误。
>
> **三种情形已实测**：① 最近处完全没有 `package.json` → 失败；② `package.json` 显式写 `"type": "commonjs"` → 失败；③ 有 `package.json` 但没有 `type` 字段 → **通过**，只吐上面那条警告。本仓库属于第 ③ 种。所以这一步不会红，要修的是警告与重解析开销，不是错误 —— 不要为了凑出一个红色状态去改测试。
>
> （报错文案还取决于入口文件扩展名：入口是 `.ts` 时报 `Cannot use import statement outside a module`；入口是 `.mts`、被导入的 `.ts` 回退成 CJS 时报 `does not provide an export named`。两者都是失败，措辞不同。）

- [ ] **Step 3: 修改 package.json**

只加 `"type": "module"` 一项，**`test` 脚本保持裸 `node --test` 不变**：

```json
{
  "name": "fortune-telling",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "node --test"
  },
```

> **不要**把脚本写成 `node --test tests/`。Node 24 已不再把位置参数当作递归搜索的目录，那样写会以 `MODULE_NOT_FOUND` 硬失败（已实测）。裸 `node --test` 才会按默认模式递归发现 `tests/` 下的 `*.test.mts`。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 3 个测试通过（新增的冒烟测试 + 原有的 2 个），**且输出里不再有 `MODULE_TYPELESS_PACKAGE_JSON` 警告**。测试输出必须干净，不能有 stray warning。

- [ ] **Step 5: 确认 Next 构建没被 `type: module` 破坏**

Run: `npx next build`
Expected: 构建成功，输出 11 条路由（`/`、`/api/fortune`、5 个 fortune 页、`/member` 等）

若构建失败，说明 `type: module` 与本项目不兼容 —— 停下来，改用 `npm i -D tsx` 并把 `test` 脚本换成 `node --import tsx --test tests/`，然后回到 Step 1 重做。

- [ ] **Step 6: 删除冒烟测试并提交**

```bash
rm tests/smoke.test.mts tests/smoke-helper.ts
git add package.json
git commit -m "🔧 测试基础设施：启用 type:module，支持直接跑 TypeScript 测试"
```

---

### Task 2: 价格单一来源

**Files:**
- Create: `src/lib/pricing.ts`
- Test: `tests/pricing.test.mts`

**Interfaces:**
- Consumes: 无（刻意保持零 import）
- Produces:
  - `type Mode = "daily" | "oracle" | "bazi" | "tarot" | "love"`
  - `MODES: Record<Mode, { title: string; icon: string; price: number }>`
  - `MEMBER_PLANS: ReadonlyArray<{ id: string; name: string; price: number; days: number }>`
  - `FREE_DAILY_QUOTA: number`（值为 3）
  - `FREE_IP_DAILY_LIMIT: number`（值为 6）
  - `isMode(v: string): v is Mode`
  - `getModePrice(mode: Mode): number`
  - `isFreeMode(mode: Mode): boolean`
  - `formatPrice(n: number): string`

- [ ] **Step 1: 写失败的测试**

创建 `tests/pricing.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES, MEMBER_PLANS, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT,
  isMode, getModePrice, isFreeMode, formatPrice,
} from "../src/lib/pricing.ts";

test("五种模式的名称与价格符合统一基准", () => {
  assert.equal(MODES.daily.title, "今日运势");
  assert.equal(MODES.daily.price, 0);
  assert.equal(MODES.oracle.price, 0);
  assert.equal(MODES.bazi.price, 6.6);
  assert.equal(MODES.tarot.price, 3.8);
  assert.equal(MODES.love.price, 8.8);
});

test("会员只有月卡和年卡两种，终身卡已移除", () => {
  assert.equal(MEMBER_PLANS.length, 2);
  assert.deepEqual(MEMBER_PLANS.map((p) => p.id), ["member_month", "member_year"]);
  assert.equal(MEMBER_PLANS[0].price, 9.9);
  assert.equal(MEMBER_PLANS[1].price, 69);
});

test("额度常量为 3 与 6", () => {
  assert.equal(FREE_DAILY_QUOTA, 3);
  assert.equal(FREE_IP_DAILY_LIMIT, 6);
});

test("isMode 只认白名单内的模式", () => {
  assert.equal(isMode("bazi"), true);
  assert.equal(isMode("admin"), false);
  assert.equal(isMode(""), false);
  assert.equal(isMode("__proto__"), false);
});

test("免费模式判定", () => {
  assert.equal(isFreeMode("daily"), true);
  assert.equal(isFreeMode("oracle"), true);
  assert.equal(isFreeMode("bazi"), false);
});

test("formatPrice 不补多余小数", () => {
  assert.equal(formatPrice(6.6), "6.6");
  assert.equal(formatPrice(69), "69");
  assert.equal(formatPrice(9.9), "9.9");
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/lib/pricing.ts'`

- [ ] **Step 3: 实现 pricing.ts**

创建 `src/lib/pricing.ts`（**零 import**）：

```ts
export const FREE_DAILY_QUOTA = 3;
export const FREE_IP_DAILY_LIMIT = 6;

export type Mode = "daily" | "oracle" | "bazi" | "tarot" | "love";

export interface ModeInfo {
  title: string;
  icon: string;
  /** 单位：元。0 表示免费模式。 */
  price: number;
}

export const MODES: Record<Mode, ModeInfo> = {
  daily: { title: "今日运势", icon: "🎯", price: 0 },
  oracle: { title: "灵签求签", icon: "🏮", price: 0 },
  bazi: { title: "八字命理", icon: "📅", price: 6.6 },
  tarot: { title: "AI 塔罗", icon: "🃏", price: 3.8 },
  love: { title: "姻缘配对", icon: "💑", price: 8.8 },
};

export interface MemberPlan {
  id: string;
  name: string;
  price: number;
  days: number;
}

export const MEMBER_PLANS: ReadonlyArray<MemberPlan> = [
  { id: "member_month", name: "月卡", price: 9.9, days: 30 },
  { id: "member_year", name: "年卡", price: 69, days: 365 },
];

export function isMode(value: string): value is Mode {
  return Object.prototype.hasOwnProperty.call(MODES, value);
}

export function getModePrice(mode: Mode): number {
  return MODES[mode].price;
}

export function isFreeMode(mode: Mode): boolean {
  return MODES[mode].price === 0;
}

export function formatPrice(value: number): string {
  return String(value);
}
```

注意 `isMode` 用 `hasOwnProperty` 而不是 `in` —— `in` 会把 `__proto__`、`toString` 这类原型链上的键判为合法。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 6 个 pricing 测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/pricing.ts tests/pricing.test.mts
git commit -m "💰 价格单一来源：新建 pricing.ts，统一全站价格基准"
```

---

### Task 3: 全站接入 pricing，清除硬编码价格

**Files:**
- Modify: `src/app/page.tsx:13-17,94-98`
- Modify: `src/app/member/page.tsx:13-15,75,89`
- Modify: `src/components/QuotaBanner.tsx:59`
- Modify: `src/components/FortuneForm.tsx:81,84,100,102`
- Modify: `src/app/fortune/{daily,oracle,bazi,tarot,love}/page.tsx`（price prop）
- Test: `tests/no-hardcoded-prices.test.mts`

**Interfaces:**
- Consumes: Task 2 的 `MODES`、`MEMBER_PLANS`、`getModePrice`、`formatPrice`
- Produces: 全站无价格字面量

- [ ] **Step 1: 写失败的测试**

创建 `tests/no-hardcoded-prices.test.mts` —— 沿用仓库既有的"读源文件做断言"风格：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../src/", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

const TARGETS = [
  "app/page.tsx",
  "app/member/page.tsx",
  "components/QuotaBanner.tsx",
  "components/FortuneForm.tsx",
  "app/fortune/daily/page.tsx",
  "app/fortune/oracle/page.tsx",
  "app/fortune/bazi/page.tsx",
  "app/fortune/tarot/page.tsx",
  "app/fortune/love/page.tsx",
];

test("界面文件里不得出现写死的价格数字", () => {
  for (const rel of TARGETS) {
    const src = read(rel);
    // ¥ 后面直接跟数字 = 写死的价格。¥{formatPrice(...)} 的 ¥ 后面是 {，不会命中。
    const hit = src.match(/¥\s*\d[^"'{}\n]*/);
    assert.equal(hit, null, `${rel} 里仍有写死的价格：${hit?.[0] ?? ""}`);
  }
});

test("不得再向 FortuneForm 传 price 属性", () => {
  for (const rel of TARGETS.filter((f) => f.startsWith("app/fortune/"))) {
    assert.doesNotMatch(read(rel), /price=/, `${rel} 仍在传 price`);
  }
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— 会报出 `app/member/page.tsx 里仍有硬编码价格 28.8` 等

- [ ] **Step 3: 改 `src/app/page.tsx`**

把 13-17 行的产品卡片改为从 `MODES` 生成：

```tsx
import { MODES, MEMBER_PLANS, formatPrice, type Mode } from "@/lib/pricing";

// 副标题是文案，不属于价格，因此留在页面里
const SUBTITLES: Record<Mode, string> = {
  daily: "每日免费，AI 解读当日吉凶宜忌",
  oracle: "古刹灵签免费求，AI 解签指点迷津",
  bazi: "子平八字，紫微斗数。深度排盘解析命局格局、事业财运、感情婚姻",
  tarot: "三张牌阵，AI 解牌。融合东西方占卜智慧，解答心中困惑",
  love: "月老牵线，命盘合婚。看两人前世今生缘分，获相处锦囊",
};

const PRODUCTS = (Object.keys(MODES) as Mode[]).map((mode, i) => ({
  mode,
  icon: MODES[mode].icon,
  title: MODES[mode].title,
  subtitle: SUBTITLES[mode],
  price: MODES[mode].price === 0 ? "免费" : formatPrice(MODES[mode].price),
  // tag 是卡片右上角的角标：免费标"免费"，付费标"热门"
  tag: MODES[mode].price === 0 ? "免费" : "热门",
  href: `/fortune/${mode}`,
  delay: 0.1 * (i + 1),
}));
```

原来卡片另有 `tag` 字段标"热门"（八字）与"免费"（运势、灵签），本改写按"免费/付费"统一推导，效果一致。

把 94-98 行的会员卡价格改为读 `MEMBER_PLANS`：

```tsx
const monthPlan = MEMBER_PLANS[0];
const yearPlan = MEMBER_PLANS[1];
```

```tsx
<span className="symbol">¥</span>
<span className="amount">{formatPrice(monthPlan.price)}</span>
<span className="text-xs text-paper-100/40">/月</span>
...
<p className="text-paper-100/20 text-xs mt-3">
  一杯奶茶钱，无限次算命 · 年付 ¥{formatPrice(yearPlan.price)} 更划算
</p>
```

> 说明：原首页里"热门"标签和产品顺序按 `Object.keys(MODES)` 的插入顺序（daily、oracle、bazi、tarot、love）生成。若需保留原顺序（daily、oracle、bazi、tarot、love）无需额外处理 —— 二者一致。

- [ ] **Step 4: 改 `src/app/member/page.tsx`**

15 行原有的终身卡整行删除。13-15 行的套餐数组改为：

```tsx
import { MEMBER_PLANS, formatPrice } from "@/lib/pricing";

const PLANS = MEMBER_PLANS.map((p) => ({
  ...p,
  duration: `${p.days}天`,
  icon: p.id === "member_year" ? "👑" : "🌙",
  recommend: p.id === "member_year",
  desc: p.id === "member_year" ? "日均不到 ¥0.2，超值之选" : "按月订阅，灵活便捷",
}));
```

把 75 行价格显示与 89 行 `PaymentModal` 的 `price` 都改为 `formatPrice(plan.price)` / `formatPrice(selectedPlan.price)`。

原先第 76 行是划线原价，它依赖的 `original` 字段不复存在，**整行删除**：

```tsx
<p className="text-paper-100/20 text-xs line-through mb-6">¥{plan.original}</p>
```

把 84 行权益列表里的 `["🎁","分享好友双方得会员"]` 整项删除（呼应 Task 9）。

- [ ] **Step 5: 改 `src/components/QuotaBanner.tsx`**

59 行 `开通会员 ¥28.8` 改为：

```tsx
import { MEMBER_PLANS, formatPrice, FREE_DAILY_QUOTA } from "@/lib/pricing";
...
<Link href="/member" className="btn-primary !py-1.5 !px-4 !text-xs flex-1 text-center">
  开通会员 ¥{formatPrice(MEMBER_PLANS[0].price)}
</Link>
```

同时把 47 行的 `/3` 改为 `/{FREE_DAILY_QUOTA}`，8 行的 `useState(3)` 与 44 行保持一致。

- [ ] **Step 6: 改 `src/components/FortuneForm.tsx`**

`price` 改为从 `pricing` 取，不再由页面传入。删除 `Props` 里的 `price` 字段，改为：

```tsx
import { MODES, MEMBER_PLANS, formatPrice, type Mode } from "@/lib/pricing";
...
const modeInfo = MODES[mode as Mode];
const price = formatPrice(modeInfo.price);
```

84 行 `PaymentModal` 的 `price={mode === "daily" ? "28.8" : price}` 改为 `price={formatPrice(MEMBER_PLANS[0].price)}`。
100 行、102 行的 `¥28.8` 同样改为 `¥{formatPrice(MEMBER_PLANS[0].price)}`。

- [ ] **Step 7: 改五个模式页，删掉 price prop**

`src/app/fortune/*/page.tsx` 中传给 `<FortuneForm>` 的 `price="..."` 属性全部删除（`daily` 的 `price="0"`、`oracle` 的 `price="5.8"`、`bazi` 的 `price="18.8"`、`tarot` 的 `price="8.8"`、`love` 的 `price="36.9"`）。价格现在由 `FortuneForm` 内部根据 `mode` 自行取得。

- [ ] **Step 8: 运行测试与构建，确认通过**

Run: `npm test && npx next build`
Expected: 全部 PASS，构建成功

若测试报某处仍有硬编码，按提示逐个替换为 `pricing.ts` 的值。

- [ ] **Step 9: 提交**

```bash
git add src/ tests/no-hardcoded-prices.test.mts
git commit -m "💰 全站价格改读 pricing.ts：修复首页与实际收费差 2-4 倍的矛盾"
```

---

### Task 4: 输入校验

**Files:**
- Create: `src/lib/validation.ts`
- Test: `tests/validation.test.mts`

**Interfaces:**
- Consumes: 无（零 import；合法模式列表由调用方注入）
- Produces:
  - `MAX_SHORT_FIELD: number`（200）、`MAX_LONG_FIELD: number`（500）
  - `LONG_FIELDS: readonly string[]`（`["question", "concern"]`）
  - `type ValidationOutcome = { ok: true; mode: string; input: Record<string, string> } | { ok: false; error: string }`
  - `validateFortuneRequest(body: unknown, allowedModes: readonly string[]): ValidationOutcome`

- [ ] **Step 1: 写失败的测试**

创建 `tests/validation.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateFortuneRequest, MAX_SHORT_FIELD } from "../src/lib/validation.ts";

const ALLOWED = ["daily", "oracle", "bazi", "tarot", "love"];

test("缺少 mode 时拒绝", () => {
  const r = validateFortuneRequest({}, ALLOWED);
  assert.equal(r.ok, false);
});

test("白名单外的 mode 被拒绝", () => {
  const r = validateFortuneRequest({ mode: "admin" }, ALLOWED);
  assert.equal(r.ok, false);
});

test("原型链上的键不被当作合法 mode", () => {
  assert.equal(validateFortuneRequest({ mode: "__proto__" }, ALLOWED).ok, false);
  assert.equal(validateFortuneRequest({ mode: "toString" }, ALLOWED).ok, false);
});

test("非对象请求体被拒绝", () => {
  assert.equal(validateFortuneRequest(null, ALLOWED).ok, false);
  assert.equal(validateFortuneRequest("x", ALLOWED).ok, false);
  assert.equal(validateFortuneRequest([], ALLOWED).ok, false);
});

test("合法请求通过并剥离 mode 与非法字段", () => {
  const r = validateFortuneRequest(
    { mode: "bazi", birthDate: "1990-01-01", evil: "x", nested: { a: 1 } },
    ALLOWED
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.mode, "bazi");
    assert.deepEqual(r.input, { birthDate: "1990-01-01" });
  }
});

test("超长短字段被拒绝", () => {
  const r = validateFortuneRequest(
    { mode: "bazi", birthDate: "x".repeat(MAX_SHORT_FIELD + 1) },
    ALLOWED
  );
  assert.equal(r.ok, false);
});

test("文本域上限比短字段宽", () => {
  const ok = validateFortuneRequest(
    { mode: "tarot", question: "x".repeat(MAX_SHORT_FIELD + 1) },
    ALLOWED
  );
  assert.equal(ok.ok, true);

  const bad = validateFortuneRequest(
    { mode: "tarot", question: "x".repeat(500 + 1) },
    ALLOWED
  );
  assert.equal(bad.ok, false);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/lib/validation.ts'`

- [ ] **Step 3: 实现 validation.ts**

创建 `src/lib/validation.ts`（**零 import**）：

```ts
export const MAX_SHORT_FIELD = 200;
export const MAX_LONG_FIELD = 500;

/** 每个模式接受的字段。白名单之外的一律丢弃，防止脏数据进入 prompt。 */
export const MODE_FIELDS: Record<string, readonly string[]> = {
  daily: [],
  oracle: ["concern"],
  bazi: ["birthDate", "birthTime", "gender"],
  tarot: ["question"],
  love: ["person1", "person2"],
};

const LONG_FIELDS: readonly string[] = ["question", "concern"];

export type ValidationOutcome =
  | { ok: true; mode: string; input: Record<string, string> }
  | { ok: false; error: string };

function limitFor(key: string): number {
  return LONG_FIELDS.includes(key) ? MAX_LONG_FIELD : MAX_SHORT_FIELD;
}

export function validateFortuneRequest(
  body: unknown,
  allowedModes: readonly string[]
): ValidationOutcome {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求格式不正确" };
  }

  const raw = body as Record<string, unknown>;
  const mode = raw.mode;

  if (typeof mode !== "string" || !allowedModes.includes(mode)) {
    return { ok: false, error: "请选择测算模式" };
  }

  const allowedFields = MODE_FIELDS[mode] ?? [];
  const input: Record<string, string> = {};

  for (const key of allowedFields) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    if (value.length > limitFor(key)) {
      return { ok: false, error: "输入内容过长，请精简后重试" };
    }
    input[key] = value;
  }

  return { ok: true, mode, input };
}
```

三点刻意的设计：只接受字符串值（对象/数组一律丢弃）、按模式白名单取字段（未知字段进不了 prompt）、用 `includes` 而非对象查找做模式校验（不碰原型链）。

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 7 个 validation 测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/validation.ts tests/validation.test.mts
git commit -m "🛡️ 新增输入校验：mode 白名单 + 输入长度上限"
```

---

### Task 5: 额度策略（纯逻辑）

把"该不该放行"的判断抽成不碰 I/O 的纯函数，这样它能被完整单测覆盖。

**Files:**
- Create: `src/lib/quota-policy.ts`
- Test: `tests/quota-policy.test.mts`

**Interfaces:**
- Consumes: 无（零 import；额度上限由调用方注入）
- Produces:
  - `interface UsageCounts { device: number; ip: number; global: number }`
  - `interface QuotaLimits { device: number; ip: number; global: number }`
  - `type QuotaDecision = { allowed: true } | { allowed: false; reason: "device" | "ip" | "global"; message: string }`
  - `decideQuota(counts: UsageCounts, limits: QuotaLimits): QuotaDecision`

- [ ] **Step 1: 写失败的测试**

创建 `tests/quota-policy.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { decideQuota } from "../src/lib/quota-policy.ts";

const LIMITS = { device: 3, ip: 6, global: 300 };

test("全部未超限时放行", () => {
  const d = decideQuota({ device: 0, ip: 0, global: 0 }, LIMITS);
  assert.equal(d.allowed, true);
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
  const d = decideQuota({ device: 0, ip: 0, global: 300 }, LIMITS);
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.reason, "global");
    assert.match(d.message, /稍后/);
  }
});

test("恰好差一次时仍然放行", () => {
  assert.equal(decideQuota({ device: 2, ip: 5, global: 299 }, LIMITS).allowed, true);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/lib/quota-policy.ts'`

- [ ] **Step 3: 实现 quota-policy.ts**

创建 `src/lib/quota-policy.ts`（**零 import**）：

```ts
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

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: "device" | "ip" | "global"; message: string };

export function decideQuota(counts: UsageCounts, limits: QuotaLimits): QuotaDecision {
  // 全局熔断先判：它是保护 API 余额的最后一道闸，一旦触发就不再放行任何请求
  if (counts.global >= limits.global) {
    return {
      allowed: false,
      reason: "global",
      message: "今日测算人数过多，请稍后再试",
    };
  }

  if (counts.device >= limits.device) {
    return {
      allowed: false,
      reason: "device",
      message: "今日免费次数已用完，开通会员可无限次解读",
    };
  }

  if (counts.ip >= limits.ip) {
    return {
      allowed: false,
      reason: "ip",
      message: "今日免费次数已用完，开通会员可无限次解读",
    };
  }

  return { allowed: true };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 5 个 quota-policy 测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/lib/quota-policy.ts tests/quota-policy.test.mts
git commit -m "🛡️ 额度策略纯函数：device / IP / 全局三维度判定"
```

---

### Task 6: Supabase 用量存储

**Files:**
- Create: `src/lib/server/usage-store.ts`
- Create: `supabase/schema.sql`

**Interfaces:**
- Consumes: Task 5 的 `UsageCounts`
- Produces:
  - `readUsage(deviceId: string, ipHash: string): Promise<UsageCounts>`
  - `bumpUsage(deviceId: string, ipHash: string): Promise<void>`
  - `dailyGlobalBudget(): number`
  - `hashIp(ip: string): string`

> **本任务没有单元测试文件**，因为它是纯 I/O 层（Supabase 读写），单测只能测到 mock。它的行为由 Task 7 的集成验收覆盖：额度计数是否真的落库、并发下是否丢计数。这是刻意的取舍，不是遗漏。

**前置条件：** 本任务需要 `.env.local` 中存在 `NEXT_PUBLIC_SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，且 Supabase 里已执行 `supabase/schema.sql`。这两件事只有项目所有者能做，若尚未完成，先做 Task 7/8，回来再补本任务的验证。

- [ ] **Step 1: 写建表 SQL**

创建 `supabase/schema.sql`：

```sql
-- 用量计数表：device / ip / global 三个维度共用一张表
create table if not exists public.usage (
  key   text not null,
  day   date not null default current_date,
  count int  not null default 0,
  primary key (key, day)
);

-- 只允许服务端 service_role 读写，客户端一律无权
alter table public.usage enable row level security;
revoke all on public.usage from anon, authenticated;

-- 原子自增，避免并发下丢计数
create or replace function public.bump_usage(k text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage (key, day, count)
  values (k, current_date, 1)
  on conflict (key, day) do update set count = public.usage.count + 1;
$$;

revoke all on function public.bump_usage(text) from anon, authenticated;
```

> 这一段在 Supabase 控制台的 SQL Editor 里执行一次。

- [ ] **Step 2: 实现 usage-store.ts**

创建 `src/lib/server/usage-store.ts`：

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { UsageCounts } from "@/lib/quota-policy";

const GLOBAL_KEY = "global";

function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // 刻意不做降级放行：限流失效时必须拒绝服务，而不是敞开烧钱
    throw new Error("Supabase 未配置：缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export function dailyGlobalBudget(): number {
  const raw = process.env.DEEPSEEK_DAILY_BUDGET;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 300;
}

export function deviceKey(deviceId: string): string {
  return `dev:${deviceId}`;
}

export function ipKey(ipHash: string): string {
  return `ip:${ipHash}`;
}

export async function readUsage(deviceId: string, ipHash: string): Promise<UsageCounts> {
  const db = admin();
  const keys = [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY];
  const { data, error } = await db
    .from("usage")
    .select("key, count")
    .in("key", keys)
    .eq("day", new Date().toISOString().slice(0, 10));

  if (error) throw new Error(`读取用量失败: ${error.message}`);

  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.count as number]));
  return {
    device: byKey.get(deviceKey(deviceId)) ?? 0,
    ip: byKey.get(ipKey(ipHash)) ?? 0,
    global: byKey.get(GLOBAL_KEY) ?? 0,
  };
}

export async function bumpUsage(deviceId: string, ipHash: string): Promise<void> {
  const db = admin();
  const keys = [deviceKey(deviceId), ipKey(ipHash), GLOBAL_KEY];
  // 用 rpc 走原子自增，避免并发丢计数
  await Promise.all(keys.map((k) => db.rpc("bump_usage", { k })));
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 4: 提交**

```bash
git add src/lib/server/usage-store.ts supabase/schema.sql
git commit -m "🛡️ Supabase 用量存储：三维度原子计数 + 建表 SQL"
```

---

### Task 7: 重写 API 路由

把所有零件接起来。原先 29 行、完全敞开的接口，变成完整受控的入口。

**Files:**
- Modify: `src/app/api/fortune/route.ts`（整体重写）
- Modify: `src/lib/ai.ts:3-6`（去掉 `"sk-placeholder"` 兜底）
- Test: `tests/route-contract.test.mts`

**Interfaces:**
- Consumes: Task 2 `MODES`/`FREE_DAILY_QUOTA`/`FREE_IP_DAILY_LIMIT`、Task 4 `validateFortuneRequest`、Task 5 `decideQuota`、Task 6 `readUsage`/`bumpUsage`/`hashIp`/`dailyGlobalBudget`
- Produces: `POST /api/fortune` 的契约 —— 400 参数错误 / 403 额度用尽 / 503 服务未就绪 / 500 AI 失败 / 200 成功（带 `success: true` 与 `content`）

- [ ] **Step 1: 写失败的测试**

路由本身依赖 Next 运行时难以直接单测，因此这里断言的是**契约与调用顺序**（沿用仓库既有的源文件断言风格）：

创建 `tests/route-contract.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/app/api/fortune/route.ts", import.meta.url), "utf8");

test("路由使用输入校验而非直接取 body", () => {
  assert.match(src, /validateFortuneRequest/);
});

test("路由在调用 AI 之前先判定额度", () => {
  // 必须匹配"调用点"而非函数名 —— 函数名在顶部 import 行就会出现，会把顺序判反
  const iQuota = src.indexOf("decideQuota(counts");
  const iAi = src.indexOf("await getFortune(");
  assert.ok(iQuota >= 0, "未调用 decideQuota");
  assert.ok(iAi >= 0, "未调用 getFortune");
  assert.ok(iQuota < iAi, "额度判定必须发生在调用 AI 之前");
});

test("只在 AI 成功后才记账", () => {
  const iAi = src.indexOf("await getFortune(");
  const iBump = src.indexOf("await bumpUsage(");
  assert.ok(iBump >= 0, "未调用 bumpUsage");
  assert.ok(iAi < iBump, "记账必须发生在 AI 调用之后");
});

test("额度用尽返回 403，服务未就绪返回 503", () => {
  assert.match(src, /403/);
  assert.match(src, /503/);
});

test("签发 httpOnly 设备 cookie", () => {
  assert.match(src, /httpOnly/);
  assert.match(src, /xj_dev/);
});

test("不再使用占位 API key", () => {
  const ai = readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ai, /sk-placeholder/);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— 多条断言失败，因为现有路由只有 29 行、没有任何校验或限流

- [ ] **Step 3: 修改 `src/lib/ai.ts`**

删掉占位 key 兜底，缺 key 时显式报错而不是拿假 key 去请求：

```ts
import OpenAI from "openai";

function makeClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY 环境变量");
  }
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" });
}

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = makeClient();
  return _client;
}
```

把 `getFortune` 内部原先的 `client.chat.completions.create(...)` 改为 `client().chat.completions.create(...)`。

- [ ] **Step 4: 重写 `src/app/api/fortune/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getFortune } from "@/lib/ai";
import { MODES, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT } from "@/lib/pricing";
import { validateFortuneRequest } from "@/lib/validation";
import { decideQuota } from "@/lib/quota-policy";
import { readUsage, bumpUsage, hashIp, dailyGlobalBudget } from "@/lib/server/usage-store";
import { randomUUID } from "node:crypto";

// 用到 node:crypto，必须显式声明 Node 运行时，避免被部署到 Edge Runtime
export const runtime = "nodejs";

const DEVICE_COOKIE = "xj_dev";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

function withDeviceCookie(res: NextResponse, deviceId: string, isNew: boolean): NextResponse {
  if (isNew) {
    res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
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
  const ipHash = hashIp(clientIp(req));

  let counts;
  try {
    counts = await readUsage(deviceId, ipHash);
  } catch (err) {
    console.error("用量读取失败:", err);
    return NextResponse.json(
      { success: false, error: "服务暂时不可用，请稍后再试" },
      { status: 503 }
    );
  }

  const decision = decideQuota(counts, {
    device: FREE_DAILY_QUOTA,
    ip: FREE_IP_DAILY_LIMIT,
    global: dailyGlobalBudget(),
  });

  if (!decision.allowed) {
    return withDeviceCookie(
      NextResponse.json({ success: false, error: decision.message }, { status: 403 }),
      deviceId,
      existing === undefined
    );
  }

  const result = await getFortune(checked.mode, checked.input);

  if (!result.success) {
    // 失败不记账：不让用户为服务端故障买单
    return withDeviceCookie(
      NextResponse.json(result, { status: 500 }),
      deviceId,
      existing === undefined
    );
  }

  try {
    await bumpUsage(deviceId, ipHash);
  } catch (err) {
    // 记账失败不影响本次结果，但要留痕
    console.error("用量记账失败:", err);
  }

  return withDeviceCookie(NextResponse.json(result), deviceId, existing === undefined);
}
```

- [ ] **Step 5: 运行测试与构建**

Run: `npm test && npx next build`
Expected: 全部 PASS，构建成功

- [ ] **Step 6: 提交**

```bash
git add src/app/api/fortune/route.ts src/lib/ai.ts tests/route-contract.test.mts
git commit -m "🔐 重写 API 路由：服务端限流 + 输入校验 + 失败不扣额"
```

---

### Task 8: 修复 AI 输出转义

当前 `FortuneForm.tsx:109` 把 AI 返回的文本直接丢进 `dangerouslySetInnerHTML`，只做了几个正则替换、没有转义。用户输入会进入 prompt，因此这是可被诱导触发的 XSS。

**Files:**
- Create: `src/lib/sanitize.ts`
- Modify: `src/components/FortuneForm.tsx:109`
- Test: `tests/sanitize.test.mts`

**Interfaces:**
- Consumes: 无（零 import）
- Produces:
  - `escapeHtml(raw: string): string`
  - `renderFortuneHtml(raw: string): string`

- [ ] **Step 1: 写失败的测试**

创建 `tests/sanitize.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, renderFortuneHtml } from "../src/lib/sanitize.ts";

test("转义 HTML 元字符", () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml('a & b "c" \'d\''), "a &amp; b &quot;c&quot; &#39;d&#39;");
});

test("注入的标签不会存活", () => {
  const out = renderFortuneHtml('<img src=x onerror="alert(1)">');
  assert.doesNotMatch(out, /<img/);
  assert.doesNotMatch(out, /onerror=/);
});

test("保留 **粗体** 的排版能力", () => {
  assert.match(renderFortuneHtml("这是**重点**内容"), /<strong[^>]*>重点<\/strong>/);
});

test("保留 【小标题】 的排版能力", () => {
  assert.match(renderFortuneHtml("【今日卦象】乾为天"), /<strong[^>]*>【今日卦象】<\/strong>/);
});

test("换行转成 br", () => {
  const out = renderFortuneHtml("第一行\n第二行\n\n第三段");
  assert.match(out, /第一行<br\/?>第二行/);
});

test("先转义再套用排版，标签里的尖括号不会被当成语法", () => {
  const out = renderFortuneHtml("**<script>x</script>**");
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module '../src/lib/sanitize.ts'`

- [ ] **Step 3: 实现 sanitize.ts**

创建 `src/lib/sanitize.ts`（**零 import**）：

```ts
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/**
 * 先把整段文本转义，再套用白名单内的排版标签。
 * 顺序不能反 —— 先转义保证了任何 AI 输出的标签都无法存活。
 */
export function renderFortuneHtml(raw: string): string {
  return escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gold-300">$1</strong>')
    .replace(/【(.+?)】/g, '<strong class="text-gold-300 block mt-4 mb-2 text-base">【$1】</strong>')
    .replace(/\n{2,}/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS —— 6 个 sanitize 测试全绿

- [ ] **Step 5: 接入 FortuneForm**

把 `src/components/FortuneForm.tsx:109` 的整段 `dangerouslySetInnerHTML` 表达式改成：

```tsx
dangerouslySetInnerHTML={{ __html: renderFortuneHtml(result ?? "") }}
```

并在文件顶部 import 区加：

```tsx
import { renderFortuneHtml } from "@/lib/sanitize";
```

- [ ] **Step 6: 运行测试与构建**

Run: `npm test && npx next build`
Expected: 全部 PASS，构建成功

- [ ] **Step 7: 提交**

```bash
git add src/lib/sanitize.ts src/components/FortuneForm.tsx tests/sanitize.test.mts
git commit -m "🛡️ 修复 XSS：AI 输出先转义再渲染"
```

---

### Task 9: 移除虚假的邀请裂变

`addReferral()` 只是本机计数器 +1，自己点三次就给自己发会员；而且不校验被邀请人是谁。这是一个兑不了的承诺，删掉比留着强。

**Files:**
- Modify: `src/lib/store.ts:99-128`
- Modify: `src/components/FortuneForm.tsx:114`
- Modify: `src/components/QuotaBanner.tsx:3,10-11,16,19-26,55,57-72`
- Test: `tests/no-referral.test.mts`

> `HistoryDrawer.tsx` 等其它文件是否引用邀请相关函数，由 Step 5 的 grep 统一兜住，不预先假设。

**Interfaces:**
- Consumes: 无
- Produces: `store.ts` 不再导出 `getReferralCode` / `getReferralCount` / `addReferral`

- [ ] **Step 1: 写失败的测试**

创建 `tests/no-referral.test.mts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const form = readFileSync(new URL("../src/components/FortuneForm.tsx", import.meta.url), "utf8");
const banner = readFileSync(new URL("../src/components/QuotaBanner.tsx", import.meta.url), "utf8");

test("store 里不再有邀请相关实现", () => {
  assert.doesNotMatch(store, /getReferralCode/);
  assert.doesNotMatch(store, /getReferralCount/);
  assert.doesNotMatch(store, /addReferral/);
});

test("界面里不再出现邀请送会员的文案", () => {
  assert.doesNotMatch(form, /分享给 3 位好友/);
  assert.doesNotMatch(banner, /邀请好友/);
  assert.doesNotMatch(banner, /每邀3人/);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL —— 两处断言失败

- [ ] **Step 3: 删除 store.ts 中的邀请实现**

删掉 `src/lib/store.ts` 第 99-128 行整段（`getReferralCode`、`getReferralCount`、`addReferral`）。

- [ ] **Step 4: 清理界面**

`src/components/FortuneForm.tsx`：删除 114 行 `<p ...>分享给 3 位好友，赠送 1 天会员体验</p>` 整行。

`src/components/QuotaBanner.tsx`：
- 第 3 行的 import 去掉 `getReferralCode, getReferralCount`
- 删除 `refCount` state（第 11 行）、`setRefCount(...)`（第 16 行）、`handleCopyRef` 整个函数（19-26 行）、`copied` state（第 10 行）
- 把 57-72 行的按钮区改成只保留"开通会员"一个按钮：

```tsx
<div className="flex gap-2">
  <Link href="/member" className="btn-primary !py-1.5 !px-4 !text-xs flex-1 text-center">
    开通会员 ¥{formatPrice(MEMBER_PLANS[0].price)}
  </Link>
</div>
```

同时把第 55 行的文案从"今日免费次数已用完，开通会员或邀请好友获取更多机会"改为"今日免费次数已用完，开通会员可无限次解读"。

- [ ] **Step 5: 检查是否有其它引用残留**

Run: `grep -rn "eferral\|邀请" src/`
Expected: 只应剩 `src/app/page.tsx` 中"首页推荐码"相关的历史遗留（若有），把它一并清掉；除此之外不应有输出。

- [ ] **Step 6: 运行测试与构建**

Run: `npm test && npx next build`
Expected: 全部 PASS，构建成功

- [ ] **Step 7: 提交**

```bash
git add src/ tests/no-referral.test.mts
git commit -m "🧹 移除虚假的邀请裂变：本机计数器兑不了会员承诺"
```

---

### Task 10: 环境变量模板与部署说明

**Files:**
- Create: `.env.example`
- Create: `README.md`（覆盖现有的空文件）

**Interfaces:**
- Consumes: Task 6/7 用到的全部环境变量
- Produces: 无代码接口

- [ ] **Step 1: 创建 `.env.example`**

```bash
# ── DeepSeek ──────────────────────────────────────────
# 服务端专用。严禁加 NEXT_PUBLIC_ 前缀，否则会被打进浏览器包。
DEEPSEEK_API_KEY=
# 全局每日调用上限，熔断阈值。默认 300。
# 这个数字的含义是"最坏情况一天最多损失多少"，按你能承受的额度设。
DEEPSEEK_DAILY_BUDGET=300

# ── Supabase ──────────────────────────────────────────
# Project Settings → API 里取
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# 服务端专用，权限最高。泄露等于数据库裸奔，绝不能加 NEXT_PUBLIC_。
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 2: 写 README**

覆盖空的 `README.md`：

````markdown
# 玄机 · AI 命理解读

Next.js 14 + TypeScript + Tailwind，AI 解读由 DeepSeek 提供，账号与数据存 Supabase。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 然后填入真实值
npm run dev
```

打开 http://localhost:3000

## 环境变量

见 `.env.example`。三个变量缺一不可，其中 `SUPABASE_SERVICE_ROLE_KEY` 与 `DEEPSEEK_API_KEY` 仅服务端使用。

## 数据库初始化

在 Supabase 控制台的 SQL Editor 里执行 `supabase/schema.sql`。

## 测试

```bash
npm test
```

## 部署到 Vercel

1. 把仓库推到 GitHub
2. 在 Vercel 导入该仓库
3. 在 Vercel 的 Settings → Environment Variables 里填入 `.env.example` 中的全部五个变量
4. 部署

**上线前务必**：在 DeepSeek 控制台另行设置消费上限。代码里的每日熔断是防滥用的，控制台的上限才是防代码出错的最后一道保险。

## 价格维护

所有价格只定义在 `src/lib/pricing.ts`，任何其它文件都不得出现价格字面量。`tests/no-hardcoded-prices.test.mts` 会强制这一点。
````

- [ ] **Step 3: 确认 `.env.local` 与 `.env.example` 的 gitignore 关系**

Run: `git check-ignore -v .env.local; git status --short .env.example`
Expected: `.env.local` 被忽略（`.gitignore` 有 `.env*.local`）；`.env.example` 未被忽略、可提交

- [ ] **Step 4: 提交**

```bash
git add .env.example README.md
git commit -m "📝 环境变量模板与部署说明"
```

---

## 阶段 1 完成后的验收

全部任务完成后，逐条确认：

- [ ] `npm test` 全绿
- [ ] `npx next build` 成功
- [ ] 浏览器控制台执行 `localStorage.setItem('xuanji_member','true')` 后刷新，**不会**变成会员
- [ ] 未登录状态下第 4 次调用 `/api/fortune` 返回 403
- [ ] 清除 cookie 后重试，IP 维度仍会拦住第 7 次
- [ ] 全站任意位置显示的价格一致（八字 6.6 / 塔罗 3.8 / 姻缘 8.8 / 会员 9.9 月、69 年）
- [ ] `grep -rn "sk-" .next/static/` 无输出（API key 未进客户端包）
- [ ] `git log --all -p | grep -E "sk-[a-zA-Z0-9]{16,}"` 无输出

## 明确不在本阶段

- 账号体系与登录页（阶段 2）
- 订单与会员上云（阶段 3）
- 法律页、`public/` 资源、收款码（阶段 4）
- 管理后台（用户已确认延后）
