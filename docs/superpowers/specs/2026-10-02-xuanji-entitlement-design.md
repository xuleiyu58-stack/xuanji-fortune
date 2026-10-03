# 玄机 — 收费闭环与服务端权威 设计

- 日期：2026-10-02
- 状态：待实现
- 上一份：`2026-09-30-xuanji-production-hardening-design.md`（阶段 1 安全底座，已完成）

## 1. 背景

阶段 1 把「任何人可无限调用 API」和「输入无校验」两个洞堵上了，111 个测试全绿。
但**授权**这条线只做了一半：限流有了，身份没有。后果是三个具体的坏行为：

| # | 问题 | 证据 |
|---|---|---|
| 1 | 付费解锁是假的，点一下就白嫖 | `member/page.tsx:34` 点「已完成支付」→ `setMember(true)` 写 localStorage；`FortuneForm.tsx:95` 的 `hasPaid` 只是个 React state |
| 2 | 真会员被自己的限流拦住 | `route.ts:69` 对所有人一律走免费额度闸门，不认会员身份。付了钱第 4 次照样 429 |
| 3 | 付费模式在服务端可以白嫖 3 次/日 | `route.ts:47` 只校验 mode 合法性，`decideQuota` 不看 mode。直接 POST `{mode:"bazi"}` 就能免费拿八字 |

第 3 条是上一份设计漏掉的：它在 P0 里只写了「API 无限流」，没注意到限流是**不分免费/付费模式**的。
客户端看着要付款，服务端却照给。

合起来是一句话：**不付钱能白嫖，付了钱反而不好用。**

## 2. 目标

让服务端成为收费的唯一权威。

1. 付费解锁改为激活码，删掉全部「点一下就解锁」的本地假状态
2. 服务端认得持码人，会员与单次通行证在 `/api/fortune` 真正生效
3. 免费额度收窄到只覆盖免费模式（daily / oracle），付费模式不再能吃

### 为什么先做这个，而不是先做账号体系

账号体系解决的是**跨设备认人**与**记录永久保存**。但当前的问题比这靠前一层：服务端**根本不认人**。
不管有没有账号，只要服务端不验凭证，白嫖就堵不住。先把「凭证」立起来，账号体系之后是**叠加**
（把码绑到账号上），不是重做。

## 3. 非目标

明确不在本轮，留给后续 spec：

- 登录页、账号体系、`profiles` 表
- `readings` 上云（「测算记录随时回看」当前由 localStorage 承载，首页 `page.tsx:61` 的说明是诚实的）
- `orders` 订单表
- 管理后台
- 三个法律页；`Footer.tsx` 里 `href="#"` 的「联系客服」「免责声明」死链一并留给那一轮

## 4. 解锁方式：激活码

**不用「订单 + 人工确认」的理由**：单次测算最便宜 ¥3.8。让用户付完等管理员打开 Supabase
改一行、再刷新才看到结果 —— 这个体验撑不住。会员卡（¥9.9/月、¥69/年）等得起，单次等不起。
激活码两类通吃，且不需要登录，摩擦最小。

**不用第三方个人支付（虎皮椒 / PayJS）的理由**：它确实能自动回调，但需要注册服务商、
2–3% 手续费、钱先进第三方再提现。这层外部依赖不适合在「先把内部逻辑做对」的阶段引入。
将来要换，只需替换「码从哪来」这一段，第 5 节的凭证机制不变。

**代价**（明确记下）：发码仍由站长手工完成。缓解办法是**一次生成一批**，而不是逐单盯着。

## 5. 架构

```
用户输入码 ──→ POST /api/redeem ──→ 原子核销 ──→ Set-Cookie: xj_pass=<签名载荷>
                                                        │
以后每次测算 ──→ POST /api/fortune ──→ 验签 cookie ──→ 会员？跳过额度闸门
```

**核销之后，`/api/fortune` 判定权益不再查数据库** —— 权益就在签名 cookie 里。
省一次往返，也少一个故障点。

