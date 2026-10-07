# 支付流程改造（方案 A：零资质）— 进度台账

- 计划: docs/superpowers/plans/2026-10-07-payment-flow.md
- 设计: docs/superpowers/specs/2026-10-07-xuanji-payment-design.md
- 分支: payment-flow
- 起点 commit: 52975ed
- 目标：金额服务端锁定 + 双渠道收款码 + 设备自动到账；激活码退为跨设备兜底

## 预检发现（2026-10-07，执行前）

1. **基线是红的**：`tests/ip-hash.test.mts` 与 `tests/paid-loop.test.mts` 在 import 阶段就崩
   （裸 `node --test` 解析不了 `@/lib` 别名）。崩溃发生在注册用例之前，所以这两个文件里的
   20 个测试**一直没跑**。实测：`node --test` = 411/409/2，挂 `ts-loader` = 431/431/0。
   → 已加 Task 0 修复。
2. **计划里三个新测试会踩同一个坑**（pay / order-store / codes-mint），Task 0 同时解决。
3. **计划原有的一条全局约束是错的**：写了 target 是 ES5，实际是 ES2020。已改。
   （错源：`src/lib/server/codes.ts:30` 有一条过时注释，照抄了它。）

## 任务

| Task | 状态 | commit |
|---|---|---|
| 0 修测试基线 | **完成** | 9b9d534..fd1b342，审查通过 |
| 1 pricing 单表化 | **完成** | fd1b342..87648e3，审查通过 |
| 2 抽出 mintCode | **完成** | 06bdd4d..05a0c2e，审查通过 |
| 3 orders.sql 与收口 | **完成** | 440f7a7..a30b549，审查 Needs fixes → 修复 17be321 后通过 |
| 4 支付接缝 pay.ts | **完成** | d7e5d31..7b8d6e4，审查通过 |
| 5 订单数据层 | **完成** | 7b8d6e4..b8a69ce，审查通过（三处偏离计划全部核实为对） |
| 6 建单与轮询路由 | 未开始 | |
| 7 交易单号与发码路由 | **完成** | 04864f7..175aa0b，审查通过 |
| 8 改造 PaymentModal | 未开始 | |
| 8 改造 PaymentModal | **完成** | 175aa0b..b80d262，审查 Needs fixes → 修复 39afc2a 后通过 |
| 9 对账脚本 | **完成** | 39afc2a..a45cbb8（3 提交），审查通过 |
| 10 文档与上线清单 | **完成** | a45cbb8..d4895ef |
| 终审修复 | **完成** | 1c4c85a（Critical 已人工复核） |

**全分支终审结论（25 提交 → 现 26）**：Critical 1 条、Important 2 条，已全部修复并验证（509/509 + e2e 56 项）。

- **Critical**：`security.sql` 的注释朝危险方向说谎（说"先跑本文件也安全"，实则先跑会让六个订单函数
  带默认 `grant execute to public` 上线 → 匿名可自签会员）。修法：`orders.sql` 六条 revoke 补 `public`
  （两层纵深）+ 注释改成实话。**已人工复核。**
- **Important**：订单终止态（expired/404）前端无限静默重试且 `expiresAt` 被丢掉（spec §4.4/§10 明写要提示）
  → 已修，实测三种终止态下轮询请求数不再增长（真停表）
- **Important**：`/api/order/code` 发码标记卡死 → 付过钱的用户永久拿不到码 → 已改为按 `batch = order.id`
  反查 `redeem_codes` 幂等恢复
- 实现者**反驳了我给的一条前提**（称 `postgrest-js` 把连接失败翻成 `{error}` 而不抛，实测印证），
  并按真实口径写测试与注释，没有夸大 —— 这是对的

**待用户裁定的设计问题（终审提出，未擅自决定）**：
1. 「获取激活码」按钮放在付款页底部（brief 明确要求）：付款前点它必然报错，但它服务跨设备用户
2. `ORDER_IP_DAILY_LIMIT = 20` 的计量口径：现在「每次弹窗打开 +1、失败也 +1」，一个 IP 开 20 次就再也付不了款，
   而 `pricing.ts` 自己承认「同一 IP 后面可能坐着宿舍或整间公司」

