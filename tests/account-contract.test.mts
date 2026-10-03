import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * 账号体系的契约守卫。
 *
 * 路由本身依赖 Next 运行时与 Supabase，难以直接单测，所以这里断言的是
 * **契约与顺序** —— 与 route-contract.test.mts 同一个思路。
 *
 * 重点盯三件事，它们各自对应一个会真实出问题的设计决定：
 *   1. 放行热路径不许查库（每次解读都插一次数据库往返是最隐蔽的性能退化）
 *   2. 设备权益是「搬」不是「抄」（抄 = 权益复制漏洞）
 *   3. 认领码一次性且短命（否则就是可暴力枚举的权益转移通道）
 */

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/(^|\s)\/\/\s.*$/, "$1"))
    .join("\n");
}

const readCode = (rel: string) => stripComments(read(rel));

const GUARD = readCode("src/lib/server/quota-guard.ts");
const PASS_COOKIE = readCode("src/lib/server/pass-cookie.ts");
const ACCOUNT = readCode("src/lib/server/account-store.ts");
const SCHEMA = read("supabase/accounts.sql");
/** 消费台账已从 accounts.sql 拆出来。它属于收费闭环，不是账号功能。 */
const LEDGER = read("supabase/ledger.sql");

// ── 1. 热路径不查库 ────────────────────────────────────────

test("有凭证时不查库：ensurePassCookie 必须先返回现成的凭证", () => {
  // 这是整个账号设计的性能前提。顺序反了（先查库再比对 cookie），
  // 每次解读都会多一次数据库往返，而且功能上完全看不出来。
  const iExisting = PASS_COOKIE.indexOf("const existing = readEntitlement(req)");
  const iAccount = PASS_COOKIE.indexOf("await userFromRequest(req)");
  assert.ok(iExisting >= 0, "未先读本机凭证");
  assert.ok(iAccount >= 0, "未回退到账户");
  assert.ok(
    iExisting < iAccount,
    "必须先看本机凭证、再考虑查账户 —— 否则每次解读都要查一次库"
  );
  assert.match(
    PASS_COOKIE,
    /if \(existing\) return \{ entitlement: existing, reissued: null \}/,
    "有凭证时应直接返回，不得继续走到查库那一步"
  );
});

