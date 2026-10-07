# 玄机支付流程改造设计（方案 A：零资质）

- 日期：2026-10-07
- 状态：待实现
- 目标仓库：`xuleiyu58-stack/xuanji-fortune`（分支 `main`）
- 关联文档：`docs/superpowers/specs/2026-09-30-xuanji-production-hardening-design.md`

## 1. 背景与目标

现状：付费路径是「静态收款码 → 用户手动输入金额 → 截图发邮件 → 站长人工发码 → 用户回来输码」。

三个具体问题：

1. **金额要手输。** `public/qrcode.jpg` 是一张不带金额的静态收款码，用户可能输错、可能忘输。
2. **交付靠邮件往返。** 用户付完钱手上什么都没有，得主动发邮件；站长只能被动等。
3. **权益入口只有激活码一条路。** 付钱的那台设备不会自动开通。

目标：

- 金额由服务端锁定，用户不再输入
- 手机上点一下能进支付宝 / 微信
- 付完款页面能自动翻成「已到账」，正常情况下不用输激活码

**不在本次目标内**：全自动回调。零资质下不存在任何合法办法让程序知道钱到账了，这是资质问题，不是代码问题。见 §12。

## 2. 约束与已定决策

| 项 | 决定 | 理由 |
|---|---|---|
| 支付方式 | 个人收款码（不变） | 命理类过不了 ICP 备案，也开不了官方支付商户号 |
| 交付确认 | 仍为人工，但降到约 10 秒/单 | 无回调能力，绕不过 |
| 自动到账 | 做，靠设备匹配 | 付钱的设备自动开通，不依赖回调 |
| 激活码 | 保留，退为跨设备兜底 | 现有原子核销机制原样复用，零改动 |
| 尾数对账 | **本次不做** | 见下 |
| 管理后台页 | **本次不做** | 见下 |
| 聚合支付 | 本次不做，但留接缝 | 见 §6 |

### 为什么不做尾数对账

原设想是用金额尾数（¥6.60 / 6.61 / 6.62…）区分并发订单。问题在于：**每个尾数都要一张单独的收款码**。3 个价位 × 2 个渠道 × N 个尾数，手动生成的图片数量会失控。

改用「用户可选提交交易单号」消歧：从账单复制一串号，比手输金额轻松，且顺带留下纠纷凭证。等真的出现两笔款在同一分钟到账，再加尾数——`orders.amount` 本来就是真实数字，加尾数不需要改表。

### 为什么不做管理后台页

README「已刻意不做的事」已经定过：只用于发码的网页要额外的密钥与暴露面，脚本够了。把"发码"换成"确认"并没有让这个理由更成立。

**已知代价**：确认必须站在电脑前跑脚本。若白天上课时段单量集中，用户要等数小时，体验改善有限。缓解手段是先开收款语音提醒；真到丢单亏钱时再建页面，或直接上聚合支付。

## 3. 架构

```
PaymentModal ──POST /api/order──────────→ 建单（金额服务端算，不信客户端）
     │                                         ↓
     │                                   orders(status=pending)
     │  ← { orderId, amount, instruction }
     │
     ├─ 用户扫码 / 长按识别支付
     │
     ├─ 轮询 GET /api/order/status?id=…  ← 站长跑 scripts/confirm-order.mjs 确认
     │        └→ 设备匹配 → 原子抢占交付权 → 响应里签发权益 cookie → 翻「已到账」
     │
     └─ 【兜底】POST /api/order/code ← 换设备了，取一个激活码
```

**两个核心决定：**

**① 权益仍在轮询的响应里签发。** 权益的唯一载体是 HMAC cookie，服务端只能在响应里写它。所以"自动到账"不是新机制，只是轮询命中 `paid` 时顺手调用 `withPassCookie()`。复用的全是现成函数（`sign()` / `withPassCookie()` / `refreshEntitlement()`），没有新的权益机制。

**② 激活码退为兜底。** 只在"手机付款、电脑访问"这类跨设备场景才需要。`redeem_codes` 表、`redeem_code()` 原子核销、设备镜像全部**原样保留**。

## 4. 数据模型

### 4.1 `orders` 表（新增 `supabase/orders.sql`）

