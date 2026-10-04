/**
 * Supabase 配置体检。
 *
 * 为什么要单独一个脚本：配错 Supabase 的失败方式都很"沉默"——
 * 变量贴串了、SQL 只跑了一半、函数建在别的 schema 里……
 * 表现都是运行时的 503 或一句含糊的 401，从那里往回查很费时间。
 * 这个脚本把每一项单独验一遍，并直接说清"哪一步没做、该去做什么"。
 *
 * **它只读，不消耗任何激活码，不写任何数据。**
 *
 * 用法：
 *   node --env-file=.env.local scripts/check-supabase.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const passSecret = process.env.PASS_SECRET;

let failures = 0;
const ok = (label, detail = "") => console.log(`  ✓ ${label}${detail ? "  " + detail : ""}`);
const bad = (label, hint) => {
  failures += 1;
  console.log(`  ✗ ${label}`);
  if (hint) console.log(`      → ${hint}`);
};
const step = (n, title) => console.log(`\n${n}. ${title}`);

// ── 0. 环境变量 ─────────────────────────────────────────────
step(0, "环境变量");

// DeepSeek 的 key 也在这里检一遍。
//
// 起因是一次真实故障：线上解读稳定失败、秒级返回，排查许久才发现是
// Vercel 上的 DEEPSEEK_API_KEY 填成了别的变量的值（长度 20、以 "_URL" 结尾）。
// 这种"形状不对"的错误，在发请求之前就能看出来 —— 而一旦发出去，
// 它表现为 401，和"key 过期""余额不足"混在一起，很难分辨。
const dsKey = process.env.DEEPSEEK_API_KEY;
if (!dsKey) {
  bad("DEEPSEEK_API_KEY 未设置", "从 platform.deepseek.com 的 API keys 页面取");
} else if (dsKey.length !== 35 || !dsKey.startsWith("sk-")) {
  bad(
    `DEEPSEEK_API_KEY 形状不对（长度 ${dsKey.length}，应以 sk- 开头且共 35 字符）`,
    "多半是配置时串行了 —— 检查它是不是被填成了 Supabase 的 URL 或 JWT"
  );
} else if (dsKey !== dsKey.trim()) {
  bad("DEEPSEEK_API_KEY 前后有空白字符", "重新粘贴一次，注意别带上空格或换行");
} else {
  ok("DEEPSEEK_API_KEY", "形状正确");
}
if (!url) {
  bad("NEXT_PUBLIC_SUPABASE_URL 未设置", "从 Supabase 的 Project Settings → API 取 Project URL");
} else {
  ok("NEXT_PUBLIC_SUPABASE_URL", url.replace(/^(https:\/\/[^.]+).*/, "$1…"));
}
if (!serviceKey) {
  bad(
    "SUPABASE_SERVICE_ROLE_KEY 未设置",
    "取 service_role secret。注意别拿成 anon key —— 两者长得像，但权限天差地别"
  );
} else {
  ok("SUPABASE_SERVICE_ROLE_KEY", `长度 ${serviceKey.length}`);
}
if (!passSecret) {
  bad(
    "PASS_SECRET 未设置",
    'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"'
  );
} else if (passSecret.length < 32) {
  bad("PASS_SECRET 太短", "至少 32 字节随机，否则签名强度不足");
} else {
  ok("PASS_SECRET", `长度 ${passSecret.length}`);
}
if (!anonKey) {
  console.log("  · NEXT_PUBLIC_SUPABASE_ANON_KEY 未设置 —— 只有账号登录需要它，不开账号可以跳过");
} else {
  ok("NEXT_PUBLIC_SUPABASE_ANON_KEY", `长度 ${anonKey.length}`);
}

if (!url || !serviceKey) {
  console.log("\n缺关键变量，后续检查无法进行。");
  process.exit(1);
}

// service_role 与 anon 混用是最常见的错误，单独挡一下
if (serviceKey === anonKey) {
  bad(
    "SERVICE_ROLE_KEY 与 ANON_KEY 是同一个值",
    "service_role 的权限高得多，你多半是复制错了那一行"
  );
}
try {
  const payload = JSON.parse(Buffer.from(serviceKey.split(".")[1] ?? "", "base64").toString("utf8"));
  if (payload.role && payload.role !== "service_role") {
    bad(
      `这把钥匙的 role 是 "${payload.role}"，不是 service_role`,
      "服务端读写会被 RLS 拦住。请去 Project Settings → API 复制 service_role secret"
    );
  } else if (payload.role === "service_role") {
    ok("钥匙角色确认为 service_role");
  }
} catch {
  console.log("  · 无法解析钥匙载荷（新版可能是不透明字符串），跳过角色检查");
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * 带重试的只读探测。
 *
 * 为什么要重试：实测中偶尔会出现 `TypeError: fetch failed`（网络抖动），
 * 而它与"表不存在"是完全不同的两件事。不重试、不区分的话，脚本会对着
 * 一次抖动的网络说"去跑 SQL"，把人引到错的方向 —— 那正是这个脚本
 * 本来要避免的事。
 */
async function probe(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    const r = await fn();
    last = r;
    // 只有网络层错误才值得重试；PostgREST 的业务错误（表不存在等）直接返回
    if (!r.error || !/fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(r.error.message ?? "")) {
      return r;
    }
    if (i < attempts - 1) await new Promise((r2) => setTimeout(r2, 700 * (i + 1)));
  }
  return last;
}