### 5.1 凭证载荷

cookie 的值是「载荷 + HMAC-SHA256 签名」，Base64URL 编码：

```
xj_pass = b64url(JSON载荷) + "." + b64url(HMAC-SHA256(secret, b64url(JSON载荷)))
```

载荷是一份**合并**的结构，而不是单个权益 —— 会员与多张单次通行证可以共存：

```jsonc
{
  "v": 1,
  "member": 1790000000,                                  // 会员到期 unix 秒；非会员为 null
  "passes": [ { "m": "tarot", "n": 1, "e": 1790000000 } ] // 单次通行证；模式 / 剩余次数 / 失效秒
}
```

- **兑换是合并而非覆盖**：已持有一张未用的塔罗单次券时再兑换会员码，券不该被吞掉。
  同模式的券合并时 `n` 相加、`e` 取较晚者
- 签名密钥是新增环境变量 `PASS_SECRET`（服务端专用，≥32 字节随机）
- **没有它，用户自己就能捏一个会员 cookie** —— 这是整个方案的安全根基
- 密钥轮换会使已发出的全部凭证失效，属预期行为（届时重新发码）
- 单次通行证带 `e`，兑换时起算 **7 天**：码是 ¥3.8 买的一次，不该永远躺在浏览器里
- `v` 是载荷版本号。将来改结构时可据此判断，而不是靠猜字段是否存在
- 整份载荷为空（无会员、无券）时清除 cookie，而不是写一个空壳

### 5.2 放行判定顺序

```
decideAccess(mode, counts, limits, entitlement, isFree):

  1. 全局熔断触发？             → 拒绝 503
       ↑ 会员也不例外 —— 这道闸保护的是 API 账单，不是公平性
  2. 凭证有效？
       member                   → 放行，不扣任何额度
       single 且模式匹配且 n>0  → 放行，消耗一次
  3. isFree 且 device 未超且 ip 未超 → 放行，扣额度
  4. 否则
       !isFree                  → 403「该模式需激活后使用」
       isFree                   → 429 额度用尽
```

状态码沿用既有约定（`route-contract.test.mts:46` 钉着的）：额度用尽是 **429**，
服务未就绪是 **503**；只有「付费模式未激活」用 **403** —— 它不是频率问题，是权限问题。

第 3 步的 `isFree` 门把免费额度**收窄到只有 daily 和 oracle**，即第 1 节第 3 条那个洞的修法。

`entitlement` 参数就是 5.1 的载荷（已验签、已剔除过期项），不再是「一个」权益。
`isFree` 由调用方注入（`isFreeMode` 的返回值），保持本模块零 import。

判定结果要能告诉调用方**该怎么改 cookie**，否则路由就得把 5.2 的规则再抄一遍：

```ts
type AccessDecision =
  | { allow: true; consume: "none" | "quota" | { mode: string } }  // 对象形式表示消耗一次单次券
  | { allow: false; status: 403 | 429 | 503; reason: "global" | "paid" | "device" | "ip"; message: string };
```

## 6. 数据模型

只新增一张表。核销靠一条原子的 `UPDATE ... WHERE redeemed_at IS NULL RETURNING`，
天然保证一码只能用一次，并发下也不会双花。

```sql
create table if not exists public.redeem_codes (
  code        text primary key,          -- 16 位 Crockford base32（去 I L O U），80 bit 熵
  kind        text not null,             -- 'member' | 'single'
  mode        text,                      -- kind='single' 时必填
  days        int not null default 0,    -- kind='member' 时的有效天数
  batch       text,                      -- 批次号，便于按批发放与对账
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by text                       -- 兑换时记设备指纹前 8 位，排查纠纷用
);

alter table public.redeem_codes enable row level security;
revoke all on public.redeem_codes from anon, authenticated;

create or replace function public.redeem_code(c text, who text)
returns table (kind text, mode text, days int)
language sql security definer set search_path = public
as $$
  update public.redeem_codes
     set redeemed_at = now(), redeemed_by = who
   where code = c and redeemed_at is null
  returning redeem_codes.kind, redeem_codes.mode, redeem_codes.days;
$$;

revoke all on function public.redeem_code(text, text) from anon, authenticated;
```