```sql
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  plan            text not null,                    -- bazi | member_month | member_year
  amount          numeric(10,2) not null,           -- 服务端按 pricing.ts 快照
  status          text not null default 'pending',  -- pending | paid | expired
  provider        text,                             -- 用户声称的渠道 alipay | wechat
  payer_ref       text,                             -- 用户提交的交易单号
  device_id       uuid,                             -- 下单设备，自动到账靠它
  granted         jsonb,                            -- 交付时的权益快照，见 §8
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
```

RLS 开启 + `revoke`，与 `redeem_codes`（`supabase/redeem.sql:17-18`）同一模式。

### 4.2 状态机

```
pending ──confirm_order()────────→ paid
   └────expire_stale_orders()───→ expired
```

全部转换是单条 `UPDATE ... WHERE status = ...`，靠数据库原子性，不靠应用层判断。

两条必须的约束：

- **`expired` 仍可被确认。** `confirm_order()` 接受 `status in ('pending','expired')`。真实坏情况：用户 14:00 下单、页面开着、14:35 才付款——单已过期但钱真付了。允许确认"复活"过期单，才不会丢单。
- **`paid` 不可逆**（`unconfirm_order` 除外，见 §9）。

### 4.3 SQL 函数

全部 `security definer`，照 `redeem.sql` 的写法收口。**并且必须在 `supabase/security.sql` 里补 `revoke ... from public`** —— `redeem.sql:35` 的注释「这一行不够」指的就是这个坑，新函数要一并补上。

| 函数 | 语义 |
|---|---|
| `create_order(p_plan, p_amount, p_device, p_ttl_minutes) returns orders` | 先清过期，再落库 |
| `confirm_order(p_id, p_by, p_provider) returns orders` | `pending\|expired → paid`；0 行表示已确认过或不存在 |
| `expire_stale_orders() returns int` | `pending → expired`，条件 `expires_at < now()` |
| `claim_order_delivery(p_id, p_device) returns orders` | 原子抢占交付权，见 §8② |
| `mark_code_issued(p_id, p_device) returns orders` | 发码的幂等闸 |
| `unconfirm_order(p_id) returns orders` | `paid → pending`，仅在未交付时允许，见 §9 |

**金额不在 SQL 里计算。** 价格单一来源是 `pricing.ts`，SQL 只负责落库。在 SQL 里再算一遍就是第二份真相。

### 4.4 订单时长

**30 分钟**。过期后前端提示「订单已超时，重新下单」（重新下单生成新单，金额不变）。

## 5. `pricing.ts` 的单表化重构

现状价格分在两处：`MODES`（`pricing.ts:77`）和 `MEMBER_PLANS`（`pricing.ts:88`）。订单需要"plan → 价格 + 权益"的单一映射。

```ts
export type PlanId = "bazi" | "member_month" | "member_year";

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  kind: "single" | "member";
  /// kind === "single" 时必有
  mode?: Mode;
  /// kind === "member" 时为有效天数；single 用 SINGLE_PASS_DAYS
  days: number;
}

export function isPlanId(v: string): v is PlanId;
```

内容（取自现有 `pricing.ts`，不得改动数值）：

| plan | name | price | kind | mode | days |
|---|---|---|---|---|---|
| `bazi` | 八字命理 | 6.6 | single | `bazi` | `SINGLE_PASS_DAYS`（7） |
| `member_month` | 月卡 | 9.9 | member | — | 30 |
| `member_year` | 年卡 | 69 | member | — | 365 |

**必须是 `MODES` 与 `MEMBER_PLANS` 从 `PLANS` 派生，不能三者并存。** 并存就是第三份真相，正是 `pricing.ts` 注释一直在防的错误，也是 `tests/no-hardcoded-prices.test.mts` 想守的东西。

## 6. 支付接缝

### 6.1 先抽出 `mintCode()`

`codes.ts` 只有**核销**；**生成**逻辑在 `scripts/gen-codes.mjs:26` 的 `makeCode()`，而 `ALPHABET` 在 `src/lib/server/codes.ts:23` 和 `scripts/gen-codes.mjs:13` **各写了一遍**。

`/api/order/code` 要发码。就地再写一遍生成逻辑就是第三份。所以先做：