## 部署现状（重要）

香港服务器（腾讯云 `150.109.158.18`）上跑的是 **Task 0-6 时的代码**，付费界面还是旧的支付宝流程。
要让用户看到新的微信支付流程，需要：(1) 在 Supabase 跑 `orders.sql` 再 `security.sql`（顺序不能反）(2) 重新部署。

域名：`jianyouai.com` **在大陆被按域名拦截**（Cloudflare 也绕不过），已用 DuckDNS 测试域名
`xuanjitest2607.duckdns.org` 证明「全新域名 + 直连服务器」在大陆可通。旧域名付到 2028 年，留着。

## Task 3 的重大发现：security.sql 自相矛盾（已修）

`supabase/security.sql` 开头花整段论证「`revoke ... from anon, authenticated` 挡不住匿名调用，
必须 `revoke ... from public`」，**而它自己的执行体干的正是它警告的那件事**（第 55–63 行只撤了两个角色）。

后果（按该文件自己第 27–38 行的分析）：五个老 `security definer` 函数在 PostgREST 里匿名可调 ——
`merge_entitlement` 可被用来**给自己写一份会员（付费墙失守）**、
`claim_device_entitlement` 同样且能劫持他人设备权益、`claim_link_code` / `redeem_code` 可爆破、
`bump_usage` 可把全局熔断打满让付费用户一起 503。

修法：`security.sql:60` 合并为 `revoke all on all functions in schema public from public, anon, authenticated;`。
审查确认：`revoke ... FROM PUBLIC` 删的是 ACL 里 `=X/owner` 那一项，继承链随之断开 —— 洞是真的，修是真的修上了。

**⚠️ 上线前必须实测的部署风险**（审查提出，无法在本地验证）：
撤销 PUBLIC 之后，**`service_role` 也从 PUBLIC 继承不到 EXECUTE 了**。若 Supabase 没有给那五个老函数
留显式的 `service_role=X/owner`，服务端调用会开始报 `42501` —— 权益系统全线失灵。
用 `security.sql:70-75` 那段现成的核对查询确认：期望看到 `{owner=X/owner,service_role=X/owner}` 这种形状，
若 `service_role` 不在里面，需要给它显式补授权。**这条不验，不要上线。**

## 留给终审的 Minor（Task 3 审查，逐条已确认非阻塞）

1. `supabase/security.sql:22` —— 改成了「八张表」（事实正确：全库 8 个 create table 都开了 RLS 且无 policy），
   但同一句里点名的文件仍只有 `accounts / ledger / redeem / schema`（共 7 张），`orders` 没进枚举。
   句内自相矛盾。修法：把 `orders` 加进枚举，或去掉文件枚举
2. `supabase/orders.sql:26` —— `orders_status_created_idx on (status, created_at desc)` 不被本文件任何查询用到；
   唯一的状态机扫描是 `status = 'pending' and expires_at < now()`，更贴的是 `expires_at` 上的部分索引
3. `supabase/orders.sql:6` —— `plan` 的取值只写在注释里，无 CHECK 约束；`payer_ref` 无唯一约束，
   同一交易单号理论上可确认成两笔
4. `supabase/orders.sql:137-142` —— `unconfirm_order` 回退到 `pending` 但不动 `expires_at`；
   若该单已过 `expires_at`，下一轮 sweep 会立刻翻成 `expired`。行为自洽但无注释说明
5. `scripts/check-supabase.mjs` —— 新增注释借「本脚本承诺不写任何数据」论证改用 OpenAPI，
   而紧邻的既有注释明说 `bump_usage` 那次探测「确实会留一行数据」。论证夸大了（改用 OpenAPI 本身有更硬的理由，
   不必借这个不成立的前提）；另外该处「读不到函数」统一报「执行 supabase/orders.sql」，
   但也可能由 service_role 失去 EXECUTE 触发，文案会把人引向重跑已跑过的 SQL

## 留给终审的 Minor（Task 4 审查，逐条已确认非阻塞）