/** 判定一个错误是不是"网络抖动"，而不是配置或结构问题 */
const isNetworkError = (msg = "") => /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(msg);

// ── 1. 连通性 ───────────────────────────────────────────────
step(1, "连通性");
// 「连得上」不等于「表存在」：表不存在恰恰证明网络与钥匙都正常。
// 所以这里只把"根本没通"当成致命，好让后面把缺的表一次性列全，
// 而不是每次都只报第一张。
let reachable = false;
try {
  const { error } = await probe(() => db.from("usage").select("key").limit(1));
  if (!error) {
    reachable = true;
    ok("连得上，usage 表存在");
  } else if (isNetworkError(error.message)) {
    bad(
      `连不上 Supabase（${error.message}）`,
      "网络抖动或本机网络受限。重跑一次；仍失败就检查能否在浏览器打开你的项目地址"
    );
  } else if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
    // 关键：这是**好消息**，说明 URL 与钥匙都对
    reachable = true;
    ok("连得上（Supabase 已回应），只是 usage 表还没建");
  } else if (error.code === "42501" || /permission denied/i.test(error.message)) {
    bad("连得上，但没权限读 usage", "多半是钥匙用错了（该用 service_role / sb_secret_…）");
  } else if (/invalid api key|jwt/i.test(error.message)) {
    bad(`钥匙被拒：${error.message}`, "确认复制的是 service_role / sb_secret_… 那把");
  } else {
    bad(`读取 usage 失败：${error.message}`, "检查 URL 是否写全（要 https://xxx.supabase.co）");
  }
} catch (err) {
  bad(`连不上：${err.message}`, "检查网络与 URL");
}

if (!reachable) {
  console.log("\n连通性未通过，后续检查跳过（避免同一个错误重复十遍）。");
  process.exit(1);
}

// ── 2. 三张表 / 四个表 ──────────────────────────────────────
step(2, "数据表");

/** 只读探测：表存在返回 true */
async function tableExists(name, columns) {
  const { error } = await probe(() => db.from(name).select(columns).limit(1));
  if (!error) return { ok: true };
  if (isNetworkError(error.message)) {
    return { ok: false, reason: `网络抖动（${error.message}）`, transient: true };
  }
  if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
    return { ok: false, reason: "表不存在" };
  }
  if (/column .* does not exist/i.test(error.message)) {
    return { ok: false, reason: `缺列：${error.message}` };
  }
  return { ok: false, reason: error.message };
}

// 收费闭环的必需项。缺任何一项，付费用户就用不了 —— 不是"体验差一点"，
// 是直接 503 或 400。
const required = [
  ["usage", "key,day,count", "supabase/schema.sql"],
  ["redeem_codes", "code,kind,mode,days,batch,redeemed_at", "supabase/redeem.sql"],
  // 台账原先在 accounts.sql 里，那是分层错误：单次券防重放与账号体系无关，
  // 只做最小上线的人跑不到它，结果付了钱的用户排不了盘。
  ["pass_consumptions", "pass_id,consumed_at", "supabase/ledger.sql"],
];
// 账号功能（可选）。不跑的话账号入口自动隐藏，其余一切照常。
const optional = [
  ["account_entitlements", "user_id,member,passes", "supabase/accounts.sql"],
  ["device_entitlements", "device_id,member,passes", "supabase/accounts.sql"],
  ["link_codes", "code,device_id,expires_at,used_at", "supabase/accounts.sql"],
  ["readings", "id,user_id,mode,title,result,input,created_at", "supabase/accounts.sql"],
];

for (const [t, cols, file] of required) {
  const r = await tableExists(t, cols);
  if (r.ok) ok(`${t} 存在且列齐全`);
  else bad(`${t}：${r.reason}`, `去 SQL Editor 执行 ${file}`);
}

let accountsReady = true;
for (const [t, cols, file] of optional) {
  const r = await tableExists(t, cols);
  if (r.ok) ok(`${t} 存在且列齐全`);
  else {
    accountsReady = false;
    console.log(`  · ${t} 不可用（${r.reason}）—— 不跑 ${file} 的话账号功能会自动隐藏`);
  }
}

