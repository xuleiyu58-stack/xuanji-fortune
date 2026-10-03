import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 路由本身依赖 Next 运行时，难以直接单测，所以这里断言的是**契约与调用顺序**。
 * 顺序是这条路由的命门：额度判定必须在调用 AI 之前，记账必须在成功之后。
 *
 * 准入判定已抽到 lib/server/quota-guard.ts（追问接口共用同一套），
 * 所以限流相关的那几条断言指向那个文件 —— 它们仍是一条不能松的线。
 */
/** 剥掉注释再断言。注释里会写到"以前用过 sk-placeholder"这类说明，不剥的话守卫会被自己的解释绊倒。 */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .map((l) => l.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

const read = (rel: string) => stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

const src = read("../src/app/api/fortune/route.ts");
const guardSrc = read("../src/lib/server/quota-guard.ts");
const askSrc = read("../src/app/api/ask/route.ts");

// ── 首次解读 ─────────────────────────────────────────────

test("路由使用输入校验，而不是直接取 body", () => {
  assert.match(src, /validateFortuneRequest/, "必须过一遍 mode 白名单与输入长度校验");
});

test("准入判定发生在调用 AI 之前", () => {
  const iGuard = src.indexOf("await quotaGuard(");
  const iAi = src.indexOf("await readBazi(");
  assert.ok(iGuard >= 0, "未调用 quotaGuard");
  assert.ok(iAi >= 0, "未调用 readBazi");
  assert.ok(iGuard < iAi, "必须先判额度再调用 AI，否则限流拦不住任何请求");
});

test("准入判定必须带上 mode —— 付费与免费模式的规则不同", () => {
  // 曾经的洞：guard 不看 mode，于是「客户端看着要付款，服务端却照给」。
  // 这条断言钉住的是"mode 必须传进闸门"这件事本身。
  assert.match(src, /await quotaGuard\(req,\s*[^)]+\)/, "fortune 必须把 mode 传进 quotaGuard");
  assert.match(askSrc, /await quotaGuard\(req,\s*"bazi"\)/, "追问固定走 bazi 模式");});

test("付费模式不再吃免费额度", () => {
  assert.match(guardSrc, /isFreeMode\(mode\)/, "guard 必须按 mode 区分额度档位");
  assert.match(guardSrc, /decideAccess\(/, "判定应交给 access.ts 的 decideAccess");
  assert.doesNotMatch(guardSrc, /decideQuota/, "decideQuota 已被 decideAccess 取代");
});

test("必须验签权益凭证", () => {
  // 取权益的动作已收敛到 pass-cookie 的 ensurePassCookie：
  // 有 cookie 就直接验签返回，没有才回退查账户（账号体系那一层）。
  // guard 不该自己去读 cookie 或账户表 —— 读取点只能有一处。
  assert.match(guardSrc, /ensurePassCookie\(req\)/, "guard 必须通过 ensurePassCookie 取凭证");
  assert.match(guardSrc, /entitlement,/, "凭证必须参与放行判定");
});

test("只在 AI 成功之后才记账", () => {
  const iAi = src.indexOf("await readBazi(");
  const iBump = src.indexOf("await bumpUsage(");
  assert.ok(iBump >= 0, "未调用 bumpUsage");
  assert.ok(iAi < iBump, "记账必须在 AI 调用之后 —— 失败不该扣用户额度");
  // 失败分支必须提前 return，不能走到记账
  const failBlock = src.slice(src.indexOf("if (!result.success)"), iBump);
  assert.match(failBlock, /return/, "AI 失败时必须 return，不能继续记账");
});

// ── 准入判定（两个入口共用）─────────────────────────────

test("拒绝时使用判定给出的状态码，而不是写死 429", () => {
  // 状态码的分配属于 access.ts 的职责（403 权限 / 429 频率 / 503 熔断）；
  // guard 只负责把它翻译成 HTTP。写死一个码就等于把两种性质压成一种。
  assert.match(guardSrc, /decision\.status/, "拒绝时应使用判定给出的状态码（403/429/503）");
  assert.match(guardSrc, /decision\.message/, "错误文案应由判定给出");
  assert.match(guardSrc, /decideAccess\(/, "状态码的来源是 decideAccess");
});

test("读不到用量时拒绝服务，不降级放行", () => {
  const start = guardSrc.indexOf("catch (err)");
  const block = guardSrc.slice(start, guardSrc.indexOf("decideAccess("));
  assert.match(block, /503/, "读用量失败必须拒绝，不能吞掉异常继续");
  assert.match(block, /return/, "读用量失败必须立即返回");
});

test("签发 httpOnly 设备 cookie", () => {
  assert.match(guardSrc, /httpOnly:\s*true/);
  assert.match(guardSrc, /xj_dev/);
  assert.match(guardSrc, /sameSite/);
});

test("两个入口都必须过同一道闸 —— 追问不能绕开限流", () => {
  assert.match(askSrc, /quotaGuard/, "追问接口也必须走准入判定");
  const iGuard = askSrc.indexOf("await quotaGuard(");
  const iAi = askSrc.indexOf("await askFollowUp(");
  assert.ok(iGuard >= 0 && iAi >= 0 && iGuard < iAi, "追问也必须先判额度再调用 AI");
});

test("追问的盘由服务端重排，不信任客户端传回来的盘", () => {
  assert.match(askSrc, /buildBaziChart/, "应当重新排盘");
  assert.doesNotMatch(askSrc, /raw\.chart|body\.chart/, "不该直接采信客户端传来的盘");
});

// ── AI 层 ────────────────────────────────────────────────

test("声明 Node 运行时（用了 node:crypto）", () => {
  assert.match(src, /export const runtime = "nodejs"/, "用到 node:crypto 就必须声明 Node 运行时");
});

test("不再使用占位 API key，也不再拿万能文案糊弄用户", () => {
  const ai = read("../src/lib/ai.ts");
  assert.doesNotMatch(ai, /sk-placeholder/, "缺 key 时应显式报错，而不是拿假 key 去请求");
  assert.doesNotMatch(ai, /天机不可泄露，请稍后再试/, "错误文案要说清发生了什么");
});
