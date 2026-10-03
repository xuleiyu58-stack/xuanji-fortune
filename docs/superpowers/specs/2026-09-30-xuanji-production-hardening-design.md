# 玄机 AI 命理解读平台 — 生产化改造设计

- 日期：2026-09-30
- 状态：待实现
- 目标仓库：`xuleiyu58-stack/xuanji-fortune`（分支 `main`）

## 1. 背景与目标

玄机是一个已具备完整前端体验的 AI 命理解读站：Next.js 14（App Router）+ TypeScript + Tailwind，22 个源文件、1606 行，含 5 种测算模式、会员体系、支付弹窗、历史记录、邀请裂变。

**现状**：能演示，但不能公开上线。

**目标**：改造成可以部署、公开给他人使用、且能真实收费的产品。

**已确定的约束**：

| 项 | 决定 |
|---|---|
| 部署 | Vercel（应用）+ Supabase（账号与数据库）+ DeepSeek（AI） |
| 商业模式 | 保留付费 |
| 订单确认 | 先手动（直接改数据库），管理后台后续再做 |
| 价格 | 统一采用首页那一套 |

选择 Vercel 的原因：命理占卜类内容在国内属不予 ICP 备案的类型，海外托管可绕开该限制。

## 2. 现状问题清单

### P0 — 上线即出事

| # | 问题 | 位置 | 后果 |
|---|---|---|---|
| 1 | API 路由无鉴权、无限流 | `src/app/api/fortune/route.ts`（全文 29 行） | 任何人可无限调用，烧光 DeepSeek 余额 |
| 2 | 会员与额度判断全在浏览器 | `src/lib/store.ts` | 控制台改一个值即永久会员 |
| 3 | 支付无任何校验 | `PaymentModal.tsx` + `FortuneForm.tsx:57-64` | `hasPaid` 只是 React state，点"已完成支付"即解锁 |
| 4 | AI 输出用 `dangerouslySetInnerHTML` 渲染且未转义 | `FortuneForm.tsx:109` | XSS 向量；记录一旦入库将升级为存储型 XSS |
| 5 | 邀请裂变是本地计数器 | `store.ts:addReferral()` | 自己点 3 次给自己发会员，且不校验被邀请人 |

### P1 — 现在就是坏的

| # | 问题 | 位置 |
|---|---|---|
| 6 | 首页"免费"的灵签实际收费；各模式首页价与实际价差 2–4 倍 | 见 §3 |
| 7 | 价格硬编码在 5 处且互相矛盾 | 各模式页 `price` prop、`member/page.tsx`、`FortuneForm.tsx`、`QuotaBanner.tsx` |
| 8 | `/qrcode.jpg` 不存在，`public/` 目录整个缺失 | 支付弹窗显示裂图 |
| 9 | 登录系统只有逻辑没有界面 | `signIn`/`signUp` 全项目零处调用 |
| 10 | 无 `.env`，三个环境变量全缺 | 部署即失败 |
| 11 | 会员权益宣传"永久保存测算记录"，实际记录只在 localStorage | 宣传与实际不符 |
| 12 | HEAD commit message 声称的功能在文件中不存在 | `4786a8f` |

### P2 — 合规

| # | 问题 |
|---|---|
| 13 | 无用户协议、隐私政策、免责声明 |
| 14 | 姻缘模式收集两人姓名与出生年月日时，属个人信息，无隐私政策即违规 |
| 15 | 无 ICP 备案（已通过海外托管规避，但内容表述仍需规避绝对化承诺） |

## 3. 价格矩阵（统一后）

唯一来源：`src/lib/pricing.ts`。任何页面不得再写死数字。

| 项目 | 价格 | 说明 |
|---|---|---|
| 今日运势 | 免费 | 计入每日免费额度 |
| 灵签求签 | 免费 | 计入每日免费额度 |
| 八字命理 | ¥6.6 / 次 | |
| AI 塔罗 | ¥3.8 / 次 | |
| 姻缘配对 | ¥8.8 / 次 | |
| 会员 · 月卡 | ¥9.9 / 30 天 | |
| 会员 · 年卡 | ¥69 / 365 天 | |

- 免费额度：未登录用户**每日 3 次**，全模式合计
- 会员：全模式无限次
- 会员页原有的"终身卡 ¥188"按统一原则**移除**

