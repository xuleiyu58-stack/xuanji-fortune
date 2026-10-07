/**
 * 订单链路的端到端验证（对着 tests/mock-supabase.mjs 跑）。
 *
 * 单测覆盖不到两层东西，这里补上：
 *
 *   **A. order-store 的 RPC 路径。** Task 5 的欠账：`tests/order-store.test.mts`
 *   跑的是内存兜底（测试环境没配 Supabase），六个订单 RPC **一次也没被执行过** ——
 *   风险是"桩里若有镜像 bug，测试会对着错误的 oracle 判绿"。这一节把
 *   `src/lib/server/order-store.ts` 直接接到桩上（配好 Supabase 环境变量），
 *   让 create_order / claim_order_delivery / confirm_order / mark_code_issued /
 *   unconfirm_order / expire_stale_orders 全部真跑一遍。
 *
 *   **B. 两个新路由的真接线。** /api/order/claim 与 /api/order/code 都 import 了
 *   `next/server`，裸 Node 解析不了（next@14.2.35 没有 exports 字段），
 *   单测 import 不了它们。所以这里起真 dev server，对着桩打真 HTTP。
 *
 * 它证明的是**我们自己的接线与语义**，不是 Supabase 本身 ——
 * 真机联调仍然必须做。
 *
 * 用法：
 *   node tests/mock-supabase.mjs 54321                       # 终端 A
 *   # 终端 B：把 .env.local 挪开（免得打到线上库），用指向桩的变量起 dev server
 *   #   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   #   SUPABASE_SERVICE_ROLE_KEY=test-service-role \
 *   #   NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon \
 *   #   npx next dev -p 3121
 *   # 终端 C：
 *   #   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   #   SUPABASE_SERVICE_ROLE_KEY=test-service-role \
 *   #   APP_URL=http://localhost:3121 \
 *   #   node --import ./scripts/ts-loader.mjs tests/order-e2e.mjs
 */
const APP = process.env.APP_URL ?? "http://localhost:3121";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:54321";

let failures = 0;
const line = (s) => console.log(`\n=== ${s} ===`);
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
};

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEV = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

// ── 工具 ────────────────────────────────────────────────────
const readCookie = (res, name) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m) return m[1];
  }
  return null;
};
const readDev = (res) => readCookie(res, "xj_dev");

const post = (p, body, cookie) =>
  fetch(`${APP}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (p, cookie) => fetch(`${APP}${p}`, { headers: cookie ? { cookie } : {} });

/** 桩上直查（对账视角）。服务端角色，桩不校验 key，给个形状即可。 */
const SVC = { apikey: "test-service-role", Authorization: "Bearer test-service-role" };
const mockGet = async (path) => (await fetch(`${MOCK}${path}`, { headers: SVC })).json();
const mockOrders = (id) => mockGet(`/rest/v1/orders?id=eq.${id}`);
const mockCodes = (batch) => mockGet(`/rest/v1/redeem_codes?batch=eq.${batch}`);
const mockRpc = async (fn, args) =>
  (
    await fetch(`${MOCK}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...SVC, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    })
  ).json();

// 桩是常驻进程，上一轮状态会干扰这一轮。开头清一次。
await fetch(`${MOCK}/__test__/reset`, { method: "POST" });

// ═══════════════════════════════════════════════════════════
// A. order-store 的 RPC 路径（Task 5 欠账）
// ═══════════════════════════════════════════════════════════
line("A. order-store 真接 RPC（六个订单函数逐个走一遍）");

const store = await import("../src/lib/server/order-store.ts");
const { isSupabaseConfigured } = await import("../src/lib/server/runtime.ts");

check(
  "A0. 进程确实配了 Supabase（否则下面测的还是内存兜底，等于什么都没测）",
  isSupabaseConfigured(),
  `configured=${isSupabaseConfigured()}`
);

const a1 = await store.createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
check("A1. create_order → pending，金额原样", a1?.status === "pending" && a1.amount === 6.6, `id=${a1.id}`);