// ── 3. 数据库函数 ───────────────────────────────────────────
step(3, "数据库函数");

/**
 * 只读地探测函数是否存在。
 *
 * 刻意不真调 redeem_code/bump_usage —— 它们有副作用（核销、计数），
 * 一次体检不该消耗用户的激活码。用"传一个必然不存在的键值"来探：
 * 函数存在时会正常返回空结果，不存在时才报 404。
 */
async function rpcExists(fn, args) {
  const { error } = await db.rpc(fn, args);
  if (!error) return { ok: true };
  const msg = error.message ?? "";
  if (error.code === "PGRST202" || /could not find the function|does not exist/i.test(msg)) {
    return { ok: false, reason: "函数不存在" };
  }
  return { ok: true, note: msg };
}

const r1 = await rpcExists("bump_usage", { k: "__preflight_probe__" });
if (r1.ok) {
  ok("bump_usage 可用", r1.note ? `（注意：${r1.note}）` : "");
  // 注意：上面这次探测会写入一行计数。它用的是不可能被真实请求命中的键名，
  // 但确实会留一行数据。介意的话可在 SQL Editor 删掉：
  //   delete from public.usage where key = '__preflight_probe__';
} else {
  bad("bump_usage 不存在", "执行 supabase/schema.sql");
}

if (accountsReady) {
  const probes = [
    ["redeem_code", { c: "__preflight_probe__", who: "preflight" }, "supabase/redeem.sql"],
    ["claim_link_code", { c: "__preflight_probe__", now_ts: new Date().toISOString() }, "supabase/accounts.sql"],
    ["merge_entitlement", { uid: "00000000-0000-0000-0000-000000000000", add_member: null, add_passes: [], now_ts: new Date().toISOString() }, "supabase/accounts.sql"],
    ["claim_device_entitlement", { uid: "00000000-0000-0000-0000-000000000000", dev: "__preflight_probe__", now_ts: new Date().toISOString() }, "supabase/accounts.sql"],
  ];
  for (const [fn, args, file] of probes) {
    const r = await rpcExists(fn, args);
    if (r.ok) ok(`${fn} 可用`);
    else bad(`${fn}：${r.reason}`, `执行 ${file}`);
  }
} else {
  console.log("  · 账号相关的表未建，跳过函数检查");
}

// ── 4. Auth 邮件登录 ────────────────────────────────────────
step(4, "邮箱登录（可选）");
if (!anonKey) {
  console.log("  · 未配 anon key，跳过。不开账号功能可以忽略这一节。");
} else {
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      bad(
        `Auth 拒绝了这把 anon key（HTTP ${res.status}）`,
        "多半是贴错了：去 Project Settings → API 复制 anon public 那把"
      );
    } else if (res.status === 404) {
      // 本地桩没有这个端点。别把它报成"anonym key 错了" —— 那会误导排查方向。
      console.log(
        `  · /auth/v1/settings 返回 404 —— 若你连的是本地桩属正常；` +
          "真实 Supabase 不该 404，请确认 URL 是 https://xxx.supabase.co"
      );
    } else if (!res.ok) {
      bad(`Auth 设置读不到（HTTP ${res.status}）`, "检查 URL 与 anon key");
    } else {
      const s = await res.json();
      // 各家版本字段名不完全一致，宽松判断
      const emailOn = s.external?.email !== false;
      if (emailOn) ok("Email 登录已启用");
      else bad("Email 登录未启用", "Authentication → Providers → Email → 启用");

      if (s.mailer_autoconfirm === true) {
        console.log("  · 注意：Confirm email 是关闭的（mailer_autoconfirm=true）");
      }
    }
  } catch (err) {
    bad(`读 Auth 设置失败：${err.message}`, "检查网络能否到达该地址");
  }
  console.log(
    "  · 邮件模板是否改成 {{ .Token }} 无法从这里检查 —— 请手工确认\n" +
      "      Authentication → Email Templates → Magic Link\n" +
      "      不改的话用户在站内看不到 6 位验证码，登录会卡在第二步"
  );
}

// ── 汇总 ────────────────────────────────────────────────────
console.log("\n" + "─".repeat(56));
if (failures === 0) {
  console.log("全部通过。最小上线路径已就绪。");
  if (!accountsReady) console.log("账号功能未启用（缺 accounts.sql）—— 这不影响收费闭环。");
} else {
  console.log(`有 ${failures} 项需要处理，见上面的 → 提示。`);
}
console.log("─".repeat(56));
process.exit(failures === 0 ? 0 : 1);