当前代码中各模式页实际传入的价格（灵签 5.8 / 八字 18.8 / 塔罗 8.8 / 姻缘 36.9）**全部作废**，以本表为准。

## 4. 架构

```
浏览器 ──→ Vercel 上的 Next.js 14 ──→ Supabase（Auth + Postgres）
                    │
                    └──→ DeepSeek API（key 仅存在于服务端）
```

**核心原则：所有授权与计费判断在服务端完成。前端只负责展示与发起请求。**

## 5. 数据模型

四张表，全部启用 RLS（行级安全）。

### `profiles`
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | 等于 `auth.users.id` |
| `email` | text | |
| `is_member` | boolean | 会员状态，服务端唯一真相 |
| `member_expires_at` | timestamptz | 到期时间 |
| `created_at` | timestamptz | |

### `usage`
| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | text | 限流主体：`dev:<device_id>` 或 `ip:<sha256(ip)>` 或 `global` |
| `day` | date | |
| `count` | int | 当日已用次数 |

主键 `(key, day)`。

同一张表承载三种计数：设备维度、IP 维度、全局维度（`key = 'global'`）。IP 以 SHA-256 存储，不落明文。全局维度即熔断计数器 —— Vercel 的 serverless 函数是无状态的，计数器必须落在数据库里，不能放内存。

### `orders`
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → `profiles.id` | 付费前必须登录 |
| `plan` | text | `bazi` / `tarot` / `love` / `member_month` / `member_year` |
| `amount` | numeric | 下单时从 `pricing.ts` 取值快照 |
| `status` | text | `pending` / `confirmed` / `rejected` |
| `contact` | text | 用户留的联系方式 |
| `created_at` / `confirmed_at` | timestamptz | |

### `readings`
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `mode` / `title` / `icon` | text | |
| `result` | text | |
| `input` | jsonb | |
| `created_at` | timestamptz | |

RLS 策略：用户仅可读写 `user_id = auth.uid()` 的行；`usage` 与 `orders` 的写入只经由服务端 service-role 客户端，客户端不可直接写。

## 6. 关键流程

### 6.1 免费测算（匿名，无需注册）

```
POST /api/fortune
  服务端：
    1. 读取或签发 httpOnly 设备 cookie（UUID）
    2. 校验 mode ∈ 白名单
    3. 校验输入长度上限（单行字段 ≤ 200 字符，文本域 ≤ 500 字符）
    4. 查 usage('dev:<device_id>', today)：count < 3 ？
    5. 查 usage('ip:<sha256(ip)>', today)：count < 6 ？（第二道闸）
    6. 查 usage('global', today)：count < DEEPSEEK_DAILY_BUDGET ？（熔断）
    7. 调用 DeepSeek
    8. 成功后才对三个 key 各 +1
  返回结果
```

**为什么是两个维度**：设备 cookie 用户清得掉，所以需要 IP 作为第二道闸。IP 档位放得比设备档位宽（6 次），因为同一个 IP 后面可能坐着多个人（宿舍、公司、运营商 NAT），卡太死会误伤。

**失败不扣额度**：仅在 AI 调用成功后记账，避免用户承担服务端故障成本。

### 6.2 付费测算

```
用户选套餐 → 必须先登录 → 留联系方式
  → POST /api/orders 写入 orders(status=pending)
  → 展示收款码 → 用户扫码付款
  → 管理员在 Supabase 后台将 status 改为 confirmed
     并相应设置 profiles.is_member / member_expires_at
  → 用户刷新页面，权限生效
```

因为管理后台延后，开通这一步当前是**手动改数据库**。后续做后台时只是把该步搬到网页上，底层数据模型不变。

### 6.3 邀请裂变

当前实现是本地计数器，不可用。**本期直接移除**，涉及三处：

- `store.ts` 中的 `getReferralCode` / `getReferralCount` / `addReferral` / `addReferral` 相关的 member 赠送逻辑
- `FortuneForm.tsx:114` 的"分享给 3 位好友，赠送 1 天会员体验"文案
- `member/page.tsx` 会员权益列表里的"分享好友双方得会员"

待有服务端账号体系后再重新设计。理由：虚假的裂变承诺比没有更伤用户。

## 7. 分阶段实施

### 阶段 1 — 安全底座（可独立上线）