check(
  "A2. claim_order_delivery 对未到账的单返回空（前置条件 status='paid'）",
  (await store.claimOrderDelivery(a1.id, DEV, { v: 1, member: null, passes: [] })) === null
);

const refRow = await store.setPayerRef(a1.id, DEV, "2026100722001", "wechat");
check(
  "A3. setPayerRef 写库且不改状态（走的是 REST PATCH，不是 RPC）",
  refRow?.payerRef === "2026100722001" && refRow?.provider === "wechat" && refRow?.status === "pending"
);
check("A4. setPayerRef 设备不匹配 → null", (await store.setPayerRef(a1.id, OTHER, "x", null)) === null);

const paid = await store.confirmOrder(a1.id, "e2e", "wechat");
check("A5. confirm_order → paid", paid?.status === "paid" && paid.confirmedBy === "e2e", `status=${paid?.status}`);

const snap = { v: 1, tid: "e2e-1", member: null, passes: [{ m: "bazi", n: 1, e: 1_700_000_000 }] };
const delivered = await store.claimOrderDelivery(a1.id, DEV, snap);
check("A6. claim_order_delivery → 交付成功并落快照", Boolean(delivered?.deliveredAt) && delivered.granted !== null);
check(
  "A7. claim_order_delivery 只能一次（并发双击的防线）",
  (await store.claimOrderDelivery(a1.id, DEV, snap)) === null
);
check("A8. unconfirm_order 被 delivered_at 挡住", (await store.unconfirmOrder(a1.id)) === null);

const a2 = await store.createOrder({ plan: "member_year", amount: 69, deviceId: DEV, ttlMinutes: 30 });
await store.confirmOrder(a2.id, "e2e", null);
check("A9. mark_code_issued 首次成功", (await store.markCodeIssued(a2.id, DEV)) !== null);
check("A10. mark_code_issued 第二次返回空（一次付款只发一次码）", (await store.markCodeIssued(a2.id, DEV)) === null);
check("A11. unconfirm_order 被 code_issued_at 挡住", (await store.unconfirmOrder(a2.id)) === null);

const a3 = await store.createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
await store.confirmOrder(a3.id, "e2e", null);
const undone = await store.unconfirmOrder(a3.id);
check("A12. unconfirm_order 在双闸都空时成功，回到 pending", undone?.status === "pending" && undone.paidAt === null);

// 过期路径：ttl 为负 -> 下一次建单时被 expire_stale_orders 清成 expired，
// 而 expired 仍必须能被 confirm 复活（用户超时后才付款的真实坏情况）。
const a4 = await store.createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: -1 });
await store.createOrder({ plan: "bazi", amount: 6.6, deviceId: DEV, ttlMinutes: 30 });
check("A13. expire_stale_orders 把超时的 pending 转 expired", (await store.getOrder(a4.id))?.status === "expired");
const revived = await store.confirmOrder(a4.id, "e2e", null);
check("A14. confirm_order 能复活 expired 单（不丢单）", revived?.status === "paid");

check("A15. getOrder 读不存在的单 → null", (await store.getOrder("00000000-0000-0000-0000-000000000000")) === null);
const recent = await store.listRecentOrders(24 * 60 * 60 * 1000);
check("A16. listRecentOrders 读回本轮的 5 张单，按创建时间倒序", recent.length === 5, `rows=${recent.length}`);
check(
  "A17. 倒序确实成立",
  recent.every((o, i) => i === 0 || recent[i - 1].createdAt >= o.createdAt)
);

// ═══════════════════════════════════════════════════════════
// B. 两个新路由的真接线
// ═══════════════════════════════════════════════════════════
line("B. /api/order/claim 与 /api/order/code（真路由 + 桩）");

// B1. 建单拿设备 cookie
let r = await post("/api/order", { plan: "bazi" });
check("B1. 建单 → 200", r.status === 200);
const orderA = (await r.json()).orderId;
const devA = readDev(r);
check("B1. 签发了设备 cookie", Boolean(devA), `xj_dev=${devA?.slice(0, 8)}…`);

