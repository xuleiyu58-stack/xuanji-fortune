/**
 * 本地 Supabase 桩（mock）。
 *
 * 存在的理由：账号体系的代码在拿到真实 Supabase 项目之前**无法被验证** ——
 * 而"没验证过的代码"正是这个项目已经吃过一次亏的地方（收费闭环整套写好了、
 * 测试全绿，却从来没被接上）。
 *
 * 它实现的是 supabase-js 与本站实际用到的那部分 PostgREST / Auth 协议，
 * 以及 supabase/*.sql 里那几个数据库函数的语义。**不追求完整**：
 * 只覆盖 src/ 里真实调用到的那几个端点。
 *
 * 它能证明什么：路由接线、鉴权边界、权益合并行为、认领是"搬"不是"抄"、
 * 单次券重放被挡。
 * 它不能证明什么：Supabase 自身的正确性、RLS 策略、真实 SQL 函数的语法 ——
 * 那些必须用真项目跑 `supabase/*.sql` 来验。所以这个桩不能替代真机联调。
 *
 * 用法：
 *   node tests/mock-supabase.mjs 54321
 *   # 另开终端，用指向它的环境变量启动 dev server：
 *   #   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 *   #   SUPABASE_SERVICE_ROLE_KEY=test-service-role
 *   #   NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon
 */
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";

const PORT = Number(process.argv[2] ?? 54321);
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ── 内存表 ──────────────────────────────────────────────────
const db = {
  usage: new Map(),            // `${key}|${day}` -> count
  redeem_codes: new Map(),     // code -> { kind, mode, days, redeemed_at, redeemed_by, batch }
  account_entitlements: new Map(), // user_id -> { member, passes }
  device_entitlements: new Map(),  // device_id -> { member, passes }
  link_codes: new Map(),       // code -> { device_id, expires_at, used_at }
  pass_consumptions: new Set(),// pass_id
  readings: [],                // { id, user_id, mode, title, result, input, created_at }
  otp: new Map(),              // email -> token（仅用于日志）
};

/** 每个 token 对应的用户。真实 Supabase 用 JWT，这里用注册表即可。 */
const sessions = new Map();    // access_token -> { id, email }

function day() {
  // 与 usage-store 的 today() 同口径：北京时间的自然日
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 与 lib/entitlement-merge.ts 的 mergeEntitlements 同语义 */
function mergeEnt(a, b) {
  const member =
    a.member === null || a.member === undefined
      ? (b.member ?? null)
      : b.member === null || b.member === undefined
        ? a.member
        : Math.max(a.member, b.member);

  const byMode = new Map();
  for (const p of [...(a.passes ?? []), ...(b.passes ?? [])]) {
    const prev = byMode.get(p.m);
    byMode.set(p.m, prev ? { m: p.m, n: prev.n + p.n, e: Math.max(prev.e, p.e) } : { ...p });
  }
  return { member, passes: [...byMode.values()] };
}

// ── HTTP 工具 ───────────────────────────────────────────────

/**
 * 浏览器端的 supabase-js（verifyOtp 等）是**从页面直接**打这个桩的，
 * 而页面在 localhost:3xxx、桩在 127.0.0.1:54321 —— 跨源。
 * 没有 CORS 头的话，预检就失败，请求根本不会到达这里，
 * 表现是"验证码不正确"这种看不出真因的错误。
 *
 * 真实 Supabase 自带完整 CORS；桩必须自己补上，否则浏览器链路测不了。
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,accept,prefer,x-client-info,x-supabase-api-version",
  "Access-Control-Expose-Headers": "content-range",
  "Access-Control-Max-Age": "86400",
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 解析 `?a=eq.1&b=is.null` 这类 PostgREST 过滤 */
function parseFilters(url) {
  const out = [];
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const dot = v.indexOf(".");
    if (dot < 0) continue;
    out.push({ col: k, op: v.slice(0, dot), val: v.slice(dot + 1) });
  }
  return out;
}

function matches(row, filters) {
  return filters.every(({ col, op, val }) => {
    const cur = row[col];
    if (op === "eq") return String(cur) === val;
    if (op === "is") return val === "null" ? cur === null || cur === undefined : String(cur) === val;
    return true;
  });
}

function orderRows(rows, url) {
  const order = url.searchParams.get("order");
  if (!order) return rows;
  // 形如 `created_at.desc`
  const [col, dir] = order.split(".");
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[col];
    const y = b[col];
    if (x === y) return 0;
    return (x > y ? 1 : -1) * sign;
  });
}

