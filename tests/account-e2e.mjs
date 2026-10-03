/**
 * 账号体系的端到端验证（对着 tests/mock-supabase.mjs 跑）。
 *
 * 验证的不是"Supabase 能工作"，而是**我们自己的接线与语义**：
 *   · 未登录兑换后，权益同时进 cookie 与 device_entitlements
 *   · 登录后能签发认领码，认领之后设备侧被清空（搬，不是抄）
 *   · 清了 cookie 后能凭账户补签凭证（账号体系存在的理由）
 *   · 重复认领不会让权益变多
 *   · 单次券消费台账挡住重放
 *   · 记录能上云、能读回、删除带 user_id 约束
 *   · 鉴权边界：无 token / 假 token 一律 401
 *
 * 真机联调仍然必须做 —— 这个脚本证明的是代码，不是 Supabase。
 *
 * 用法：
 *   node tests/mock-supabase.mjs 54321            # 终端 A
 *   # 用指向桩的环境变量启动 dev server            # 终端 B
 *   APP_URL=http://localhost:3121 node tests/account-e2e.mjs
 */
const APP = process.env.APP_URL ?? "http://localhost:3121";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:54321";

let failures = 0;
const line = (s) => console.log(`\n=== ${s} ===`);
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
};

// ── 工具 ────────────────────────────────────────────────────
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 生成一个**保证合法**的激活码。
 *
 * 手工写码踩过两次：`...SINGLE1A` 含 I、`...FOCUS01AAAA` 含 O 且只有 15 位 ——
 * 两者都被格式校验拒掉，而错误信息只说"激活码无效"，很容易误判成实现有问题。
 * 所以直接按字母表拼，不再手写。（Crockford 去掉 I L O U 正是为了避免看错。）
 */
function makeCode(seed) {
  let out = "XBAZ";
  for (const ch of seed.toUpperCase().replace(/[^0-9A-Z]/g, "")) {
    if (out.length >= 16) break;
    out += CODE_ALPHABET.includes(ch) ? ch : "7";
  }
  while (out.length < 16) out += CODE_ALPHABET[out.length % 32];
  if (out.length !== 16) throw new Error(`码生成失败：${out}`);
  return out;
}

const readCookie = (res, name) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = new RegExp(`^${name}=([^;]+)`).exec(c);
    if (m) return m[1];
  }
  return null;
};
const readPass = (res) => readCookie(res, "xj_pass");
const readDev = (res) => readCookie(res, "xj_dev");

const decode = (t) => {
  const p = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(p + "=".repeat((4 - (p.length % 4)) % 4), "base64").toString("utf8"));
};

const BIRTH = { mode: "bazi", calendar: "solar", birthDate: "1990-05-15", birthTime: "10:30", gender: "male" };
const post = (p, body, extra = {}) =>
  fetch(`${APP}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  });

const seedCode = (code, kind = "single", mode = "bazi", days = 0) =>
  fetch(`${MOCK}/__test__/seed-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, kind, mode, days }),
  });