test("quota-guard 只通过 ensurePassCookie 取权益，不自己查账户表", () => {
  assert.match(GUARD, /ensurePassCookie\(req\)/, "guard 应调用 ensurePassCookie");
  assert.doesNotMatch(
    GUARD,
    /readAccountEntitlement|account_entitlements|from\(["']account/,
    "guard 不得直接读账户表 —— 权益读取必须收敛在 ensurePassCookie 一处"
  );
});

test("补签的凭证会被写回响应", () => {
  // 判断已收进 lib/auth-writeback.ts，两个入口共用同一套逻辑。
  // 此前它们各写一遍 if/else，/api/ask 就漏掉了"消费券时也要回写补签凭证"这一支。
  for (const rel of ["src/app/api/fortune/route.ts", "src/app/api/ask/route.ts"]) {
    const src = readCode(rel);
    assert.match(src, /passWriteBack\(/, `${rel} 未使用统一的回写判断`);
    assert.match(src, /reissued:\s*guard\.reissued/, `${rel} 未把补签凭证交给回写判断`);
    assert.match(src, /guard\.reissued/, `${rel} 未处理补签的凭证`);
  }

  // 回写逻辑本身：补签时必须把新凭证写回去，否则下次请求还要再查一次库
  const wb = readCode("src/lib/auth-writeback.ts");
  assert.match(wb, /return reissued \?\? null/, "无消耗时应回写补签的凭证");
  assert.match(wb, /entitlement \?\? reissued/, "消耗时应扣在补签的那份上");
});

// ── 2. 搬而不是抄 ─────────────────────────────────────────

test("设备权益用搬走（会删除），不是抄一份", () => {
  // 抄一份的后果：用户在同一台设备重新兑换一次，就能把同一份权益
  // 再认领到另一个账户上 —— 权益复制漏洞。
  assert.match(
    ACCOUNT,
    /memoryDevice\.delete\(deviceId\)/,
    "内存路径必须先删除设备侧记录"
  );
  assert.match(SCHEMA, /delete from public\.device_entitlements/i, "SQL 必须先删除设备行");
  assert.match(SCHEMA, /returning member, passes into/i, "删除时要取回权益内容");
});

test("设备权益的搬移是一个事务（数据库函数），不是应用层三步", () => {
  // 应用层做「读→合并→写」的话，两次并发认领会把同一份权益加两次
  assert.match(SCHEMA, /create or replace function public\.claim_device_entitlement/);
  assert.match(SCHEMA, /security definer/, "该函数需要 security definer 才能越过 RLS");
  assert.match(
    SCHEMA,
    /revoke all on function public\.claim_device_entitlement\([^)]*\) from anon, authenticated/,
    "数据库函数必须对 anon/authenticated 回收权限"
  );
});

test("认领时清掉本机凭证，权益只留账户那一份", () => {
  const claim = readCode("src/app/api/account/claim/route.ts");
  assert.match(claim, /clearPassCookie\(res\)/, "认领后应清掉本机 xj_pass");
  assert.doesNotMatch(
    claim,
    /withPassCookie/,
    "认领不该再签发一份本机凭证 —— 那会让同一份权益存在两处"
  );
});

// ── 3. 认领码 ─────────────────────────────────────────────

test("认领码一次性且短命", () => {
  assert.match(ACCOUNT, /LINK_CODE_TTL_MS\s*=\s*10 \* 60 \* 1000/, "认领码有效期应为 10 分钟");
  assert.match(SCHEMA, /used_at\s+timestamptz/, "认领码表需要 used_at 字段");
  assert.match(
    SCHEMA,
    /where code = c\s*\n\s*and used_at is null\s*\n\s*and expires_at > now_ts/,
    "核销必须同时校验未用过与未过期"
  );
});

test("认领码核销失败时不区分原因", () => {
  const claim = readCode("src/app/api/account/claim/route.ts");
  // 区分「不存在」「已用过」「已过期」等于给爆破者一个进度条
  assert.match(claim, /认领码无效或已过期/, "应统一文案");
  assert.doesNotMatch(claim, /已过期，不能再用|该码已被使用|找不到该码/, "不得区分失败原因");
});

test("签发认领码前先确认设备真的有权益", () => {
  const link = readCode("src/app/api/account/link/route.ts");
  assert.match(link, /hasAnyCredential/, "没有可迁移权益时不应签发认领码");
  assert.match(link, /xj_dev/, "认领码必须绑定设备号，否则无从查回权益");
  // 有权益却没有设备 cookie = 被人为构造过，必须拒绝
  assert.match(link, /no_device/, "缺少设备 cookie 时应拒绝签发");
});

// ── 4. 鉴权边界 ───────────────────────────────────────────

test("账户接口一律要求登录", () => {
  const routes = [
    "src/app/api/account/link/route.ts",
    "src/app/api/account/claim/route.ts",
    "src/app/api/account/entitlement/route.ts",
    "src/app/api/account/readings/route.ts",
  ];
  for (const rel of routes) {
    assert.ok(existsSync(new URL(`../${rel}`, import.meta.url)), `${rel} 不存在`);
    const src = readCode(rel);
    assert.match(src, /userFromRequest/, `${rel} 未校验登录态`);
    assert.match(src, /401/, `${rel} 未对未登录返回 401`);
  }
});

test("未读不完的登录态由 Supabase 校验，不自己解 JWT", () => {
  assert.match(ACCOUNT, /admin\(\)\.auth\.getUser\(token\)/, "应交给 Supabase 校验 token");
  assert.doesNotMatch(ACCOUNT, /jwt|decodeJwt|verifyJwt/i, "不得自己解 JWT —— 那是安全代码");
});

test("所有记录操作都按 user_id 过滤", () => {
  // id 猜对了也读不到/删不掉别人的记录
  assert.match(ACCOUNT, /\.eq\("user_id", userId\)\.eq\("id", id\)/, "删除必须同时限定 user_id");
  assert.match(ACCOUNT, /\.eq\("user_id", userId\)/, "查询必须限定 user_id");
});

test("登录后的权益查询读账户，而不是读本机凭证", () => {
  const src = readCode("src/app/api/account/entitlement/route.ts");
  assert.match(src, /readAccountEntitlement/, "应读账户权益");
  assert.doesNotMatch(src, /readEntitlement\(req\)/, "不该读本机 cookie —— 那正是账号要解决的问题");
});

// ── 5. 数据表与 RLS ───────────────────────────────────────

test("三张新表都开了 RLS 并回收了权限", () => {
  for (const table of ["account_entitlements", "readings", "link_codes", "device_entitlements"]) {
    const re = new RegExp(
      `alter table public\\.${table} enable row level security;[\\s\\S]{0,120}?revoke all on public\\.${table} from anon, authenticated`,
      "i"
    );
    assert.match(SCHEMA, re, `${table} 缺少 RLS 或权限回收`);
  }
});

test("账户与设备权益的表结构能与代码里的 Entitlement 对上", () => {
  // 从建表语句的下一行往后取一段，逐行找列定义。
  // 不用 /create table[\s\S]*?\)/ —— 表定义里第一处 ")" 出现在
  // references auth.users(id) 里，会把匹配提前截断。
  for (const table of ["account_entitlements", "device_entitlements"]) {
    const start = SCHEMA.indexOf(`create table if not exists public.${table}`);
    assert.ok(start >= 0, `未找到 ${table} 的建表语句`);

    const rest = SCHEMA.slice(start).split("\n");
    const end = rest.findIndex((l, i) => i > 0 && /^\);\s*$/.test(l));
    const block = rest.slice(0, end === -1 ? rest.length : end + 1).join("\n");

    assert.match(block, /^\s*member\s+bigint/m, `${table} 缺少 member 列`);
    assert.match(block, /^\s*passes\s+jsonb/m, `${table} 缺少 passes 列`);
  }
});

test("记录表按用户与时间建了索引", () => {
  // 回看列表是按时间倒序查的，没这个索引会随记录数增长而变慢
  assert.match(SCHEMA, /create index if not exists readings_user_created_idx/i);
  assert.match(SCHEMA, /on public\.readings \(user_id, created_at desc\)/i);
});

// ── 6. 登录与注册 ─────────────────────────────────────────

test("验证码发送有按 IP 的频率限制", () => {
  const otp = readCode("src/app/api/account/otp/route.ts");
  assert.match(otp, /SEND_IP_DAILY_LIMIT/, "必须有发送上限");
  assert.match(otp, /bumpCount\(key\)/, "成功与失败都要计数");
  assert.match(otp, /429/, "超限应返回 429");
});

test("发送验证码不回显该邮箱是否已注册", () => {
  const otp = readCode("src/app/api/account/otp/route.ts");
  // 回显 = 一个免费的账号枚举接口
  assert.doesNotMatch(otp, /已注册|该邮箱已存在|already registered/, "不得泄露账号是否存在");
});

test("账号服务未配置时明确报 503，而不是假装成功", () => {
  assert.match(ACCOUNT, /export function accountsConfigured/, "应有配置检测");
  for (const rel of [
    "src/app/api/account/otp/route.ts",
    "src/app/api/account/link/route.ts",
    "src/app/api/account/claim/route.ts",
    "src/app/api/account/entitlement/route.ts",
  ]) {
    assert.match(readCode(rel), /accountsConfigured\(\)/, `${rel} 未检查账号服务是否配置`);
  }
});

// ── 7. 单次券消费台账（防重放）────────────────────────────

test("消费台账：用「插入成功与否」而不是「先查再写」", () => {
  // 先查再写在并发下会让两个请求都查到"没消费过"，两个都放行。
  // 只有主键冲突能保证只有一个赢。
  assert.match(ACCOUNT, /claimPassConsumption/, "应有原子认领函数");
  assert.match(ACCOUNT, /error\.code === "23505"/, "应把主键冲突当作「已消费」而不是异常");
  assert.match(LEDGER, /pass_id\s+text primary key/, "台账主键必须能挡住重复消费");
});

test("台账必须留在收费闭环那一侧，不能挪回账号包", () => {
  // 这条防的是一个**发生过的真实故障**：台账原先放在 accounts.sql 里，
  // 而 accounts.sql 被标为"账号功能、可选"。只做最小上线的人不跑它，
  // 于是点击付费解读时找不到台账，服务端按"宁可拒绝也不放行"处理，
  // 付了钱的用户直接 503 排不了盘。
  //
  // 判据：台账表只允许出现在 ledger.sql 里（accounts.sql 里只能留一句指路注释）。
  assert.ok(existsSync(new URL("../supabase/ledger.sql", import.meta.url)), "ledger.sql 必须存在");
  assert.match(LEDGER, /create table if not exists public\.pass_consumptions/);

  // accounts.sql 里不许再有建表语句，只能有"已挪走"的说明
  assert.doesNotMatch(
    SCHEMA,
    /create table[^;]*pass_consumptions/i,
    "台账不该在 accounts.sql 里建表 —— 它属于收费闭环"
  );
  assert.match(SCHEMA, /ledger\.sql/, "accounts.sql 里应留一句指路，说明台账挪到哪了");

  // 体检脚本也必须把它算成必需项，否则同样的漏配不会被发现
  const preflight = readCode("scripts/check-supabase.mjs");
  assert.match(
    preflight,
    /\["pass_consumptions",\s*"[^"]*",\s*"supabase\/ledger\.sql"\]/,
    "体检脚本必须把 pass_consumptions 列为必需项并指向 ledger.sql"
  );
});

test("台账的键是 tid + 下标 + 消费前次数，三段都不能少", () => {
  // tid  区分"哪一份凭证授权"（重新签发后不该沿用旧的消费记录）
  // 下标 区分"这一份里的哪张券"
  // 次数 区分"这张券的第几次使用" —— 少了它，一张 2 次的券第二次会被误判成重放
  assert.match(ACCOUNT, /passIdOf/, "应有统一的键构造");
  assert.match(
    ACCOUNT,
    /return `\$\{tid\}:\$\{passIndex\}:\$\{remaining\}`/,
    "键格式应为 tid:下标:次数"
  );
  assert.match(ACCOUNT, /passIndex: number, remaining: number/, "两段都要参与构键");
});

test("多次券的第二次使用不被误判为重放", () => {
  // 次数递减 ⇒ 每次使用三段都不同；同一次使用重放则三段相同
  const access = readCode("src/lib/access.ts");
  assert.match(access, /remaining: pass\.n/, "判定要带出消费前的次数");

  // guard 构键时必须把次数一起传进去（三行调用，用不带跨行正则的写法断言）
  const iCall = GUARD.indexOf("passIdOf(");
  assert.ok(iCall >= 0, "guard 未调用 passIdOf");
  const call = GUARD.slice(iCall, GUARD.indexOf(")", iCall));
  assert.match(call, /entitlement\.tid/, "构键要带 tid");
  assert.match(call, /decision\.consume\.passIndex/, "构键要带下标");
  assert.match(call, /decision\.consume\.remaining/, "构键要带消费前次数");
});

test("放行前先占坑（否则并发会白嫖同一张券）", () => {
  const iClaim = GUARD.indexOf("await claimPassConsumption(");
  const iReturn = GUARD.indexOf("consumedPassId,");
  assert.ok(iClaim >= 0, "guard 必须认领消费");
  assert.ok(iReturn > iClaim, "认领必须发生在放行之前");
});

test("解读失败时退还已占的坑", () => {
  // 占坑在模型调用之前（防并发），但用户不该为一次服务端故障白丢一张券。
  // 注意要匹配**调用**而不是 import —— `indexOf` 会先撞上文件顶部的 import 行。
  const CALL = /await releasePassConsumption\(/;

  for (const rel of ["src/app/api/fortune/route.ts", "src/app/api/ask/route.ts"]) {
    const src = readCode(rel);
    assert.match(src, CALL, `${rel} 未在失败分支退还消费`);

    const iFail = src.indexOf("if (!result.success)");
    const iRelease = src.search(CALL);
    assert.ok(iFail >= 0, `${rel} 未找到失败分支`);
    assert.ok(
      iRelease > iFail,
      `${rel} 的退还必须发生在失败分支里（iFail=${iFail}, iRelease=${iRelease}）`
    );
  }
});

test("记不上账时拒绝放行，而不是放行", () => {
  // 放行等于让这张券变成无限次 —— 安全机制失效时宁可拒绝服务
  const start = GUARD.indexOf("await claimPassConsumption(");
  const claimBlock = GUARD.slice(start, GUARD.indexOf("consumedPassId,", start));
  assert.match(claimBlock, /catch \(err\)/, "应有失败分支");
  assert.match(claimBlock, /503/, "记账失败应返回 503");
});

test("凭证带着唯一下标号，且每次签发都换新", () => {
  const ent = readCode("src/lib/entitlement.ts");
  assert.match(ent, /function newTokenId\(\)/, "应有编号生成");
  assert.match(ent, /randomBytes\(12\)/, "编号应有足够熵（12 字节 ≈ 96 bit）");
  assert.match(ent, /tid: ent\.tid \?\? newTokenId\(\)/, "已有编号时不应换掉");
});

test("没有编号的凭证不许消费单次券", () => {
  // 旧 cookie 没有 tid，无从记账；放行就等于给它无限次
  assert.match(GUARD, /entitlement\?\.tid/, "guard 必须检查编号是否存在");
  assert.match(GUARD, /凭证缺少 tid，拒绝消费单次券/, "缺编号时应明确拒绝");
});

test("判定返回券的下标与次数，而不只是模式名", () => {
  const access = readCode("src/lib/access.ts");
  assert.match(
    access,
    /consume: "none" \| "quota" \| \{ mode: string; passIndex: number; remaining: number \}/,
    "消耗方式必须带上下标与消费前次数"
  );
  assert.match(access, /findIndex\(/, "应找出被选中那张券的下标");
});

test("按下标扣券，避免台账与 cookie 错位", () => {
  const ent = readCode("src/lib/entitlement.ts");
  assert.match(ent, /consumePass\(\s*ent: Entitlement,\s*passIndex: number/, "consumePass 应接受下标");
  assert.match(ent, /i === passIndex \? \{ \.\.\.p, n: p\.n - 1 \}/, "应只扣指定的那一张");
});

test("未配置账号服务时界面不显示登录入口", () => {
  // 摆一个点进去只会看到"尚未开通"的登录按钮，比不显示更让人困惑
  const header = readCode("src/components/Header.tsx");
  assert.match(header, /accountsEnabled\(\)/, "Header 应检查账号服务是否可用");
  assert.match(header, /state === "off"/, "不可用时应不渲染入口");
});