6. `src/lib/pay.ts:45` —— `qrSrcFor(provider: string, …)` 的参数是 `string` 而非 `PayChannel["id"]`。
   `qrSrcFor("wecaht", 6.6)` 能通过类型检查并静默产出坏路径，而本模块存在的理由就是那个联合类型。
   当前无调用方能传错（`pay.ts:53` 传的是已窄化的 `p.id`），纯防御性缺口。一字的修法
7. `src/lib/pay.ts:21-22,30-32` —— `redirect` 联合分支与 `channels[]` 数组属于**计划自身的过度设计**。
   计划给的理由（将来接聚合支付「下游不用动」）**站不住**：渲染 `channels` 的消费方必须加一个
   `redirect` case，实现自己的头注释也承认这点（`pay.ts:9` 写的是「本文件加弹窗里一个 case」）。
   真正吸收聚合支付的是订单/状态机那一套（Task 5-9），不是这个类型。
   数组的代价也已可见：测试里出现 `inst.channels[0]!` 非空断言。
   判为 Minor 而非 Important：`PayInstruction` 目前零消费方，将来加分支的成本与现在一样；
   且"渠道集合变过一次"发生在**设计期**，那时变是免费的。
8. `tests/pay.test.mts:107` —— 计划 id 手写在测试里（`["bazi","member_month","member_year"]`），
   而 `PLANS` 就是来源。将来往 `PLANS` 加第四个计划，这条名为「每个计划都给出微信渠道」的测试会静默漏掉它
9. `tests/pay.test.mts` 报告里的行数记错（说 49 / 51，实际 56 / 44）。纯记账，不影响结论

## Task 5 的三处偏离（审查已逐条核实为「对」，勿回退）

实现者主动偏离了计划给出的字面代码，理由是计划与 `orders.sql` 矛盾。审查独立验证，三处都成立：

1. `getOrder` 的内存路径**不得**调 `expireMemory()` —— 计划的代码会让计划自己的测试
   `确认可作用于已过期订单` 在第一条断言就失败。**这是计划自身的代码与测试打架。**
2. `confirmOrder` / `listRecentOrders` 同样去除 —— 这两处**不会**让任何测试失败，
   正是计划警告的「测试全绿、路径漂移」。审查 grep 确认 `orders.sql:81` 的
   `perform expire_stale_orders()` 是**全库唯一**一处（只在 `create_order` 内），
   所以内存侧只在 `createOrder` 调用是忠实映射。
3. `setPayerRef` 的 REST 路径在 provider 为假值时省略而非写 `NULL`，与内存路径对齐。

## ⚠️ Task 7 必须补上的欠账

审查 M2：**RPC 路径与六个新 mock RPC 在已提交的测试里零覆盖**（计划的设计使然，不是实现者的错）。
风险是：mock 里的状态机若有镜像 bug，Task 7 的契约测试会对着**错误的 oracle** 判绿。
实现者用一次性脚本跑 HTTP 验证过 `p_*` 参数名，但脚本已删除 —— 于是「参数名拼错」这个
只在运行时才炸的东西，目前只有口头证据。**Task 7 必须把这条落成持久的测试。**

## 留给终审的 Minor（Task 5 审查）

10. `order-store.ts:154,221` —— `if (provider)` 用真值判断，而 `orders.sql:63` 用 `coalesce`（只排除 NULL）。
    空串 `""` 时内存保留旧渠道、SQL 覆盖成 `""`。当前不可达（`src/app/api/order/**` 还不存在），
    M1
11. `tests/order-store.test.mts:110-116` —— 第 11 条测试依赖执行顺序（共享 `memoryOrders` 无按测试重置），
    单独跑会失败。计划字面代码如此
12. `order-store.ts:88,155,190` —— 内存路径返回 `Map` 里那个对象**本身**（引用），RPC 路径返回新反序列化的行。
    与 `account-store` 既有先例一致，但 Task 6/7 的调用方不应依赖返回值不可变
13. `order-store.ts:87` —— 内存不rounding，DB 是 `numeric(10,2)`。实际不可达（`pricing.ts` 都是两位小数）
14. `order-store.ts:250` —— 排序比较器对相等时间戳返回 `-1`，非一致全序。已披露，无法违反测试的 `>=` 断言

## Task 6 的重大发现：路由文件无法被测试 import（计划已改，commit 7803176）

