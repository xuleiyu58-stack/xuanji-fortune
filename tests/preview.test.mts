import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 免费试读的契约。
 *
 * 试读有两面，都要守住：
 *   · 产品面：没付钱的人必须能看到第一节 —— 否则"试读"等于没做
 *   · 安全面：不能因此变成"免费看全量"，也不能变成无限次模型调用
 *
 * 这里测的是**判定规则**（纯函数）与**关键实现约束**（源码契约）。
 * 真实的请求路径由 scripts/_preview.mjs 跑（需要起服务器 + 真实模型）。
 */

const { decidePreview } = await import("../src/lib/access.ts");
const { parseReading, LOCKED_SECTION_COUNT, SECTION_TITLES } = await import(
  "../src/lib/reading.ts"
);

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * 去掉注释行与行尾注释，只留可执行代码。
 *
 * 断言"代码里没有某个写法"时必须先做这一步：解释这次改动**为什么**的注释
 * 里，往往正引用着那个被删掉的旧写法。直接对着原文匹配，测的就是注释，
 * 而不是代码 —— 这条测试第一次跑就是这么挂的。
 */
const codeOnly = (src) =>
  src
    .split(/\r?\n/)
    .map((l) => l.replace(/\s*\/\/.*$/, "").replace(/\s*\/\*.*?\*\/\s*/g, ""))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

const NOW = 1_800_000_000;
const counts = (device, ip, global = 0) => ({ device, ip, global });

// ── 判定规则 ────────────────────────────────────────────────

test("没用过的新访客可以试读", () => {
  assert.equal(decidePreview(counts(0, 0), null, NOW, 1, 3), true);
});

test("同一设备第二次不给试读", () => {
  assert.equal(decidePreview(counts(1, 1), null, NOW, 1, 3), false);
});

test("IP 额度用完时，清 cookie 也拿不到试读", () => {
  // 设备计数重置为 0（相当于清了 cookie），但 IP 已经到顶
  assert.equal(
    decidePreview(counts(0, 3), null, NOW, 1, 3),
    false,
    "IP 是设备 cookie 之外的第二道闸 —— 少了它，清 cookie 就能无限续杯"
  );
});

test("已有权益的人不该被算作试读", () => {
  const now = NOW;
  const member = { member: now + 1000, passes: [] };
  const withPass = { member: null, passes: [{ m: "bazi", n: 1, e: now + 1000 }] };
  assert.equal(decidePreview(counts(0, 0), member, now, 1, 3), false);
  assert.equal(decidePreview(counts(0, 0), withPass, now, 1, 3), false);
});

test("过期的会员与用尽的券不阻止试读（他们确实没权益了）", () => {
  const now = NOW;
  const expired = { member: now - 1, passes: [] };
  const usedUp = { member: null, passes: [{ m: "bazi", n: 0, e: now + 1000 }] };
  assert.equal(decidePreview(counts(0, 0), expired, now, 1, 3), true);
  assert.equal(decidePreview(counts(0, 0), usedUp, now, 1, 3), true);
});

test("额度为 0 时试读整体关闭", () => {
  // 这样关掉试读只需要把数字改成 0，不必删代码
  assert.equal(decidePreview(counts(0, 0), null, NOW, 0, 0), false);
  assert.equal(decidePreview(counts(0, 0), null, NOW, 0, 3), false);
  assert.equal(decidePreview(counts(0, 0), null, NOW, 1, 0), false);
});

// ── 节数与解析 ──────────────────────────────────────────────

test("试读解锁后剩下的节数 = 总节数 - 1", () => {
  assert.equal(LOCKED_SECTION_COUNT, SECTION_TITLES.length - 1);
  assert.equal(LOCKED_SECTION_COUNT, 6);
});

test("提示词里规定的小节名与 SECTION_TITLES 一致", () => {
  // 这条防的是"改了提示词忘了改常量"：界面上的节数是从常量推的，
  // 两边不一致会让用户看到"还有 6 节"却只解锁出 5 节。
  const ai = read("../src/lib/ai.ts");
  for (const title of SECTION_TITLES) {
    assert.ok(ai.includes(`【${title}】`), `提示词里缺少【${title}】`);
  }
});

test("试读提示词只要求写一节，且不写其余几节", () => {
  const ai = read("../src/lib/ai.ts");
  const block = /const PREVIEW_PROMPT = `([\s\S]*?)`;/.exec(ai)?.[1] ?? "";
  assert.ok(block, "应当存在 PREVIEW_PROMPT");
  assert.ok(block.includes("只写**一节**"), "必须明确只写一节");
  assert.ok(block.includes("【命局总评】"), "要写的那一节是命局总评");
  // 其余小节必须被明确排除，否则模型可能顺手全写了，试读就白送了
  for (const t of SECTION_TITLES.filter((x) => x !== "命局总评")) {
    assert.ok(block.includes(t), `试读提示词应当明确排除【${t}】`);
  }
});

