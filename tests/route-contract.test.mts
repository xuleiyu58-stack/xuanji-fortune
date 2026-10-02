import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 路由本身依赖 Next 运行时，难以直接单测，所以这里断言的是**契约与调用顺序**。
 * 顺序是这条路由的命门：额度判定必须在调用 AI 之前，记账必须在成功之后。
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

const src = stripComments(
  readFileSync(new URL("../src/app/api/fortune/route.ts", import.meta.url), "utf8")
);

test("路由使用输入校验，而不是直接取 body", () => {
  assert.match(src, /validateFortuneRequest/, "必须过一遍 mode 白名单与输入长度校验");
});

test("额度判定发生在调用 AI 之前", () => {
  const iQuota = src.indexOf("decideQuota(counts");
  const iAi = src.indexOf("await readBazi(");
  assert.ok(iQuota >= 0, "未调用 decideQuota");
  assert.ok(iAi >= 0, "未调用 getFortune");
  assert.ok(iQuota < iAi, "必须先判额度再调用 AI，否则限流拦不住任何请求");
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

test("额度用尽返回 429，服务未就绪返回 503", () => {
  assert.match(src, /429/, "额度用尽应返回 429 Too Many Requests");
  assert.match(src, /503/, "计数读不到时应返回 503 而不是放行");
});

test("读不到用量时拒绝服务，不降级放行", () => {
  const block = src.slice(src.indexOf("catch (err)"), src.indexOf("decideQuota(counts"));
  assert.match(block, /503/, "读用量失败必须拒绝，不能吞掉异常继续");
});

test("签发 httpOnly 设备 cookie", () => {
  assert.match(src, /httpOnly:\s*true/);
  assert.match(src, /xj_dev/);
  assert.match(src, /sameSite/);
});

test("声明 Node 运行时（用了 node:crypto）", () => {
  assert.match(src, /export const runtime = "nodejs"/, "用到 node:crypto 就必须声明 Node 运行时");
});

test("不再使用占位 API key，也不再拿万能文案糊弄用户", () => {
  const ai = stripComments(readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(ai, /sk-placeholder/, "缺 key 时应显式报错，而不是拿假 key 去请求");
  assert.doesNotMatch(ai, /天机不可泄露，请稍后再试/, "错误文案要说清发生了什么");
});