- 把 `mintCode()` 收进 `src/lib/server/codes.ts`
- `ALPHABET` 收成一处
- `scripts/gen-codes.mjs` 改为调用它

### 6.2 `src/lib/pay.ts`

```ts
export interface PayChannel {
  id: "alipay" | "wechat";
  label: string;
  qrSrc: string;
}

export type PayInstruction =
  | { kind: "qr";       amount: number; channels: PayChannel[] }
  | { kind: "redirect"; amount: number; url: string };

export function payInstructionFor(planId: PlanId): PayInstruction;
```

方案 A 的实现就是查表拼 `/pay/alipay-6.60.png` 这类路径。弹窗按 `kind` 分支渲染，今天只会走 `qr` 那一支。

**这是整个设计里唯一一处为将来留的口子。** 留着它的理由：接聚合支付时，改的是 `pay.ts` 一个文件加弹窗里一个 `case`；订单表、状态机、路由、权益签发全都不用动。不留的话那时得把订单流程再拆一遍。

### 6.3 收款码资源

**当前只做微信，且只用一张通用收款码**（2026-10-07 用户决定）。

```
public/pay/wechat.png
```

**不按金额分张。** 用户反馈微信收款码设不了固定金额，所以退回到通用码；金额改用页面承载 —— 大字展示 `¥6.60` 并写明「请输入 ¥6.60」，同时订单里记着确切金额。

`PayChannel.id` 的类型仍保留 `"alipay" | "wechat"` 两个取值，但渠道清单里当前只列微信。之所以不把类型收窄成只有 `"wechat"`：渠道集合已经被改过一次（设计时两个、实现时一个），说明它易变；用数组承载它，将来加回支付宝只是往列表里补一行，不动类型也不动 UI。

**这个决定消掉了一个真实风险**：原方案要求「图片上写死的金额」与 `PLANS` 一致，而图片上的金额是物理的、改不了 —— 站长报 6.9、代码是 6.6 时，会出现「页面标 6.6、扫码付出 6.9」。现在价格完全由代码决定，改价是一行代码，不需要重做任何图片。

**代价（必须承认）**：「金额固定」是由页面提示承载的，不是二维码本身承载的。所以：
- 用户仍可能输错金额 → 确认到账时必须核一眼金额
- 上一版代码里「金额请手动输入」那行提示要保留（`PaymentModal.tsx:153-155`），不能因为改了支付方式就删掉

**图片仍需处理**：微信导出的是竖版海报（绿底 + 大标题 + 底部 logo），需裁成只含二维码的方图。理由是实测过的 —— 同一个坑在支付宝那张上踩过并已修，见 `src/components/PaymentModal.tsx:134-145`：海报缩到 208px 宽后二维码实际只有约 180px，「拿手机对着电脑屏幕扫很勉强」。裁方图顺带去掉收款人显示名。

图片缺失时弹窗显示「暂未就绪」，复用 `PaymentModal.tsx:124` 现成的 `onError` 降级。

**手机端的支付方式是「长按图片 → 识别图中二维码」**，桌面端是扫一扫。这是零资质下的标准做法，不需要 scheme URL 或运行时生成二维码。

## 7. 路由契约

| 路由 | 方法 | 关键约束 |
|---|---|---|
| `/api/order` | POST | **只收 `plan`，不收金额**；金额从 `PLANS` 取；按 IP 限次 |
| `/api/order/status` | GET `?id=` | 设备不匹配**一律 404**；`claim_order_delivery` 抢占成功才签发 |
| `/api/order/claim` | POST | 只写 `payer_ref` / `provider`，**不改变状态** |
| `/api/order/code` | POST | `mark_code_issued` 抢占；码写进 `redeem_codes`，`batch = order.id` |

说明：

- **建单必须限次。** 否则任何人可无限建 `pending` 单，炸掉对账列表。复用 `usage-store` 的 `hashIp` / `readCount` / `bumpCount`，key 形如 `order:<ipHash>`，与 `pricing.ts:16` 的 `REDEEM_IP_DAILY_LIMIT` 同构。
- **`/api/order/status` 是唯一发放权益的地方。** 收尾逻辑与 `/api/redeem:118-153` 完全一致：`readEntitlement(req)` → 按 plan 分支 `grantMember` / `grantPass` → `withPassCookie()`。差别只是"凭什么给"：那边凭原子核销的激活码，这边凭原子抢占的交付权。
- **`claim` 的文案必须诚实。** 写成「已提交，稍后开通」会让用户以为付完就完事了。应为「提交后不会自动开通，我们核对到账后为你开通」。