- 新增 `src/lib/pricing.ts`（价格单一来源）
- 新增 `src/lib/validation.ts`（mode 白名单 + 输入长度限制）
- 新增 `src/lib/quota-policy.ts`（额度判定纯函数，零依赖、可完整单测）
- 新增 `src/lib/server/usage-store.ts`（Supabase 三维度原子计数）
- 新增 `src/lib/sanitize.ts`（AI 输出转义）
- 重写 `src/app/api/fortune/route.ts`（限流 + 白名单 + 失败不扣额，并**由该路由自身签发** httpOnly 设备 cookie）
- 修复 `FortuneForm.tsx` 的 `dangerouslySetInnerHTML`（输出转义）
- 全站价格改为读 `pricing.ts`

**此阶段结束后，站点已可安全公开，即使暂不做账号体系。**

### 阶段 2 — 账号体系

- 建立 Supabase 项目，建 4 张表与 RLS
- 新增 `src/app/login/page.tsx`（登录/注册）
- `AuthProvider.tsx` 增加 profile 加载
- `readings` 上云，`HistoryDrawer` 改读服务端（兑现"永久保存"承诺）

### 阶段 3 — 付费与订单

- `orders` 表与下单接口
- `PaymentModal.tsx` 增加联系方式与订单提交
- `member/page.tsx` 改读配置、移除终身卡、改为登录后下单
- `profiles` 会员状态生效逻辑
- 编写"如何手动确认订单"的操作说明

### 阶段 4 — 合规与上线

- 新增三个法律页：隐私政策、用户协议、免责声明
- 建立 `public/`：favicon、应用图标、**收款码图片（需用户提供）**
- 新增 `.env.example` 与部署文档（README）
- 部署至 Vercel，配置环境变量
- 在 DeepSeek 控制台设置消费上限
- 删除根目录的 `xuanji-build.tar.gz`（9.9 MB）
- 运行 `security-review` 复核

## 8. 环境变量

```
DEEPSEEK_API_KEY=              # 服务端专用，严禁加 NEXT_PUBLIC_ 前缀
DEEPSEEK_DAILY_BUDGET=300      # 全局每日调用上限，熔断阈值
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # 服务端专用，权限最高，泄露等于数据库裸奔
```

`DEEPSEEK_DAILY_BUDGET` 默认 300。按 deepseek-chat 的价位，300 次/日即使全部打满也在可控范围内；这个数字表示"最坏情况下一天最多损失多少"，应当按你能承受的额度自行下调。同时**必须在 DeepSeek 控制台另设一道消费上限** —— 代码里的熔断是防滥用的，控制台的上限才是防代码出错的最后一道保险。

## 9. 测试策略

现有测试（`tests/home-experience.test.mjs`）是对源文件做字符串断言，覆盖极弱。本期补充：

- `/api/fortune` 的限流行为：第 4 次请求应被拒绝
- mode 白名单：非法 mode 应返回 400
- 输入长度超限应返回 400
- 全局熔断触发时返回 503 而非崩溃
- AI 调用失败时额度不应被扣除

手动验收：本地跑通完整链路（免费额度耗尽 → 登录 → 下单 → 改库确认 → 会员生效）。

## 10. 验收标准

1. 未登录用户刷新页面不能重置额度；清除 cookie 后设备维度可重置，但 IP 维度（6 次/日）仍然生效
2. 浏览器控制台修改任何 localStorage 值，均不能获得会员权限
3. 未登录状态下无法调用付费模式
4. 全站任意位置显示的价格与 `pricing.ts` 一致
5. 支付弹窗不再显示裂图
6. `DEEPSEEK_API_KEY` 不出现在任何客户端 chunk 中
7. 部署后无 `.env` 泄露至仓库

## 11. 明确不做（YAGNI）

- 管理后台（用户已确认延后）
- 自动支付回调（需微信支付商户资质，个人无法办理）
- 邮件/短信通知
- 测试覆盖率补齐
- Next.js 升级（14.2.35 稳定可用，升级与本次目标无关）
- 邀请裂变重做（先移除，不重建）

## 12. 待用户提供

- **微信收款码图片**（替换缺失的 `/qrcode.jpg`）
- 确认手上已有的是 Supabase 项目还是 DeepSeek API key
- 隐私政策中需载明的联系方式（邮箱）