// B2. 行为 1：pending 单可以提交交易单号，状态不变
r = await post("/api/order/claim", { orderId: orderA, payerRef: "  2026100722001234567  ", provider: "wechat" }, `xj_dev=${devA}`);
check("B2. 提交交易单号 → 200", r.status === 200, `status=${r.status}`);
const claimBody = await r.json();
check(
  "B2. 文案诚实：说清是「核对到账后」才开通",
  typeof claimBody.notice === "string" && claimBody.notice.includes("核对到账后会为你开通"),
  `notice=${claimBody.notice}`
);
check(
  "B2. 文案不谎称已开通（提交 != 到账）",
  !/已开通|即刻开通|立即生效|稍后开通/.test(claimBody.notice ?? "")
);
let rowA = (await mockOrders(orderA))[0];
check("B3. 单号已落库且去掉两端空白", rowA?.payer_ref === "2026100722001234567", `payer_ref=${rowA?.payer_ref}`);
check("B3. 渠道已落库", rowA?.provider === "wechat");
check("B3. 状态仍是 pending —— 提交不等于到账", rowA?.status === "pending", `status=${rowA?.status}`);

// B4. 行为 2：别人的设备一律 404
const rB = await post("/api/order", { plan: "bazi" });
const devB = readDev(rB);
check("B4. 别人的设备提交单号 → 404", (await post("/api/order/claim", { orderId: orderA, payerRef: "X" }, `xj_dev=${devB}`)).status === 404);
check("B4. 不带设备号提交单号 → 404", (await post("/api/order/claim", { orderId: orderA, payerRef: "X" })).status === 404);
check(
  "B4. 不存在的订单号 → 404（与设备不匹配同形，不做订单探测器）",
  (await post("/api/order/claim", { orderId: "00000000-0000-0000-0000-000000000000", payerRef: "X" }, `xj_dev=${devA}`)).status === 404
);
check("B4. 缺交易单号 → 400", (await post("/api/order/claim", { orderId: orderA }, `xj_dev=${devA}`)).status === 400);

// B5. 行为 3：未付款订单取激活码 → 400
r = await post("/api/order/code", { orderId: orderA }, `xj_dev=${devA}`);
check("B5. 未到账取码 → 400", r.status === 400, `status=${r.status}`);
check("B5. 未到账取码文案说明尚未到账", (await r.json()).error === "该订单尚未到账");
check("B5. 别人的设备取码 → 404", (await post("/api/order/code", { orderId: orderA }, `xj_dev=${devB}`)).status === 404);

// B6. 人为确认到账（模拟站长核对流水后确认；Task 9 的对账脚本还没做，这里直接打 RPC）
const confirmed = await mockRpc("confirm_order", { p_id: orderA, p_by: "e2e", p_provider: "wechat" });
check("B6. confirm_order RPC 生效（Task 5 欠账：这个函数此前从未被执行过）", confirmed?.[0]?.status === "paid");

check("B7. 已到账的单不再收交易单号 → 400", (await post("/api/order/claim", { orderId: orderA, payerRef: "X" }, `xj_dev=${devA}`)).status === 400);

// B8. 行为 4：已付款订单取激活码 → 16 位合法码
r = await post("/api/order/code", { orderId: orderA }, `xj_dev=${devA}`);
check("B8. 已到账取码 → 200", r.status === 200, `status=${r.status}`);
const codeBody = await r.json();
const code = codeBody.code;
check(
  "B8. 码是 16 位 Crockford base32（不能有 I/L/O/U）",
  typeof code === "string" && code.length === 16 && [...code].every((ch) => ALPHABET.includes(ch)),
  `code=${code}`
);

// B9. 行为 4 后半：第二次取 → 400，且库里没有第二张码
r = await post("/api/order/code", { orderId: orderA }, `xj_dev=${devA}`);
check("B9. 第二次取码 → 400（只能取一次）", r.status === 400, `status=${r.status}`);
const codes = await mockCodes(orderA);
check("B9. 库里只有一张码 —— 重复点没有变出第二个", codes.length === 1, `rows=${codes.length}`);
check("B9. 码的 batch 指向本单，重复取不会新铸", codes[0]?.code === code);
check(
  "B9. kind/mode/days 与该单套餐（bazi 单次）一致",
  codes[0]?.kind === "single" && codes[0]?.mode === "bazi" && codes[0]?.days === 0,
  `${codes[0]?.kind}/${codes[0]?.mode}/${codes[0]?.days}`
);