第一次派发 Task 6 时被用户打断，但 agent 其实跑完了（与 Task 3 同一模式），留下 **621 行未提交、未报告的代码**。
查证后发现两件事：

1. **测试方案不可行。** `next@14.2.35` 的 `package.json` **没有 `exports` 字段**，
   所以路由里的 `import ... from "next/server"` 在裸 Node 的 ESM 下解析不了：
   `ERR_MODULE_NOT_FOUND: node_modules/next/server`。加 `ts-loader` 也无效（它只管 `@/` 与相对路径）。
   → **任何 import 路由文件的测试都跑不起来。** 这也解释了仓库既有做法：
   `account-contract.test.mts` 把源码当文本读；`lib/access.ts` 的注释写明「判定在纯函数里，路由只负责凑齐东西」。
   **原计划把逻辑全写在路由里，违反了仓库自己的架构。**
   → 已改：判定抽到 `src/lib/order-flow.ts`（零 `next/*` 依赖）+ 单测 `tests/order-flow.test.mts`，路由退成薄适配层。

2. **仓库有安全守卫，加写入点必须刻意。** `tests/no-fake-unlock.test.mts` 两条守卫：
   - `写凭证的位置是封闭的一份名单`（:173）—— 逐一点名允许调 `withPassCookie` 的文件
   - `新增的写入点只能回写已验签的凭证，不得自行构造权益`（:195）—— 第二参数必须在白名单里

   孤儿路由触发了两条（实测 2 条失败）：
   - `withPassCookie(res, next, secret)` → `next` 在白名单，**这条本来就该通过**
   - `withPassCookie(res, snapshot, secret)` → `snapshot` 不在，**守卫拦得对**

   **`snapshot` 合法性的推理（已写进计划 Step 5）**：它来自 `orders.granted`，而那一列只可能由
   `claim_order_delivery` 写入（要求 `status='paid'` + 设备匹配 + 首次交付）——
   它是「恢复一份已被正当授予的权益」，不是凭空造。**但这与白名单其它项性质不同，理由必须写进注释**，
   否则等于把守卫变成摆设。

**孤儿代码的现状**：两个路由文件（100 + 134 行）**逻辑上忠实于计划**（404 而非 403、
`claimOrderDelivery` 抢占、`carried` 判断、`snapshot` 兜底都在），`tsc --noEmit` 干净。
**不丢**，交给重跑的 Task 6 当起点 —— 但逻辑要搬进 `order-flow.ts`。
配套的 `tests/order-contract.test.mts`（387 行，8 条测试全挂）已移到 `.tmp/`，那套写法作废。

## 部署线（2026-10-07，与支付改造并行）

**用户情况**（问了很多轮才问清，记下来免得重问）：
- 域名 `jianyouai.com`，在**阿里云万网**（权威 NS `dns17/dns18.hichina.com`，不是 DNSPod —— 我曾误报，`pdns.dnspod.cn` 是我查询用的解析器）
- **只续了域名，服务器本来没有**（用户先说"有域名和服务器"，实为只有域名）
- 域名 A 记录原指着 `47.82.118.229`（阿里云香港 IP，AS45102 国际站号段）——**那台不是他的**，
  是过期/被回收过的旧机器。主机密钥与 known_hosts 里三条旧记录不符，正是这个原因
- 已查到该 IP 归属：**香港**（两个独立 IP 库一致），所以路线（香港免备案）是对的
- 用户本机无直连网络，只走代理（`curl --noproxy '*'` 全部超时，走代理才有回应）——
  **所以从我这台机器探不到服务器状态，代理返回的 502 不可信**
- 用户已买阿里云**轻量应用服务器 香港 通用型 2vCPU/2GiB/30GiB/200Mbps**，约 56 元/月

**已生成**：`docs/deploy-hongkong.md`（逐步操作单，含阿里云专有点）、`deploy/`（Dockerfile /
docker-compose.yml / Caddyfile / .env.production.example）、`.dockerignore`、`.gitignore` 补了
`deploy/.env.production`（**原来没挡**，而它装 `SUPABASE_SERVICE_ROLE_KEY`）。commit `210dfe7`

