# 玄机 · AI 命理解读

Next.js 14 + TypeScript + Tailwind。全站只做**子平八字**一个产品：程序排盘，AI 解读。

## 核心设计原则

**能算的归代码，能解的归模型。**

四柱、藏干、十神、神煞、五行分布、大运 —— 这些是确定性推算，全部由 `lunar-typescript` 算出；
模型只负责解读**已经排好的盘**。

这不是洁癖。让模型"心算"排盘，日柱基本必错；而错了看不出来，卦名照样像真的。
收费产品经不起这种错误。

第二条原则：**解锁权只在服务端。**

权益是一张 HMAC 签名的 cookie（`xj_pass`），由 `/api/redeem` 核销激活码后签发。
前端读到的会员状态只是**显示用的缓存**，改它不会让你变成会员 ——
放行判定发生在 `/api/fortune` 与 `/api/ask`，验签之后才决定。

## 目录

```
src/app/            页面与接口
  page.tsx          首页（即排盘工具）
  member/           会员与兑换
  terms/ privacy/ disclaimer/   法律页
  api/fortune       首次解读（收钱的那一步）
  api/ask           追问（与首次解读共用同一道闸门）
  api/redeem        激活码核销 → 签发凭证
  api/entitlement   查询当前权益
src/lib/
  bazi/             排盘算法（可单测，拆成多个叶子模块）
  access.ts         放行判定（纯函数，零 import）
  entitlement.ts    凭证签发/验签/合并/消耗（纯函数，只依赖 node:crypto）
  server/           Supabase 读写、限流、凭证 cookie
  pricing.ts        全站价格与额度的唯一出处
  disclaimer.ts     免责声明（服务端与客户端共用）
src/components/     界面组件
supabase/           建表 SQL
scripts/gen-codes.mjs  批量发码
```

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入真实值
npm run dev
```

打开 http://localhost:3000

未配 Supabase 时也能跑：限流退化为进程内内存计数并打印警告，
激活码从 `DEV_REDEEM_CODES` 播种。**仅供本地开发**，生产环境会直接拒绝服务（503）。

本地想试完整流程：

```
# .env.local
PASS_SECRET=<32 字节随机，生成方式见 .env.example>
DEV_REDEEM_CODES=XMEMBERDEV30AAA1:member::30,XBAZPASS0000001A:single:bazi:1
```

码必须是 **16 位 Crockford base32**（去掉了 I L O U，因为容易被看错）。
位数不对会在格式校验那一步就被拒。

## 环境变量

见 `.env.example`。**最小上线只需要 4 个**：

| 变量 | 作用 | 必填 | 服务端专用 |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | 解读模型 | ✅ | ✅ |
| `DEEPSEEK_DAILY_BUDGET` | 全局每日调用熔断，默认 300 | 建议 | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | 限流计数与激活码存储 | ✅ | — |
| `SUPABASE_SERVICE_ROLE_KEY` | 最高权限，泄露等于数据库裸奔 | ✅ | ✅ |
| `PASS_SECRET` | 凭证签名密钥，泄露 = 任何人可自签会员 | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器端登录会话（**公开值**） | 仅账号功能 | — |
| `NEXT_PUBLIC_SITE_URL` | 自定义域名，用于 canonical 与 sitemap | 建议 | — |
| `DEV_REDEEM_CODES` | 本地自测用的内存兜底激活码 | 仅开发 | — |

判断某个变量该不该进浏览器包，看前缀就够了：`NEXT_PUBLIC_` 是给浏览器的，
**其余一律不许**。当前只有 URL、anon key、站点地址这三个带前缀。

`PASS_SECRET` 轮换会使**已发出的全部凭证失效**（届时重新发码）。
生成：`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 数据库初始化

在 Supabase 控制台的 SQL Editor 里**按顺序**执行。前三个是收费闭环的必需项，
第四个是账号功能（可选）：