test("解析能正确切出小节，且试读只喂一节时拿到一节", () => {
  const parsed = parseReading(`命理之说，信则有不信则无，仅供参考娱乐

【命局总评】
结论：伤官吐秀而身弱
依据：月支戌中戊土为伤官
展开：伤官是泄秀之星

【事业财运】
结论：宜借力
依据：时干戊土
展开：不宜硬拼`);

  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[0].title, "命局总评");
  assert.equal(parsed.sections[0].part.verdict, "伤官吐秀而身弱");
  assert.equal(parsed.sections[0].part.basis, "月支戌中戊土为伤官");
  // 免责声明被剥掉 —— 它由界面用代码里的常量补回来，不该混进正文
  assert.ok(!JSON.stringify(parsed).includes("仅供参考娱乐"));
});

test("模型没按格式走时，试读宁可失败也不回一段残文", () => {
  // parseReading 对不成节的文本会走 fallback，sections 为空 ——
  // 路由据此判定"没有结构就没有样品"，不计账、不返回试读。
  const parsed = parseReading("这个八字挺好的，没啥可说的。");
  assert.equal(parsed.sections.length, 0);
  assert.ok(parsed.fallback, "原文要保留在 fallback 里");
});

// ── 实现约束（源码契约）─────────────────────────────────────

test("试读的计数与正式解读分开，否则用户一试读就把当天额度花掉", () => {
  const store = read("../src/lib/server/usage-store.ts");
  assert.match(store, /PREVIEW_PREFIX\s*=\s*"preview:"/, "试读要有自己的键前缀");
  assert.match(store, /previewDeviceKey/, "要有设备维度的试读键");
  assert.match(store, /previewIpKey/, "要有 IP 维度的试读键");
});

test("试读的全局计数要把正式解读也算进去", () => {
  // 否则在两条路径之间来回切就能把 DEEPSEEK_DAILY_BUDGET 翻倍
  const store = read("../src/lib/server/usage-store.ts");
  const fn = /export async function readPreviewUsage[\s\S]*?\n}/.exec(store)?.[0] ?? "";
  assert.ok(fn, "应当存在 readPreviewUsage");
  assert.match(fn, /GLOBAL_KEY/, "试读的 global 必须并入正式解读的 global");
});

test("熔断与额度耗尽时不送试读 —— 只有「没付钱」才送", () => {
  const route = read("../src/app/api/fortune/route.ts");
  assert.match(
    route,
    /guard\.decision\.status === 403[\s\S]{0,80}guard\.decision\.reason === "paid"/,
    "必须同时限定 403 与 reason=paid"
  );
});

test("试读不进消费台账 —— 它不该碰单次券那张表", () => {
  const route = read("../src/app/api/fortune/route.ts");
  const fn = /async function canPreview[\s\S]*?\n}/.exec(route)?.[0] ?? "";
  assert.ok(fn, "应当存在 canPreview");
  assert.doesNotMatch(fn, /claimPassConsumption/, "试读不得认领单次券消费");
});

test("试读不计入排盘历史 —— 否则用户会以为自己拥有这份解读", () => {
  const form = read("../src/components/FortuneForm.tsx");
  const block = /if \(data\?\.preview\) \{[\s\S]*?\n {6}\}/.exec(form)?.[0] ?? "";
  assert.ok(block, "FortuneForm 应当有 preview 分支");
  assert.doesNotMatch(block, /saveReading/, "试读不得写入历史");
  assert.match(block, /setPreview/, "应当标记为试读状态");
});

test("提交时不再由前端决定要不要弹付款窗", () => {
  // 此前是 `if (unlocked) 调接口 else 弹窗`，于是没付钱的用户
  // 永远触发不到试读 —— 前端猜不准"还有没有额度"，那是服务端的事。
  //
  // 只看代码，不看注释：解释这次改动的注释里正引用着那个旧写法。
  const src = codeOnly(read("../src/components/FortuneForm.tsx"));
  const fn = /const handleSubmit[\s\S]*?\n {2}\};/.exec(src)?.[0] ?? "";
  assert.ok(fn, "应当存在 handleSubmit");
  assert.doesNotMatch(fn, /if \(unlocked\)/, "handleSubmit 不该再按 unlocked 分支");
  assert.match(fn, /callFortuneAPI/, "应当直接调接口，让服务端判定");
});