## 8. 三个必须钉死的坑

### ① 响应丢失会让人财两空

服务端抢占了 `delivered_at`、签好了 cookie，但响应在网络上丢了——用户手里什么都没有；再轮询时订单已标记交付，服务端不会再发。**他付了钱，永远拿不到东西。**

修法：订单上存交付时的权益快照 `orders.granted jsonb`。首次交付时写入；之后每次轮询，**只在请求完全不带权益 cookie 时**用这份快照重签一次。

带了 cookie 就什么都不做——否则会把用户已经用掉的券复活，那正是 `entitlement.ts` 里 `withTid()` 注释反复警告的那类错误。

### ② 并发双击不能发两份

用户开两个标签页，两个请求同时读到 `delivered_at is null`，就各签一份权益。

靠 `claim_order_delivery()` 的 `UPDATE ... WHERE delivered_at IS NULL RETURNING` 抢占：只有拿到行的那个请求有签发权。与 `redeem_code()`（`redeem.sql:20-32`）同一个套路，也符合 `entitlement.ts` 的原则——**权益在哪一刻变了，就在哪一刻由数据库定下来。**

### ③ 别人的订单不能领

`/api/order/status` 必须校验 `device_id` 匹配，不匹配返回 **404 而非 403**。403 等于告诉对方"这个 id 存在，只是不是你的"，那就成了订单 id 探测器。

## 9. 运营：确认与对账脚本

`scripts/confirm-order.mjs`。**输出比参数重要**，因为这是每天真正要用的东西。

```bash
# 不带参数：看最近 2 小时需要处理的
$ node --env-file=.env.local scripts/confirm-order.mjs

最近 2 小时
  14:31  ¥6.60   八字单次   支付宝  2026100722001...  pending    8f3a1c2d
  14:28  ¥69.00  年卡       —      —                 pending    4b7e9a01
  13:50  ¥9.90   月卡       微信   —                 paid ✓     c1d0f5a8

⚠ 1 笔已付款但未领取——用户付了钱没拿到东西，建议主动发码
  c1d0f5a8  ¥9.90  月卡

# 确认到账（id 支持前缀）
$ node --env-file=.env.local scripts/confirm-order.mjs --id 8f3a

# 确认错了（仅在未交付时允许）
$ node --env-file=.env.local scripts/confirm-order.mjs --undo 8f3a
```

设计要点：

- **id 支持前缀**，打 4 位即可，不要求复制整串 UUID
- 列表按「金额 + 时间」排布，因为你看到的是支付宝推送里的金额，要能一眼扫到对应行
- **「已付款但未领取」是主动告警，不是统计。** 它的含义是：有人付了钱，既没自动领到、也没来取码。这类人很可能以为没成功就走了，是差评与退款的来源
- **`unconfirm_order()` 只在 `delivered_at` 与 `code_issued_at` 都为空时允许**。一旦权益发出就不许回头，避免"撤销了但权益还在"这种更难查的状态

## 10. 错误处理

| 情况 | 行为 |
|---|---|
| Supabase 未配置 | 503 拒绝服务，沿用 `runtime.ts` 的 `allowMemoryFallback` 语义 |
| 收款码图片缺失 | 弹窗显示「暂未就绪」，不裂图 |
| 轮询失败 | 静默退化为「稍后刷新」，不弹错误弹窗 |
| 订单过期 | 提示「订单已超时，重新下单」 |
| 订单不存在 / 不属于本设备 | 404 |
| 权益签发失败 | 订单仍为 `paid`，`granted` 快照保证下次轮询还能领（见 §8①） |

## 11. 测试策略

沿用 `node --test` + `tests/mock-supabase.mjs` 的现成套路。

新增 `tests/pay.test.mts`：