| 顺序 | 文件 | 建什么 | 必需 |
|---|---|---|---|
| 1 | `supabase/schema.sql` | `usage` 表 + `bump_usage` 函数（限流计数） | ✅ |
| 2 | `supabase/redeem.sql` | `redeem_codes` 表 + `redeem_code` 函数（激活码核销） | ✅ |
| 3 | `supabase/ledger.sql` | `pass_consumptions` 表（单次券防重放） | ✅ |
| 4 | `supabase/accounts.sql` | 账号与记录上云的四张表 + 三个函数 | 可选 |

**第 3 个容易漏，漏了会出真故障。** 它原先在 `accounts.sql` 里 —— 那是个
分层错误：单次券的防重放跟账号体系毫无关系。只做最小上线的人不跑
`accounts.sql`，于是点击付费解读时找不到消费台账，服务端按"宁可拒绝也不放行"
处理，**付了钱的用户直接 503 排不了盘**。已拆成独立文件。

四个文件都写了 `if not exists`，重复执行是安全的。

配完先跑一次体检，别直接启动应用：

```bash
# 注意：如果你在国内且开着代理，见下节「本地开发要挂代理」
node --env-file=.env.local scripts/check-supabase.mjs
```

## 本地开发要挂代理（国内网络）

**Node 不读系统代理，浏览器读。** 所以会出现这种自相矛盾的现象：

- 浏览器能打开 Supabase 控制台
- 但 `npm run dev` 之后，任何读写数据库的接口都报 `fetch failed`

原因：浏览器自动走你的翻墙软件，Node 直连——而直连访问
`*.supabase.co` 在国内大概率不通。

先查你的代理端口（下面假设是 `7890`）：

```powershell
Get-NetTCPConnection -LocalPort 7890 -State Listen
```

然后带着代理变量启动：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:NODE_OPTIONS="--use-env-proxy"
npm run dev
```

`--use-env-proxy` 是 Node 24 的开关，让它读那两个环境变量；
少了它，设了变量也没用（内置 fetch 默认忽略它们）。

验证是否通：`curl -x http://127.0.0.1:7890 https://你的项目.supabase.co/rest/v1/` —— 返回
JSON 错误（比如缺 API key）说明通；返回 `000` 或超时说明不通。

> **这个配置只用于本地。** Vercel 的服务器在国外，直连 Supabase 没问题，
> **不要**把代理变量加到 Vercel 的环境变量里 —— 那会让线上请求绕道你本机，
> 而线上根本连不到你本机。

## 账号体系（可选）

### 是否要开

开了能得到两件事：

- **权益跟着人走**：清了浏览器数据、换了设备，重新登录就恢复，不再需要人工补发
- **记录上云**：换设备能看到历史解读

不开也不影响收费闭环 —— 权益存在本机签名凭证里，照常能用。
代价是清 cookie 就丢，得靠 `redeem_codes.batch` 人工核查后补发。

### 从零开始的完整步骤

**第 0 步 · 建项目**