const mintSession = async (email) =>
  (
    await (
      await fetch(`${MOCK}/__test__/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
    ).json()
  ).access_token;

const mockAccount = async (auth) =>
  (await fetch(`${MOCK}/__test__/account`, { headers: auth })).json();

// 每次运行用不同的码与邮箱，避免桩里上一轮的状态干扰（桩是常驻进程）
const RUN = Date.now().toString(36).toUpperCase();
const CODE_PASS = makeCode(`P1${RUN}`);
const CODE_PASS2_RAW = makeCode(`P2${RUN}`);
const CODE_MEMBER = makeCode(`M1${RUN}`);
const EMAIL = `e2e-${RUN.toLowerCase()}@example.com`;

// 每轮开头清空桩的状态。
// 桩是常驻进程，上一轮的用量会累积到兑换接口的按 IP 日限
// （REDEEM_IP_DAILY_LIMIT=10）上，第二轮开始就会莫名 429 —— 那是实现正确。
await fetch(`${MOCK}/__test__/reset`, { method: "POST" });

// ── 1. 未登录兑换 → 权益双写 ───────────────────────────────
line("1. 未登录兑换单次码：cookie 与设备镜像应同时有");
await seedCode(CODE_PASS);
let r = await post("/api/redeem", { code: CODE_PASS });
let body = await r.json();
const pass0 = readPass(r);
const dev0 = readDev(r);
check("兑换成功", r.status === 200 && body.success === true, `HTTP ${r.status}`);
check("签发了权益凭证", !!pass0);
check("签发了设备 cookie", !!dev0, "没有它，登录后就没东西可迁移");

if (!pass0 || !dev0) {
  console.log("\n前置条件不成立，后续用例无法进行。");
  process.exit(1);
}

check("凭证载荷含唯一编号 tid", !!decode(pass0).tid, `tid=${decode(pass0).tid.slice(0, 8)}…`);

// ── 2. 持凭证排盘 ──────────────────────────────────────────
line("2. 持凭证排盘：应放行");
r = await post("/api/fortune", BIRTH, { Cookie: `xj_pass=${pass0}; xj_dev=${dev0}` });
body = await r.json();
check("放行并真实解读", r.status === 200 && body.success === true, `via=${body.via}`);

// ── 3. 登录态下申请认领码 ─────────────────────────────────
line("3. 登录后申请认领码");
const token = await mintSession(EMAIL);
const auth = { Authorization: `Bearer ${token}` };

r = await post("/api/account/link", {}, { ...auth, Cookie: `xj_pass=${pass0}; xj_dev=${dev0}` });
body = await r.json();
const linkCode = body.code;
check("签发了认领码", r.status === 200 && typeof linkCode === "string", `code=${linkCode}`);
check("原因不是 no_credential", body.reason !== "no_credential");

// ── 4. 认领：搬进账户 ─────────────────────────────────────
line("4. 认领：权益从设备搬进账户，并清掉本机凭证");
r = await post("/api/account/claim", { code: linkCode }, auth);
body = await r.json();
check("认领成功", r.status === 200 && body.success === true, JSON.stringify(body.entitlement));
check("账户拿到 1 次 bazi", body.entitlement?.passes?.[0]?.remaining === 1);
check("响应清除了本机凭证", readPass(r) === null, "认领后设备侧不该再留一份");

const acct1 = await mockAccount(auth);
check("设备镜像已清空（搬，不是抄）", acct1.device_entitlements.length === 0, JSON.stringify(acct1.device_entitlements));
check("账户权益已落库", acct1.entitlement?.passes?.[0]?.n === 1);

// ── 5. 重复认领 ───────────────────────────────────────────
line("5. 同一个认领码再认领一次（应失败且权益不变）");
r = await post("/api/account/claim", { code: linkCode }, auth);
check("重复认领被拒", r.status === 400, `HTTP ${r.status}`);
const acct2 = await mockAccount(auth);
check("权益没有被加第二次", acct2.entitlement?.passes?.[0]?.n === 1, `n=${acct2.entitlement?.passes?.[0]?.n}`);

// ── 6. 账户权益查询 ───────────────────────────────────────
line("6. 查询账户权益（不依赖本机 cookie）");
r = await fetch(`${APP}/api/account/entitlement`, { headers: auth });
body = await r.json();
check("读到账户权益", r.status === 200 && body.entitlement?.passes?.[0]?.remaining === 1);
check("附带邮箱", body.email === EMAIL, body.email);

// ── 7. 清了 cookie，凭账户恢复 ────────────────────────────
line("7. 模拟用户清了 cookie：不带 xj_pass 与 xj_dev，仅凭登录态排盘");
r = await post("/api/fortune", BIRTH, auth);
body = await r.json();
check("凭账户补签凭证并放行", r.status === 200 && body.success === true, `HTTP ${r.status} via=${body.via} err=${body.error ?? ""}`);
// 券只有 1 次，用掉即归零 —— 此时**清除** cookie 才是正确表现
// （而不是写一个 n:0 的空壳回去）
check("券用尽后 cookie 被清除", readPass(r) === null, "1 次券用掉后就该消失");

// ── 8. 重放被台账拦住 ─────────────────────────────────────
line("8. 补签凭证的重放应被台账拦住");
// 先再充一张券：第 7 步已经把账户里那张用掉了（回写归零 → cookie 被清除，
// 这正是"券用完就该消失"的正确表现）。
await seedCode(CODE_PASS2_RAW);
r = await post("/api/redeem", { code: CODE_PASS2_RAW });
body = await r.json();
const passB = readPass(r);
const devB = readDev(r);
check("补充券兑换成功", r.status === 200 && body.entitlement?.passes?.[0]?.remaining === 1, `HTTP ${r.status}`);

r = await post("/api/account/link", {}, { ...auth, Cookie: `xj_pass=${passB}; xj_dev=${devB}` });
const linkB = (await r.json()).code;
check("签发认领码", typeof linkB === "string");

r = await post("/api/account/claim", { code: linkB }, auth);
check("并入账户", r.status === 200, JSON.stringify((await r.json()).entitlement));

// 清掉本机 cookie，只带登录态：这次会从账户补签一份凭证
r = await post("/api/fortune", BIRTH, auth);
check("第 1 次放行（补签）", r.status === 200, `HTTP ${r.status}`);
const accPass = readPass(r);
check("拿到补签凭证", !!accPass);

if (accPass) {
  // 重放**同一份**补签凭证。这是关键一击：若无稳定编号，
  // 每次请求都会以新 tid 记账，同一张券能被无限用。
  r = await post("/api/fortune", BIRTH, { ...auth, Cookie: `xj_pass=${accPass}` });
  check("第 2 次重放被拦", r.status === 403, `HTTP ${r.status}`);

  r = await post("/api/fortune", BIRTH, { ...auth, Cookie: `xj_pass=${accPass}` });
  check("第 3 次重放仍被拦", r.status === 403, `HTTP ${r.status}`);
}

// ── 9. 记录上云 ───────────────────────────────────────────
line("9. 记录上云：保存 / 读回 / 删除带 user_id 约束");
r = await post(
  "/api/account/readings",
  { mode: "bazi", title: "八字命理", result: "【命局总评】结论：端到端测试。".repeat(4), input: { calendar: "solar", province: "北京市" } },
  auth
);
body = await r.json();
check("保存成功", r.status === 200 && body.success === true);
const readingId = body.reading?.id;

r = await fetch(`${APP}/api/account/readings`, { headers: auth });
body = await r.json();
check("读回 1 条", body.readings?.length === 1, `len=${body.readings?.length}`);
check("出生信息随记录保存", body.readings?.[0]?.input?.province === "北京市");

await fetch(`${APP}/api/account/readings?id=00000000-0000-0000-0000-000000000000`, { method: "DELETE", headers: auth });
body = await (await fetch(`${APP}/api/account/readings`, { headers: auth })).json();
check("删别人的 id 不影响自己的记录", body.readings?.length === 1);

if (readingId) {
  await fetch(`${APP}/api/account/readings?id=${readingId}`, { method: "DELETE", headers: auth });
  body = await (await fetch(`${APP}/api/account/readings`, { headers: auth })).json();
  check("删自己的记录成功", body.readings?.length === 0, `len=${body.readings?.length}`);
}

// ── 10. 鉴权边界 ─────────────────────────────────────────
line("10. 鉴权边界：无 token / 假 token 一律 401");
for (const [label, h] of [["无 token", {}], ["假 token", { Authorization: "Bearer forged" }]]) {
  const rr = await fetch(`${APP}/api/account/readings`, { headers: h });
  check(`${label} 读记录被拒`, rr.status === 401, `HTTP ${rr.status}`);
  const rl = await post("/api/account/link", {}, h);
  check(`${label} 申请认领码被拒`, rl.status === 401, `HTTP ${rl.status}`);
  const rc = await post("/api/account/claim", { code: "AAAAAAAAAAAAAAAA" }, h);
  check(`${label} 认领被拒`, rc.status === 401, `HTTP ${rc.status}`);
}

// ── 11. 会员码并入账户 ───────────────────────────────────
line("11. 会员码并入账户");
await seedCode(CODE_MEMBER, "member", null, 30);
r = await post("/api/redeem", { code: CODE_MEMBER });
body = await r.json();
const passM = readPass(r);
const devM = readDev(r);
check("会员码兑换成功", r.status === 200 && body.entitlement?.member === true, JSON.stringify(body.entitlement));

r = await post("/api/account/link", {}, { ...auth, Cookie: `xj_pass=${passM}; xj_dev=${devM}` });
const linkM = (await r.json()).code;
check("签发了认领码", typeof linkM === "string");

r = await post("/api/account/claim", { code: linkM }, auth);
body = await r.json();
check("会员已并入账户", r.status === 200 && body.entitlement?.member === true, JSON.stringify(body.entitlement));

r = await fetch(`${APP}/api/account/entitlement`, { headers: auth });
body = await r.json();
check("账户侧确认是会员", body.entitlement?.member === true);

const acctFinal = await mockAccount(auth);
check("设备镜像再次清空", acctFinal.device_entitlements.length === 0);

// ── 12. 选错的码不该消耗配额 ──────────────────────────────
line("12. 非法码不消耗服务端资源");
r = await post("/api/redeem", { code: "IIIIIIIIIIIIIIII" });
check("含非法字符的 16 位码 400", r.status === 400, `HTTP ${r.status}`);
r = await post("/api/redeem", { code: "SHORT" });
check("短码 400", r.status === 400, `HTTP ${r.status}`);

console.log(`\n${failures === 0 ? "全部通过" : `有 ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