- **金额快照**：请求体里塞 `amount: 0.01` 一律被忽略，落库金额等于 `PLANS[plan].price`
- **未付款不出权益**：`pending` 订单轮询只返回状态
- **幂等**：同一订单连续轮询十次，权益只增加一次
- **响应丢失可恢复**：`delivered_at` 已设但请求不带 cookie 时，重签同一份快照；带 cookie 时不重签
- **越权**：换一个 device cookie 查别人的订单，404
- **过期可复活**：`expired` 订单能被 `confirm_order` 确认
- **不可撤销**：已交付的订单 `unconfirm` 应被拒绝
- **过期单不占额度**：`expire_stale_orders()` 后再建单应能复用同一 `plan`

新增 `tests/order-contract.test.mts`：四个路由的输入校验、状态码、错误文案契约。

**回归**：`/api/redeem` 的激活码路径完全不变，`tests/paid-loop.test.mts` 与 `tests/no-fake-unlock.test.mts` 必须继续通过。

## 12. 明确不做（YAGNI）

- **聚合支付接入**（虎皮椒 / PayJS）：需要资质与审核；PayJS 一次性开户费 300 元、费率约 `0.6% + 1.78%`，且支付宝通道需达量才开通，冷启动阶段等于只有微信。留接缝不实现
- **官方支付商户号**：需营业执照，命理类目大概率被拒
- **尾数对账**：见 §2
- **管理后台页**：见 §2
- **自动回调**：零资质下不可能，见 §1
- **退款流程**：仍走 `CONTACT_EMAIL`（`src/lib/contact.ts`），用户协议 `terms` 已有原则性条款
- **发票**：无资质，不做

## 13. 已知取舍

**自动到账 + 激活码会重复发一次权益。** 用户若先享受自动到账，又点「获取激活码」把码给了朋友，结果是一次付款换两份权益。

堵它需要在 `/api/order/code` 里拒绝已交付的订单，但那会同时堵死"电脑上已自动到账、现在想给手机也开一个"这种合理需求——而那种需求的正确做法本来就是用码。

判断：该漏需用户刻意操作才触发，单次上限 ¥69，不值得为它牺牲可用性。**记录在案，等真出现异常再收紧。**

## 14. 实施顺序

每步结束时站点都应是可用的，不留半截状态。

1. **单表化 `pricing.ts`** —— `PLANS` 落地，`MODES` / `MEMBER_PLANS` 改为派生。纯重构，全站行为不变，现有测试应全绿
2. **抽出 `mintCode()`** —— 收 `ALPHABET`，`scripts/gen-codes.mjs` 改调它。纯重构
3. **`supabase/orders.sql` + `security.sql` 收口** —— 建表、六个函数、revoke。跑 `scripts/check-supabase.mjs` 应认出新表新函数
4. **`src/lib/pay.ts` + `public/pay/`** —— 接缝与六张收款码
5. **四个路由 + `order-store.ts`** —— 含 §8 的三个坑
6. **`PaymentModal.tsx` 改造** —— 固定金额、双渠道、轮询、获取激活码
7. **`scripts/confirm-order.mjs`**
8. **测试** —— `pay.test.mts`、`order-contract.test.mts`，并跑通回归
9. **README 更新** —— 部署章节补 `orders.sql`，上线检查清单补收款码路径

第 3 步与第 5 步之间不能中途上线：表建了但路由没上，`PaymentModal` 仍走老流程，是安全的；反过来不行。

## 15. 待用户提供

- **3 张微信收款码图片**，放 `public/pay/`：`wechat-6.60.png`、`wechat-9.90.png`、`wechat-69.00.png`
- ⚠️ **裁决八字单次的真实价格。** 用户报的是 6.9，代码里（`PLANS.bazi.price`）是 6.6，两处对不上。
  必须二者取一 —— 因为收款码图片上写死的金额是物理的，改不了：
  - 若为 6.9：改 `PLANS.bazi.price`，同步改 `tests/pricing.test.mts` 里那条断言，图片按 6.9 用
  - 若为 6.6：图片需要重做一张
  上线前必须确认「图片上的金额」与「`PLANS` 的金额」逐一对得上，否则用户扫出来付的钱与页面标的价不符
- 确认现有 `public/qrcode.jpg` 是否可删除，或保留作历史兼容