[supabase.com](https://supabase.com) → New project。区域选东京或新加坡（离国内近，
数据库往返更短）。建完等它初始化完成（约两分钟）。

**第 1 步 · 取三个密钥**

Project Settings → API：

| 界面上的名字 | 填进哪个变量 |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

⚠️ `service_role` 那把钥匙权限最高，**绝不能**加 `NEXT_PUBLIC_` 前缀、
也绝不能提交进仓库。它泄露等于数据库裸奔。

⚠️ 新版控制台可能把 API 页叫 "API Keys"，`anon` 也可能标为 "publishable key" ——
认的是**权限级别**：`anon`/public 可以进浏览器，`service_role`/secret 只能服务端用。

**第 2 步 · 建表**

SQL Editor → New query，依次执行三个文件（每个都写过 `if not exists`，重复执行安全）：

1. `supabase/schema.sql` —— `usage` 表与 `bump_usage`
2. `supabase/redeem.sql` —— `redeem_codes` 表与 `redeem_code`
3. `supabase/accounts.sql` —— 账号相关的四张表与三个函数

**只做激活码不做账号的话，第 3 个可以跳过。**

**第 3 步 · 打开邮箱登录**

Authentication → Providers → **Email** → 启用。
确认 **Confirm email** 的取值符合预期（邮箱验证码流程下通常保持开启）。

**第 4 步 · 改邮件模板（最容易漏的一步）**

Authentication → Email Templates → **Magic Link**，把正文里的
`{{ .ConfirmationURL }}` 换成 `{{ .Token }}`：

```html
<h2>玄机 · 登录验证码</h2>
<p>你的验证码是：<strong>{{ .Token }}</strong></p>
<p>10 分钟内有效。若非本人操作，请忽略此邮件。</p>
```

**不改这一步，用户在站内看不到那 6 位验证码，登录会卡死在第二步。**
默认模板只发一个可点击的链接，而本站是让用户回来手输验证码的。

**第 5 步 · 配发信渠道**

- **自测阶段**：Supabase 内置邮件够用，但它**每小时只允许几封**，
  且只能发给项目成员邮箱 —— 拿别的邮箱测会一直收不到
- **上线必须配自定义 SMTP**：Authentication → Emails → SMTP Settings，
  填一个第三方发信服务（Resend / SendGrid / 阿里云邮件推送等）。
  不配的话真实用户收不到验证码，账号功能等于没开

**第 6 步 · 填环境变量并重启**

把第 1 步取到的三个值写进 `.env.local`（本地）与 Vercel 环境变量（线上），
然后**重启开发服务器** —— `NEXT_PUBLIC_*` 是构建期注入的，热更新读不到新值。

**第 7 步 · 验证**

访问 `/login`：

- 页头出现「登录」入口 → 说明账号服务已被识别为可用
- 没出现 → 三个变量之一没配好，或没重启
- 输入邮箱收到 6 位码并成功登录 → 整条链路通了
- 若已在未登录状态兑换过激活码，登录后应看到
  「本机的会员权益已同步到账户」——那说明认领流程也通了

### 权益是怎么从本机搬到账户的

这一段是整个设计里最绕的地方，值得说清楚：

```
未登录时兑换激活码
  → /api/redeem 把权益同时写进两处：
      · xj_pass（签名 cookie，httpOnly）—— 热路径只验签，不查库
      · device_entitlements（数据库）—— 迁移用的中转站
  → 之后登录
  → 前端调 /api/account/link 拿一张 10 分钟、一次性的认领码
      （后端凭 xj_dev 设备 cookie 认人，前端碰不到 xj_pass）
  → 前端把认领码交给 /api/account/claim
  → 后端在一个数据库事务里把设备权益**搬**进账户，并删除设备那一行
  → 清掉本机 xj_pass：权益已归账户，本机不再留一份
  → 之后请求由 ensurePassCookie 自动从账户补签凭证，用户无感
```

两个关键点：

- **必须是「搬」而不是「抄」。** 抄一份的话，用户在同一台设备重新兑换一次，
  就能把同一份权益再认领到另一个账户 —— 那是权益复制漏洞。
  所以 `claim_device_entitlement` 先 `delete ... returning` 再合并。
- **热路径仍然不查库。** 每次解读都插一次数据库往返，是最容易在加功能时
  被悄悄引入的性能退化。所以只有「cookie 缺失」时才回退去查账户。

### 单次券为什么需要一张服务端台账

权益是一张**自包含的签名 cookie**，客户端手里那份是它自己的副本。
如果"这张券已经用过了"只体现在服务端回写的新 cookie 里，那么任何保留旧 cookie
的人 —— 抄走凭证的、不执行 cookie 清除的客户端、手工重放请求的 ——
都能把同一张券无限次用下去。签名能防伪造，防不住重放。

所以消费落在 `pass_consumptions` 表里，键是 `tid:下标`：

- `tid` 是凭证每次签发时的唯一编号（见 `lib/entitlement.ts` 的 `newTokenId`）
- 下标是这张凭证里的第几张券（`decideAccess` 返回 `passIndex`）

判定顺序上，消费在**调用模型之前**原子地认领（`insert`，主键冲突即"已消费"）——
放行后再记就等于让并发请求白嫖同一张券。解读失败时再把它退还，
用户不该为一次服务端故障丢一张券。

记账失败时**拒绝放行**（503）而不是放行：放行等于让这张券变成无限次。

### 合并规则有三份实现

会员续期与单次券合并的规则出现在三处，必须逐字一致：

| 位置 | 用途 |
|---|---|
| `lib/entitlement.ts` 的 `grantMember` / `grantPass` | 签发与消耗 |
| `lib/entitlement-merge.ts` | 内存兜底与账户合并 |
| `supabase/accounts.sql` 的 `merge_entitlement` / `claim_device_entitlement` | 线上 |

不一致的表现是「本地跑通、线上算错」，而且不报错 —— 只会让某个用户的
会员少几天。`tests/entitlement-merge.test.mts` 专门钉这件事。

## 发码

```bash
node --env-file=.env.local scripts/gen-codes.mjs --kind member --days 30 --count 20 --batch 2026-10
node --env-file=.env.local scripts/gen-codes.mjs --kind single --mode bazi --count 50 --batch 2026-10
```

一次生成一批，别逐单盯着。用户付款后把其中一个发给他，站内输入即解锁。**一码一用。**

## 测试

```bash
npm test          # node --test，直接跑 TypeScript（Node 22+ 原生类型擦除）
npx tsc --noEmit
```

测试里有若干**外部可交叉验证的锚点**，改算法前先看它们：

| 锚点 | 位置 |
|---|---|
| 2005-02-09 = 乙酉年正月初一 / 甲子日 / 属鸡 | `tests/bazi.test.mts` |
| 2005-07-18 = 癸卯日（距锚点 159 日） | `tests/bazi.test.mts` |
| 均时差：2 月中旬约 −14 分，11 月初约 +16 分 | `tests/bazi-solar-time.test.mts` |

几组**回归守卫**，它们防的是具体踩过的坑：

| 守卫 | 防什么 |
|---|---|
| `no-hardcoded-prices` | 价格只能来自 `pricing.ts` |
| `no-fake-unlock` | 解锁权不许回到 localStorage；凭证必须 httpOnly |
| `account-contract` | 热路径不查库；权益「搬」不是「抄」；认领码一次性；单次券重放被台账拦住 |
| `entitlement-merge` | 三份合并实现必须一致（不一致 = 某个用户会员少几天） |
| `bazi-birthplace` | 出生地只认区划表里的规范名（防提示词注入） |
| `legal-pages` | 法律页真实存在、页脚无死链、联系方式同源、`.env.example` 不漏变量 |
| `route-contract` | 先判额度再调 AI；记账在成功之后 |
| `home-experience` | 客户端组件不得值导入服务端重模块 |

`home-experience` 里那条依赖扫描值得说明：`lunar-typescript` 有 1.33MB，
区划表 61KB，它们都只该在服务端。`import type` 会被完全擦除，所以不算违规。

### 账号体系的端到端验证（对着本地桩跑）

`npm test` 跑的是纯函数与契约断言；账号体系的**完整链路**另有一套脚本，
用一个本地 Supabase 桩跑真实 HTTP：

```bash
# 终端 A：启动桩（内存实现 PostgREST / Auth 的那部分 + SQL 函数语义）
node tests/mock-supabase.mjs 54321

# 终端 B：用指向桩的环境变量启动 dev server
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon
#   SUPABASE_SERVICE_ROLE_KEY=test-service-role
npm run dev -- -p 3121

# 终端 C：跑端到端
APP_URL=http://localhost:3121 node tests/account-e2e.mjs
```

它覆盖 36 项接口断言：权益双写、认领是「搬」不是「抄」、重复认领被拒、
清了 cookie 能凭账户补签、**补签凭证的重放被台账拦住**、记录上云与
按 user_id 删除、鉴权边界、会员与单次券合并。

**界面链路**用真实浏览器验（`agentbrowse` 或任意 Playwright 环境），
对着上面同一套桩：

```bash
WEBCLI_ALLOW_LOCAL=1 npx agentbrowse open http://localhost:3121/login
```

桩实现了 `/auth/v1/verify`（真实 verifyOtp 打的端点），所以能在浏览器里
**走完整套登录表单**：填邮箱 → 收码（码会打印在桩的控制台）→ 输入 → 登录。
已验证：账号配置好后登录页渲染邮箱输入框、发码成功、登录后页头从「登录」
变成「账号」、登录页显示邮箱与权益、退出登录后回退。

> 桩必须发 CORS 头。浏览器在 `localhost:3xxx`、桩在 `127.0.0.1:54321`，
> 跨源；少了 CORS 预检，浏览器端的 `verifyOtp` 请求根本到不了桩，
> 表现是"验证码不正确"这种看不出真因的错误。踩过一次。

**它不能替代真机联调。** 桩验的是我们自己的接线与语义，
`supabase/*.sql` 的语法、RLS 策略、真实 Auth 发信流程都必须在真项目上验一遍。

### 测试里踩过的坑（别重复）

- **Crockford base32 没有 I L O U。** 手写测试用码两次踩到（`...SINGLE1A`、
  `...FOCUS01AAAA`），都被格式校验拒掉，而错误信息只说「激活码无效」，
  很容易误判成实现有问题。`tests/account-e2e.mjs` 现在按字母表拼码。
- **`npm test` 用 `node --test` 直接跑 `.mts`。** 但在某些沙箱环境里
  `node --test` 会因 fork 被拦而报 `spawn EPERM`；此时逐个
  `node tests/xxx.test.mts` 仍可跑通。
- **`~/lib` 别名在 `node` 直跑时解析不了。** 需要被单测直接引用的模块
  要用相对路径 import（`lib/entitlement-merge.ts` 就是因此单独拆出来的）。

## 部署

### 最小上线路径（不做账号）

这是把收费闭环跑起来所需的**全部**东西。账号那套完全不用碰。

**1. 建一个 Supabase 项目**

[supabase.com](https://supabase.com) → New project，区域选东京或新加坡。
免费额度对本站绰绰有余。等初始化完成。

**2. 跑两个 SQL**

SQL Editor → New query，依次执行：

- `supabase/schema.sql` —— 限流计数（**这个不做，生产环境每次排盘都会 503**）
- `supabase/redeem.sql` —— 激活码核销

`accounts.sql` **不要跑** —— 那是账号功能用的。

**3. 填环境变量，然后先跑体检**

Project Settings → API 里取：

| 变量 | 值 | 必填 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek 控制台 | ✅ |
| `DEEPSEEK_DAILY_BUDGET` | 全局每日熔断，默认 300 | 建议填 |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret | ✅ |
| `PASS_SECRET` | 见下 | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` public | ❌ 只有账号登录用得到 |

生成 `PASS_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

填完先别急着启动应用，**跑一次体检**：

```bash
node --env-file=.env.local scripts/check-supabase.mjs
```

它会逐项验证：变量有没有贴错（`service_role` 误填成 `anon` 是最常见的坑）、
连不连得上、三张表建了没、五个数据库函数齐不齐、Auth 邮件登录开没开。
失败时会直接告诉你**去哪一步做什么**，而不是等到运行时冒一句含糊的 503。

配错 Supabase 的失败方式都很沉默 —— SQL 只跑了一半、钥匙贴串了，
表现都是 503 或 401。从那里往回查很费时间，这个脚本是省那段时间的。

> 体检会往 `usage` 表写一行探针数据（键名 `__preflight_probe__`），
> 不会消耗任何激活码。介意的话在 SQL Editor 里删掉：
> `delete from public.usage where key = '__preflight_probe__';`

**4. 发码**

```bash
node --env-file=.env.local scripts/gen-codes.mjs --kind member --days 30 --count 20 --batch 2026-10
node --env-file=.env.local scripts/gen-codes.mjs --kind single --mode bazi --count 50 --batch 2026-10
```

注意：发码脚本需要 Supabase 配置，**内存兜底的 `DEV_REDEEM_CODES` 只用于本地自测**。

**5. 部署**

推到 GitHub → Vercel 导入 → 填第 3 步的变量 → 部署。

### 之后再开账号

想通了"会员要能跨设备"这件事，再回头看「账号体系」那一节 ——
跑 `accounts.sql`、配 SMTP、改邮件模板、补一个 anon key，就这些。

### 上线前务必逐条确认

- **在 DeepSeek 控制台另设消费上限** —— 代码里的熔断防的是滥用，
  控制台的上限才防得住代码本身出错。这条最重要，别跳
- 确认 `SUPABASE_SERVICE_ROLE_KEY` 与 `PASS_SECRET` 都**没被加** `NEXT_PUBLIC_` 前缀
  （加了就会被打进浏览器包，等于公开）
- **删掉 `.env.local` 与 Vercel 环境变量里的 `DEV_REDEEM_CODES`** ——
  那是内存兜底码，生产环境留着它等于开后门
- 收款码放到 `public/qrcode.jpg`（缺失时弹窗显示"暂未就绪"，不会裂图）
- 联系方式在 `src/lib/contact.ts` 一处改，页脚与付款弹窗同源
- 设 `NEXT_PUBLIC_SITE_URL` 为你的正式域名，否则 canonical 与 sitemap 指向 vercel.app
- 自己走一遍：付款 → 拿到码 → 站内兑换 → 排盘成功

### 关于 Supabase 是不是必须的

严格说不是必须，但它解决的是一个**没法绕开**的问题：Vercel 的函数是无状态的，
限流计数必须放在函数之外。放内存里的后果是每个实例各记各的、冷启动就归零 ——
等于没有限流，任何人都能无限刷你的 API。

代码把这条线画得很硬（`src/lib/server/runtime.ts` 的 `allowMemoryFallback`）：
生产环境没配数据层就**返回 503 拒绝服务**，而不是默默放行。
宁可不可用，也不敞着口子烧钱。

如果将来想换掉 Supabase：数据访问集中在 `runtime.ts` 的 `admin()` 与三个 store 文件里，
`usage` / `redeem_codes` / `pass_consumptions` 都是标准 SQL，换 Neon 或自建 Postgres
基本只动那一处。但 `accounts.sql` 那套要重写（认证得自己来）。
**自建服务器**（单进程）的话，进程内计数就够用了，Supabase 的必要性会大幅下降。

## 已知待办

- **订单表与管理后台**：订单确认目前依赖人工发码
- **会员到期提醒**：现在只能靠用户自己看
- **社交登录**：目前只有邮箱验证码

## 已刻意不做的事

- **第三方个人支付接入**（虎皮椒 / PayJS）：能自动回调，但要注册服务商、
  2–3% 手续费、钱先进第三方再提现。这层外部依赖不适合现阶段引入
- **管理后台网页**：一个只用于发码的网页要额外的密钥与暴露面，脚本够了
- **邀请裂变**：原实现是本机计数器，自己点三次就给自己发会员 ——
  那是一个兑不了的承诺，比没有更伤用户。等有了服务端账号体系再重新设计