// ── 路由 ────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // 预检直接放行。浏览器端的 supabase-js 是跨源打过来的，少了这一步
  // 请求根本到不了下面的路由。
  if (method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // ── Auth ────────────────────────────────────────────────
  if (path === "/auth/v1/user" && method === "GET") {
    const auth = req.headers.authorization ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const user = sessions.get(token);
    if (!user) return json(res, 401, { message: "invalid token" });
    return json(res, 200, { id: user.id, email: user.email, aud: "authenticated" });
  }

  if (path === "/auth/v1/otp" && method === "POST") {
    const body = await readBody(req);
    const email = String(body?.email ?? "").toLowerCase();
    if (!email) return json(res, 400, { message: "email required" });

    // 真实 Supabase 会发信；这里把 token 打到控制台，方便手工走 UI 流程
    const token = String(Math.floor(100000 + Math.random() * 900000));
    db.otp.set(email, token);
    console.log(`[mock-supabase] OTP for ${email}: ${token}`);

    // 不自动建会话 —— 真实流程是用户拿 token 再调 /auth/v1/verify。
    // 但那一步在浏览器端由 supabase-js 完成，服务端桩测不到；
    // 这里附带提供一个 /__test__/session 端点供端到端脚本直接拿 token。
    return json(res, 200, {});
  }

  // 真实的验证码校验。浏览器端 supabase-js 的 verifyOtp() 打的就是这个端点，
  // 所以实现它之后，"在真浏览器里走完整个登录表单"成为可能 ——
  // 这比注入会话更接近真实路径（只差"邮件真的发出去"那一步）。
  if (path === "/auth/v1/verify" && method === "POST") {
    const body = await readBody(req);
    const email = String(body?.email ?? "").toLowerCase();
    const token = String(body?.token ?? "");
    const expected = db.otp.get(email);

    if (!expected) {
      return json(res, 401, { error: "otp_expired", error_description: "验证码不存在或已过期" });
    }
    if (token !== expected) {
      return json(res, 401, { error: "invalid_otp", error_description: "验证码不正确" });
    }

    db.otp.delete(email); // 一次性
    const existing = [...sessions.values()].find((u) => u.email === email);
    const user = existing ?? { id: randomUUID(), email };
    const access_token = randomBytes(16).toString("base64url");
    sessions.set(access_token, user);

    // 形状与真实 GoTrue 的 session 对齐，supabase-js 靠它落盘
    return json(res, 200, {
      access_token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: randomBytes(12).toString("base64url"),
      user: {
        id: user.id,
        email: user.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    });
  }

  // 刷新会话。access_token 过期时 supabase-js 会打这里。
  // 桩里的 token 不设过期，直接原样换一个回来即可。
  if (path === "/auth/v1/token" && method === "POST") {
    const body = await readBody(req);
    // 刷新请求不带旧 access_token，桩里无法反查用户 —— 返回 400 让客户端
    // 走"会话失效"分支（与真实环境里 refresh_token 过期时一致）。
    if (body?.grant_type === "refresh_token") {
      return json(res, 400, { error: "invalid_grant", error_description: "mock 不支持刷新" });
    }
    return json(res, 400, { error: "unsupported" });
  }

  // 仅测试用：直接开一个会话（等价于绕过浏览器完成 verifyOtp）
  if (path === "/__test__/session" && method === "POST") {
    const body = await readBody(req);
    const email = String(body?.email ?? "tester@example.com").toLowerCase();
    const existing = [...sessions.values()].find((u) => u.email === email);
    const user = existing ?? { id: randomUUID(), email };
    const token = randomBytes(16).toString("base64url");
    sessions.set(token, user);
    return json(res, 200, { access_token: token, user });
  }

  // ── RPC ─────────────────────────────────────────────────
  if (path.startsWith("/rest/v1/rpc/") && method === "POST") {
    const fn = path.slice("/rest/v1/rpc/".length);
    const args = (await readBody(req)) ?? {};

    if (fn === "bump_usage") {
      const k = `${args.k}|${day()}`;
      db.usage.set(k, (db.usage.get(k) ?? 0) + 1);
      return json(res, 200, null);
    }

    if (fn === "redeem_code") {
      const row = db.redeem_codes.get(args.c);
      if (!row || row.redeemed_at) return json(res, 200, []);
      row.redeemed_at = new Date().toISOString();
      row.redeemed_by = args.who;
      return json(res, 200, [{ kind: row.kind, mode: row.mode, days: row.days }]);
    }

    if (fn === "claim_link_code") {
      const row = db.link_codes.get(args.c);
      const now = new Date(args.now_ts);
      if (!row || row.used_at || new Date(row.expires_at) <= now) return json(res, 200, []);
      row.used_at = now.toISOString();
      return json(res, 200, [{ device_id: row.device_id }]);
    }

    if (fn === "claim_device_entitlement") {
      // 搬走：先删除再合并。与 supabase/accounts.sql 的语义一致。
      const held = db.device_entitlements.get(args.dev);
      if (!held) return json(res, 200, false);
      db.device_entitlements.delete(args.dev);
      const cur = db.account_entitlements.get(args.uid) ?? { member: null, passes: [] };
      db.account_entitlements.set(args.uid, mergeEnt(cur, held));
      return json(res, 200, true);
    }

    if (fn === "merge_entitlement") {
      const cur = db.account_entitlements.get(args.uid) ?? { member: null, passes: [] };
      const now = Math.floor(new Date(args.now_ts).getTime() / 1000);
      const member =
        args.add_member > 0
          ? Math.max(cur.member ?? 0, now) + args.add_member
          : cur.member;
      db.account_entitlements.set(
        args.uid,
        mergeEnt({ ...cur, member }, { member: null, passes: args.add_passes ?? [] })
      );
      return json(res, 200, null);
    }

    return json(res, 404, { message: `unknown rpc ${fn}` });
  }

  // ── REST 表 ──────────────────────────────────────────────
  if (path.startsWith("/rest/v1/")) {
    const table = path.slice("/rest/v1/".length);
    const filters = parseFilters(url);

    // usage：count 是唯一的数字列
    if (table === "usage") {
      if (method === "GET") {
        const rows = [];
        for (const [k, count] of db.usage) {
          const [key, d] = k.split("|");
          rows.push({ key, day: d, count });
        }
        const hit = rows.filter((r) => matches(r, filters));
        // .maybeSingle() 会带 Accept: application/vnd.pgrst.object+json
        const wantsSingle = (req.headers.accept ?? "").includes("pgrst.object");
        if (wantsSingle) {
          return hit.length ? json(res, 200, hit[0]) : json(res, 406, { message: "no rows" });
        }
        return json(res, 200, hit);
      }
    }

    if (table === "account_entitlements" || table === "device_entitlements") {
      const idCol = table === "account_entitlements" ? "user_id" : "device_id";
      if (method === "GET") {
        const rows = [...db[table]].map(([id, v]) => ({ [idCol]: id, ...v }));
        const hit = rows.filter((r) => matches(r, filters));
        const wantsSingle = (req.headers.accept ?? "").includes("pgrst.object");
        if (wantsSingle) {
          return hit.length ? json(res, 200, hit[0]) : json(res, 406, { message: "no rows" });
        }
        return json(res, 200, hit);
      }
      if (method === "POST") {
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) db[table].set(r[idCol], { member: r.member ?? null, passes: r.passes ?? [] });
        return json(res, 201, null);
      }
    }

    if (table === "pass_consumptions") {
      if (method === "POST") {
        const body = await readBody(req);
        const id = body.pass_id;
        // 主键冲突 → 23505，正是代码依赖的那条分支
        if (db.pass_consumptions.has(id)) {
          return json(res, 409, { code: "23505", message: "duplicate key value" });
        }
        db.pass_consumptions.add(id);
        return json(res, 201, null);
      }
      if (method === "GET") {
        const wantsSingle = (req.headers.accept ?? "").includes("pgrst.object");
        const rows = [...db.pass_consumptions].map((id) => ({ pass_id: id }));
        const hit = rows.filter((r) => matches(r, filters));
        if (wantsSingle) {
          return hit.length ? json(res, 200, hit[0]) : json(res, 406, { message: "no rows" });
        }
        return json(res, 200, hit);
      }
      if (method === "DELETE") {
        for (const { col, op, val } of filters) {
          if (op === "eq" && col === "pass_id") db.pass_consumptions.delete(val);
        }
        return json(res, 200, null);
      }
    }

    if (table === "link_codes") {
      if (method === "POST") {
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) {
          if (db.link_codes.has(r.code)) {
            return json(res, 409, { code: "23505", message: "duplicate key value" });
          }
          db.link_codes.set(r.code, { ...r, used_at: null });
        }
        return json(res, 201, null);
      }
      // GET 供 check-supabase.mjs 做只读探测用
      if (method === "GET") {
        const rows = [...db.link_codes.entries()].map(([code, v]) => ({ code, ...v }));
        const hit = rows.filter((r) => matches(r, filters));
        const wantsSingle = (req.headers.accept ?? "").includes("pgrst.object");
        if (wantsSingle) {
          return hit.length ? json(res, 200, hit[0]) : json(res, 406, { message: "no rows" });
        }
        return json(res, 200, hit);
      }
    }

    if (table === "redeem_codes") {
      // 只读探测（体检脚本用）。真实核销走 rpc/redeem_code，不经过 REST。
      if (method === "GET") {
        const rows = [...db.redeem_codes.entries()].map(([code, v]) => ({ code, ...v }));
        const hit = rows.filter((r) => matches(r, filters));
        const wantsSingle = (req.headers.accept ?? "").includes("pgrst.object");
        if (wantsSingle) {
          return hit.length ? json(res, 200, hit[0]) : json(res, 406, { message: "no rows" });
        }
        return json(res, 200, hit);
      }
    }

    if (table === "readings") {
      if (method === "GET") {
        const rows = orderRows(db.readings.filter((r) => matches(r, filters)), url);
        const limit = Number(url.searchParams.get("limit") ?? rows.length);
        const sliced = rows.slice(0, limit);
        const wantsSingle = (req.headers.accept ?? "").includes("pgrst.object");
        if (wantsSingle) {
          return sliced.length ? json(res, 200, sliced[0]) : json(res, 406, { message: "no rows" });
        }
        return json(res, 200, sliced);
      }
      if (method === "POST") {
        const body = await readBody(req);
        const rows = Array.isArray(body) ? body : [body];
        const created = rows.map((r) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...r,
        }));
        db.readings.push(...created);
        return json(res, 201, created);
      }
      if (method === "DELETE") {
        // 必须同时匹配 user_id 与 id —— 代码依赖这一点防止删到别人的记录
        const before = db.readings.length;
        db.readings = db.readings.filter((r) => !matches(r, filters));
        console.log(`[mock-supabase] readings delete: ${before - db.readings.length} 行`);
        return json(res, 200, null);
      }
    }

    // 文案与真实 PostgREST 对齐（"does not exist"），
    // 这样 check-supabase.mjs 里按错误文案做的分类能被真实地测到。
    return json(res, 404, {
      code: "42P01",
      message: `relation "public.${table}" does not exist`,
    });
  }

  // 测试辅助：清空全部状态。
  // 端到端脚本每轮开头都要调它 —— 桩是常驻进程，上一轮的用量计数会
  // 累积到兑换接口的按 IP 日限（REDEEM_IP_DAILY_LIMIT=10）上，
  // 于是第二轮开始就会莫名其妙地 429。那是**实现正确**，不是 bug。
  if (path === "/__test__/reset" && method === "POST") {
    db.usage.clear();
    db.redeem_codes.clear();
    db.account_entitlements.clear();
    db.device_entitlements.clear();
    db.link_codes.clear();
    db.pass_consumptions.clear();
    db.readings.length = 0;
    db.otp.clear();
    sessions.clear();
    return json(res, 200, { ok: true });
  }

  // 测试辅助：直接播种一张激活码
  if (path === "/__test__/seed-code" && method === "POST") {
    const body = await readBody(req);
    const code = String(body.code);
    db.redeem_codes.set(code, {
      kind: body.kind ?? "single",
      mode: body.mode ?? "bazi",
      days: body.days ?? 0,
      redeemed_at: null,
      redeemed_by: null,
      batch: "test",
    });
    return json(res, 200, { ok: true, code });
  }

  // 测试辅助：查看某个 token 的账户权益
  if (path === "/__test__/account" && method === "GET") {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const user = sessions.get(token);
    if (!user) return json(res, 401, { message: "invalid token" });
    return json(res, 200, {
      user,
      entitlement: db.account_entitlements.get(user.id) ?? { member: null, passes: [] },
      device_entitlements: [...db.device_entitlements.entries()].map(([id, v]) => ({ id, ...v })),
      consumed: [...db.pass_consumptions],
      readings: db.readings.filter((r) => r.user_id === user.id).length,
    });
  }

  return json(res, 404, { message: `unhandled ${method} ${path}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-supabase] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-supabase] 供 dev server 使用的环境变量：`);
  console.log(`  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PORT}`);
  console.log(`  NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY=test-service-role`);
});