存放在 `supabase/redeem.sql`，与既有的 `supabase/schema.sql` 并列（分开是因为
`schema.sql` 已经在线上执行过，再往里面追加会让人不确定该重跑哪一段）。

## 7. 接口

### `POST /api/redeem`

请求 `{ code: string }`。

- 先按 IP 限次（`redeem:<ipHash>`，10 次/日）—— 80 bit 的码本就爆不了，这层防的是脚本噪声。
  计数含成功与失败，只统计成功会让失败路径无限可试
- **设备指纹**：取 `xj_dev` cookie 的前 8 位；该 cookie 不存在时记 `"anon"`。
  用户在 `/fortune` 之外直接兑换时还没有设备 cookie，这是正常路径，不该报错
- 调 `redeemCode(code, deviceFingerprint)`
- 成功 → 把它**合并**进现有 `xj_pass`（见 5.1），重新签发（httpOnly、sameSite=lax、secure 视环境），返回权益摘要
- 失败 → 400 `{ error: "激活码无效或已被使用" }`

**失败信息刻意不区分「不存在」与「已用」** —— 区分了就等于给爆破者一个进度条。

### `GET /api/entitlement`

返回 `EntitlementSummary`，供前端显示会员徽章与「会员免费」标签。无凭证时返回 `{ member: false, passes: [] }`。

```ts
interface EntitlementSummary {
  member: boolean;
  expiresAt?: number;                        // unix 秒
  passes: { mode: string; remaining: number }[];
}
```

### `POST /api/fortune`（改）

在现有流程前插入一步：验 `xj_pass` → 组装 `AccessEntitlement` → 用 `decideAccess` 取代 `decideQuota`
→ 单次凭证被消耗时，响应里重新 `Set-Cookie`（`n` 减一，归零则清除 cookie）。

`isFree` 取自 `isFreeMode(mode)`。

## 8. 代码改动

### 新增

| 文件 | 职责 |
|---|---|
| `src/lib/entitlement.ts` | 签发 / 验签 / 合并 / 消耗。纯函数，只 import `node:crypto`（内置模块，Node 直跑测试可解析），密钥与当前时间由调用方注入 |
| `src/lib/access.ts` | 5.2 那套判定。零 import，`isFree` 注入 |
| `src/lib/server/codes.ts` | 核销与发码的 Supabase 读写；未配置时退化为内存兜底（照抄 `usage-store.ts` 的既有范式，本地可跑通） |
| `src/app/api/redeem/route.ts` | 兑换接口 |
| `src/app/api/entitlement/route.ts` | 权益查询 |
| `scripts/gen-codes.mjs` | 发码脚本。**不做管理后台** —— 一个只用于发码的网页要额外的密钥与暴露面，脚本够了 |

### 修改

| 文件 | 改动 |
|---|---|
| `src/lib/quota-policy.ts` | **删除**，由 `access.ts` 取代。两模块职责重叠会漂移；其 5 条测试迁移进 `access.test.mts` 并扩展 |
| `src/app/api/fortune/route.ts` | 验凭证 + 改用 `decideAccess` |
| `src/lib/server/usage-store.ts` | 增加通用 `readCount(key)` / `bumpCount(key)`，供兑换限次复用 |
| `src/lib/pricing.ts` | 增加 `REDEEM_IP_DAILY_LIMIT = 10`（与既有的两个额度常量并列） |
| `src/components/PaymentModal.tsx` | 「已完成支付」那一步换成激活码输入框；props 由 `onConfirm` 改为 `onRedeemed(summary)` |
| `src/components/FortuneForm.tsx` | 删 `hasPaid`、`member` 本地态；`:103` 分享文案里残留的 `?ref=` 一并删掉（邀请裂变已移除，该参数恒为空） |
| `src/app/member/page.tsx` | 删 `setMember` / `setMemberExpiry` 调用，改走兑换流程 |
| `src/components/Header.tsx` | 会员徽章改读 `GET /api/entitlement` |
| `src/lib/store.ts` | 删 `isMember` / `setMember` / `setMemberExpiry` / `isMemberExpired`；`getFreeQuota` 降级为纯展示估算（真实依据在服务端） |
| `.env.example` / `README.md` | 补 `PASS_SECRET` 与发码说明 |

