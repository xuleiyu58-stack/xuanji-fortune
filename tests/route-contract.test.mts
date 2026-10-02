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

test("额度判定的三维度与状态码都在 guard 里", () => {
  assert.match(guardSrc, /decideQuota\(counts/, "仍未调用 decideQuota");
  assert.match(guardSrc, /429/, "额度用尽应返回 429 Too Many Requests");
  assert.match(guardSrc, /503/, "计数读不到时应返回 503 而不是放行");
});

test("读不到用量时拒绝服务，不降级放行", () => {
  const block = guardSrc.slice(guardSrc.indexOf("catch (err)"), guardSrc.indexOf("decideQuota(counts"));
  assert.match(block, /503/, "读用量失败必须拒绝，不能吞掉异常继续");
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