**已生成部署专用密钥**：`~/.ssh/xuanji_deploy`（公钥 `xuanji-deploy-20261007`），
与用户个人的 `id_ed25519` 独立，可单独收回。等用户加到服务器 authorized_keys 后即可接手操作。

**下一步**：拿到新公网 IP → 改 DNSPod（阿里云云解析）里 `@` 与 `www` 的 A 记录指向新 IP →
按 `docs/deploy-hongkong.md` 走 → 最后在 Supabase 跑 `orders.sql` 再跑 `security.sql`（顺序不能反）

**注意**：部署的是 `main`（旧支付宝流程）。支付改造在 `payment-flow` 分支上，未合并。

## 计划中已知写得不够全的步骤

执行到这些步时需先读既有文件再补，别当成完备的：
Task 3 Step 2（security.sql 收口）、Task 5 Step 5（mock-supabase 六个桩）、
Task 6 Step 1（order-contract 完整测试）、Task 8 Step 4（PaymentModal 的 JSX）、
Task 9 Step 1（confirm-order.mjs 实现）。

## 支付方式的三次转向（2026-10-07 用户决定，已全部落地到 spec/计划）

1. **去掉支付宝，只做微信**（commit `06bdd4d`）
2. ~~只用一张通用收款码~~ —— 中途据「好像不可以」误判为微信设不了固定金额，**已撤销**。
   第三次转向（见 3）推翻了它。
3. **每价位一张带固定金额的微信收款码**（最终版，commit 见下）。微信**可以**设金额
   （我 → 服务 → 收付款 → 二维码收款 → 设置金额 → 保存收款码），扫码后金额已填好，用户不用手输。
   → 这才真正实现了「要支付多少就是多少」。

**一次虚惊，值得记下来**：用户先报「6.9」，代码里是 6.6，我一度设计成"通用码 + 页面承载金额"
来绕开这个矛盾。查图后真相是——用户 13:10 存了 6.90/9.90/69.00 三张，13:11 又存了 6.60，
把修正后的 6.60 发了过来说"这三张才是对的"。**6.9 是他第一版做错的图，代码的 6.6 一直是对的。**
教训：价格分歧先去查证据（图/物料），别急着改设计。

## 素材与裁图（2026-10-07 完成）