## 9. 测试

| 文件 | 覆盖 |
|---|---|
| `tests/entitlement.test.mts` | 签发、验签、过期、**篡改载荷必须失败**、换密钥必须失败、签名长度不等时不得抛异常（`timingSafeEqual` 会对不等长直接 throw）、`v` 版本不符时拒绝、**合并时同模式券的次数相加且取较晚的 `e`**、消耗到 0 时该券被移除、全空时返回 null |
| `tests/access.test.mts` | 判定顺序；含「全局熔断对会员同样生效」「付费模式不再吃免费额度」「会员用免费模式不扣额度」「单次凭证模式不匹配不放行」；迁移原 `quota-policy` 的 5 条 |
| `tests/no-fake-unlock.test.mts` | 回归守卫：`src/` 内不得再出现 localStorage 会员状态与 `hasPaid`（照 `no-hardcoded-prices.test.mts` 的读源文件写法） |
| `tests/route-contract.test.mts` | 扩展：路由必须先验凭证再判额度。**注意**：现有第 29 行的 `indexOf("decideQuota(counts")` 会随模块改名而失效，需一并改为 `decideAccess(` |

## 10. 验收标准

1. 控制台执行 `localStorage.setItem('xuanji_member','true')` 后刷新，**不会**变成会员
2. 未持码 POST `{mode:"bazi"}` → 403，不再白送 3 次
3. 兑换有效码 → 200 且写入 `xj_pass`；再请求该模式 → 200
4. 同一个码第二次兑换 → 400
5. 手工篡改 cookie 载荷 → 权益失效
6. 全局熔断触发时，会员请求同样被拒（503）
7. 免费模式额度仍是 3 次/日，第 4 次 429
8. 会员使用免费模式不扣免费额度
9. 单次凭证用一次后 `remaining` 归零，再用 → 403
10. `npm test` 全绿，`npx next build` 成功

## 11. 待用户提供

| 项 | 用途 | 状态 |
|---|---|---|
| 收款码图片 | `public/qrcode.jpg` | ✅ 已提供（2026-10-02，支付宝码 1260×1890）。**注意是支付宝，界面文案不能写微信** |
| 联系方式（微信号或邮箱） | 用户付款后要知道找谁拿码 | ❌ **仍未提供 —— 整条链路断层，硬阻塞** |
| Supabase 项目 | 存码 | ❌ 未提供。本地可走内存兜底，生产必须 |

## 12. 环境变量

```
PASS_SECRET=          # 新增。服务端专用，≥32 字节随机。严禁加 NEXT_PUBLIC_ 前缀
```

生成方式：`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 13. 风险

| 风险 | 缓解 |
|---|---|
| `PASS_SECRET` 泄露 → 任何人可自签会员 | 仅服务端读取；与 `SUPABASE_SERVICE_ROLE_KEY` 同等对待；轮换即全量失效 |
| 站长忘记发码 → 用户付钱拿不到服务 | 发码脚本一次生成一批；README 写清操作步骤 |
| 换设备/清 cookie → 会员「丢失」 | **本轮已知缺陷**，缓解办法是靠码的 `batch` 记录人工补发。根治需要账号体系，即下一轮 |
| 用户丢失激活码 | `redeem_codes` 表保留 `batch` 与 `redeemed_by`，可人工核查后补发 |