// B10. 发出去的码是真码：换台设备能核销（证明不是个占位串）
r = await post("/api/redeem", { code }, `xj_dev=${devB}`);
check("B10. 发出的码能真的核销 → 200", r.status === 200, `status=${r.status}`);
check("B10. 核销后签发权益摘要", (await r.json()).entitlement != null);

// B11. spec §13 的已知取舍：先发码、再轮询自动到账 = 两份权益。
// 这不是 bug，是刻意接受的（堵它会堵死"电脑已自动到账、现在想给手机也开一个"）。
// 这里把它钉住：行为一旦变了能被立刻发现。
r = await get(`/api/order/status?id=${orderA}`, `xj_dev=${devA}`);
const poll = await r.json();
check(
  "B11. (§13 刻意取舍) 取码后本设备仍能就地产出第二份权益",
  r.status === 200 && poll.success === true && poll.entitlement != null,
  `status=${r.status} delivered=${poll.delivered} entitlement=${poll.entitlement ? "有" : "无"}`
);

// ── B12/B13：发码失败的两条分支（靠桩的故障注入真跑一遍）─────
// 这两条是最容易被"顺手清理"的逻辑，而只靠源码字符串断言挡不住实现被改坏。
line("B12. 写码失败 → 撤回 code_issued_at（否则用户再也拿不到码）");

/** 单独建一张已到账的单，供失败分支使用。 */
async function paidOrder() {
  const created = await post("/api/order", { plan: "bazi" });
  const id = (await created.json()).orderId;
  const dev = readDev(created);
  await mockRpc("confirm_order", { p_id: id, p_by: "e2e", p_provider: "wechat" });
  return { id, dev };
}
const setMode = (mode) =>
  fetch(`${MOCK}/__test__/redeem-insert-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });

const c1 = await paidOrder();
await setMode("error");
r = await post("/api/order/code", { orderId: c1.id }, `xj_dev=${c1.dev}`);
check("B12. 写码报错 → 503", r.status === 503, `status=${r.status}`);
rowA = (await mockOrders(c1.id))[0];
check("B12. 发码标记被撤回（code_issued_at 回到 null）", rowA?.code_issued_at === null, `code_issued_at=${rowA?.code_issued_at}`);
await setMode("none");
r = await post("/api/order/code", { orderId: c1.id }, `xj_dev=${c1.dev}`);
check("B12. 撤回后重试能拿到码 —— 用户没有被打死", r.status === 200 && (await r.json()).code?.length === 16, `status=${r.status}`);

line("B13. 撞码 → 重试；重试 5 次仍撞则 503（标记留着，属于几乎不可达的边角）");
const c2 = await paidOrder();
await setMode("conflict");
r = await post("/api/order/code", { orderId: c2.id }, `xj_dev=${c2.dev}`);
check("B13. 连续撞码 → 503", r.status === 503, `status=${r.status}`);
rowA = (await mockOrders(c2.id))[0];
// 这条钉住的是**实际行为**，不是"理想行为"：撞码走的是重试分支（不是撤回分支），
// 耗尽重试后标记仍留在库里，此时用户再点会被 400 挡下、只能找客服。
// 5 次连续撞码在 80 bit 空间里概率可忽略，brief 就这样接受的 —— 记在这里，
// 免得将来有人以为这是漏掉了撤回。
check(
  "B13. 撞码耗尽后发码标记仍留着（用户要找客服；brief 接受的边角）",
  rowA?.code_issued_at !== null,
  `code_issued_at=${rowA?.code_issued_at}`
);
await setMode("none");

// ── 汇总 ────────────────────────────────────────────────────
line(failures === 0 ? "全部通过" : `${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