三张原始海报在 `D:\微信记录\...\RWTemp\2026-10\9e20f478...\`（1260×1615 竖版，二维码只占约 40% 宽，
且印着收款人显示名「香辣盐(**雨)」）。已用 `.tmp/crop-qr.mjs` 裁成 559×559 方图入库：

| 入库文件 | 源文件 | 金额 |
|---|---|---|
| `public/pay/wechat-6.60.png` | `98b52c56…png`（13:11:46） | ¥6.60 |
| `public/pay/wechat-9.90.png` | `57b4fc49…png`（13:10:09） | ¥9.90 |
| `public/pay/wechat-69.00.png` | `103aaf59…png`（13:10:14） | ¥69.00 |

`b5529bee…png`（13:10:05）是 **¥6.90**，是用户第一版做错的那张，**未入库，别误用**。
12:58 那三张（1477×2040）是没有金额的早期版本。

裁剪脚本按「深色像素横向跨度」定位（二维码行约 500px、人名行约 250px，阈值取 350），
不写死坐标。三张定位完全一致（x 378-881 / y 506-1009），是同一模板的佐证。
裁完已 Read 回来看过：干净方图，无绿底、无标题、无 logo、无收款人名字。

**`.tmp/crop-qr.mjs` 依赖 `pngjs`，是用 `npm install pngjs --no-save` 临时装的**（未进 package.json）。
日后若重做图需要它，注意 `--no-save` 意味着 `npm ci` 之后就没有了。

## 开放项（阻塞上线，不阻塞编码）

1. **图片上的金额与 `PLANS` 必须一致** —— 图片上的金额是物理的、改不了。改价 = 改 `PLANS` 一行
   **加**换图，两件事都要做；只做一件会表现为弹窗显示「暂未就绪」（刻意如此，好过"页面标 6.6、扫码付出 6.9"）
2. 三张图肉眼极像，只有金额数字不同 → 上线前逐档确认弹窗显示的是**对应金额的那张**

---

# 八字单产品整改 — 进度台账

- 起点 commit: 666809d（entitlement-authority 分支上）
- 转向: 2026-10-02 用户决定只保留八字，其余四个模式全删
- 收费模式: **免费排盘 + 付费深度解读**（八字是唯一产品）

## 路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 删 | 四个模式连页面/算法/测试清掉，全站收敛到八字 | **完成** 125cf33 → 02fe16d |
| 2 排盘做厚 | 藏干支中十神空亡长生、胎元命宫身宫、身强身弱用神、格局、神煞、合冲、流年小运、**农历输入**、**真太阳时** | **完成** ea2e947 → 53313b4 |
| 2b 出生信息 | **出生时刻改精确到分钟**；**出生地改省市县三级联动**（34省/344市/3291区县） | **完成** afcbd6a |
| 3 解读与呈现 | 盘面重写；**解读已分节**（结论/依据/展开）；分享图；追问 | **完成** 86208c9 → 1ba53d8 |
| 4 收费适配 | 免费排盘 + 付费解读；单产品化的凭证层 | 未开始（用户明确说不急） |

## 阶段 3 补充（2026-10-02 晚）

- **地支相刑与相害** 补齐（合冲刑害四件套）—— 此前只有合与冲
- **十神挪到天干上方** —— 它描述的是天干；支中十神并进各自的藏干旁
- **历史时区**：1949 年前中国分五个时区，按经度就近取（见 solar-time.ts 的 HISTORICAL_ZONES）。
  取错就是整整一个时辰，所以这条不是锦上添花
- **小运 / 流月**：小运每步大运十年；流月只给当年那一个流年带（全带上近千条，不值当）
- **十神力量排行**、**宫位对应**、**用神取法口径标注**（明写"不是定论"）
- **分享图**：布局是纯函数（可单测），渲染才碰 canvas。用 canvas 2D 直绘而非
  「拼 SVG 转图片」—— 后者脱离文档、webfont 用不上，中文会掉回默认字形
- **追问**：`/api/ask`，与首次解读**共用同一套限流**
- **性能**：区划数据改为按需加载；顺带发现 **lunar-typescript 一直被误打进浏览器包**
  （BaziChart 从 `@/lib/bazi` 入口取常量，而入口 import 了历法库）。
  首屏 273 KB → 155 KB。这条要盯住，测试里已加守卫防止改回去

**249 个测试全绿。**

## 阶段 2 完成情况

拆分：`src/lib/bazi/` 下 constants / relations / strength / pattern / shensha / solar-time / places / index，
每个模块都能被 `node --test` 直接单测。**187 个测试全绿**（阶段 1 结束时是 97）。

一个重要的解绑：`tsconfig.json` 打开 `allowImportingTsExtensions` + 显式 `target: ES2020` 之后，
`src/` 里可以写 `./x.ts` 形式的相对导入，三关（node --test / tsc / next build）全通 ——
"所有八字代码必须挤在一个文件里"这条假约束就此解除。

## 端到端实测（真调 DeepSeek）

输入：农历 2023 闰二月初一 巳时 男 出生地乌鲁木齐 关注事业
- 公历 2023-03-22 ✓（闰月换算正确）
- 钟表 09:00 → 真太阳时 06:43，差 −137 分钟 ✓
- 时柱由「己巳」变为「丁卯」—— 校正真的改掉了时柱 ✓
- 四柱 癸卯 乙卯 己卯 丁卯、日主己 身弱 用神火 忌神水、七杀格

## 踩过的坑（留给后来者）

1. **孤辰寡宿用「三会方」分组，桃花驿马华盖将星用「三合局」** —— 两套分组里同一个支归属不同
   （申在三合属水、在三会属金），混用会算到错的支。测试抓到。
2. **甲日寅月是建禄格**，不能让循环落到中气丙取成食神格。月令本气为比劫时中余气不参与取格。
3. **bash 传中文给 curl 会按 GBK 编坏字节**，导致 `longitudeOf("乌鲁木齐")` 匹配不上。
   调试时用 node 写 UTF-8 文件 + `--data-binary @file`，否则会误判成应用 bug。
4. `next build` 与 `next dev` 不要同时跑，前者会冲掉 `.next` 让后者行为异常。
5. **GeoNames 的文件是 0 起列号**，国家码在 `f[8]` 而不是 `f[9]`（那是 cc2，中国为空）。
   awk 的 `$9` 是 1 起，所以同一列 awk 对、JS 错 —— 我在这个上面绕了好几轮，
   还一度误判成"文件里没有中文名"。**先核对列定义，再怀疑编码。**
6. `npm` 配了个没在跑的代理（127.0.0.1:7890），装不上包；但 `NO_PROXY=*` 让 curl 直连通。
   取 npm 包可以绕过 npm：从 registry 元数据里拿 tarball 地址，用 curl 下、tar 解。

## 省市县数据的来源与口径（重要，别重新查一遍）

- **区划名称**：`province-city-china`（34 省 / 337 市 / 3285 区县；直辖市无市级条目，其区直接挂省下）
- **城市经度**：NGA GNS（经 `astrology-china-locations`，311 条）∪ GeoNames `cities15000`（1620 条）
- **自治州与盟**取**驻地市**经度（延边州取延吉、凉山州取西昌…），共 18 个，是公开行政事实
- **6 个市两处都查不到**，退用所在省的中位数经度：三沙市、海北藏族自治州、
  湖北/海南/新疆/河南的「省直辖县级行政区划」（已改名为「省直辖县级市」）。
  名单钉在 `regions.ts` 的 `APPROXIMATED` 里，界面会标「该地经度为省内估值」
- 县不单独存经度：同一地级市内经度差 < 1°（4 分钟），而时辰边界是 2 小时

## 关键口径：晚子时（已实测）

`Solar.fromYmdHms` + `getEightChar()`（库默认 sect=2）：

```
22:59 亥时末   日柱 己卯 | 时柱 乙亥
23:00 晚子时   日柱 己卯 | 时柱 丙子   ← 日柱不变，时柱按次日日干起
00:30 早子时   日柱 己卯 | 时柱 甲子
```

出生时刻改成精确输入后，23:00–24:00 会真的踩到这条，表单里已加说明。

## 阶段 1 实测

- `npx tsc --noEmit` 干净；`npx next build` 成功，路由只剩 `/`、`/member`、`/api/fortune`
- `npm test` 97 通过 / 0 失败（原 144 → 删掉四个模式的测试后净剩 97）
- 删除规模：35 个文件，−2675 行 / +245 行
- 首页实际输出已无「今日运势/灵签/塔罗/姻缘」字样（含 metadata）
- 仍待办：**`/member` 页的付费流程还是假的**（点「已完成支付」即变会员），阶段 4 处理

## 库能力盘点（lunar-typescript 1.8.6）

现成可直接用：藏干、**支中十神**（`getXxxShiShenZhi`）、空亡（`getXxxXunKong`）、
**十二长生**（`getXxxDiShi`）、胎元/胎息/命宫/身宫（`getTaiYuan/getTaiXi/getMingGong/getShenGong`）、
**流年流月小运**（`DaYun.getLiuNian()` / `LiuNian.getLiuYue()` / `DaYun.getXiaoYun()`）。

必须自己写：**身强身弱、用神喜忌、格局（月令取格）、八字神煞、真太阳时**。
注意库里的 `JiShen()`/`XiongSha()` 是黄历吉神凶煞，**不是**八字神煞，不能拿来充数。

## 待用户提供（不阻塞编码，阻塞上线）

- `src/lib/contact.ts` 的联系方式 —— 未提供
- Supabase 项目 —— 未提供（本地走内存兜底）

---

# 挂起：收费闭环与服务端权威（3/8，被转向中断）

- 计划: docs/superpowers/plans/2026-10-02-xuanji-entitlement.md
- 设计: docs/superpowers/specs/2026-10-02-xuanji-entitlement-design.md
- 分支: entitlement-authority
- 起点 commit: c27ace5

**为什么挂起**：该计划的「单次券（塔罗/姻缘/八字三个价位）」与「免费额度（给今日运势与灵签）」
两个核心概念，随着四个模式被删而失去对象。凭证层（Task 1-3）本身仍可用，第 4 阶段会按
单产品重写后复用。**不要直接续跑该计划的 Task 4-8。**

| Task | 状态 | 备注 |
|---|---|---|
| 1 凭证模块 | complete | c27ace5..a68544d，审查通过 |
| 2 放行判定 | complete | a68544d..a8bd5e1，审查通过 |
| 3 数据层 | complete | 666809d |
| 4-8 | 挂起 | 需按「单产品」重写后再跑 |

## Minor findings（留待整体终审裁定，逐条已确认非阻塞）

来自 Task 1 审查（`src/lib/entitlement.ts`）：

1. `grantMember`:119-121 直接复用 `ent.passes` 的数组引用 —— 今天安全只因没有函数原地改它，
   属约定而非保证。修法：`passes: [...ent.passes]`
2. `grantPass`:135 在合并前不 prune —— 若输入含同模式的**过期**券，新券会继承那笔死计数。
   实际不可达（路由侧的输入永远来自已 prune 的 `verify`），弱项
3. `sign`:46 / `verify`:89 不拒绝空 secret。调用方注入是刻意的，但空串会让 `createHmac` 照常工作，
   把一个静默降级变成可伪造。修法：`if (!secret) throw`
4. `parseEntitlement`:73-83 对畸形的 pass 项静默丢弃而非整份判无效 —— 只对自签 token 可达，
   但意味着 `verify` 可能返回与签名内容不同的凭证
5. 测试缺口：没有 `verify(undefined)` / `verify(null)`（缺 cookie 时的真实路径），
   也没有 `consumePass → sign → verify` 的往返测试（生产的实际用法）。两条都是一行

来自 Task 2 审查（`src/lib/access.ts` + `tests/access.test.mts`）：

6. `tests/access.test.mts:82-88` — 迁移时丢了旧套件最后一条边界断言
   （`limits={1,1,1}, counts={0,0,0} → allow`）。**计划自身的文案与代码块打架**：
   prose 说「原有的 quota-policy 测试全部迁进来」，代码块却漏了这一条。属计划缺陷，
   影响很低（同样的 `>=` 阈值语义已由 :135-138 覆盖）。修法：补回一行
7. `tests/access.test.mts:121-127` — 两处过期边界只测了「已过期」一侧，
   没测 `member === nowSec` / `e === nowSec` 的正好相等。代码是对的（用 `>` 不用 `>=`），纯覆盖缺口
8. `tests/access.test.mts:186-187` — `assert.equal(typeof d.message, "string")` 是套套逻辑，
   判别联合已经保证了这点。从旧测试逐字继承来的，无害

## 待用户提供（不阻塞编码，阻塞上线）

- `src/lib/contact.ts` 的联系方式 —— 未提供
- Supabase 项目 —— 未提供（本地走内存兜底）

---

# 归档：阶段一 安全底座（已完结）

- 计划: docs/superpowers/plans/2026-09-30-phase1-security-baseline.md
- 分支: frontend-polish（含安全与前端的全部改动）
- 起点 commit: f52bd73
- 完结 commit: e6156b7

| Task | 状态 | 备注 |
|---|---|---|
| 1 测试基础设施 | complete | 7cfd5e0 |
| 2 价格单一来源 | complete | 5689702 |
| 3 全站接入价格 | complete | 1629eb2→5403eed→5a6b3c0 |
| 4 输入校验 | complete | 7fecdc6 |
| 5 额度策略 | complete | e6156b7 |
| 6 Supabase 用量存储 | complete | 代码完成；Supabase 未配置，走开发内存兜底，生产需配 |
| 7 重写 API 路由 | complete | e6156b7，限流实测通过 |
| 8 AI 输出转义 | complete | 提前于前端阶段完成（aafbcb7） |
| 9 移除邀请裂变 | complete | e6156b7 |
| 10 环境变量与文档 | complete | .env.example + README |

## 实测验证
同一 IP：
- 设备 A 连打 4 次 → 3 次 200，第 4 次 429（设备闸，配额 3）
- 换设备 B 再打 4 次 → 3 次 200，第 4 次 429（IP 闸，配额 6）
- 即 3+3=6 触顶，两道闸都按设计工作
