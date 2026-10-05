/**
 * 阳历与农历的出生日期必须是同一副相貌。
 *
 * 起因：阳历那边原先是 `<input type="date">`，农历那边是三个下拉，同一个
 * 「出生日期」在同一个表单里长着两副样子。改统一之后，最容易悄悄坏掉的是
 * **「日」的选项数量** —— 它取决于当时选中的年与月。这一条一旦错，
 * 平时看不出来，只在 29/30/31 号上错，而那正是最容易算错的边界。
 *
 * 断言的是**代码里写了什么**，不是浏览器里的样子。剥注释是必须的：
 * 解释这个改动的注释里正引用着被删掉的旧写法，对原文匹配等于在测注释。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/components/BirthInput.tsx", import.meta.url), "utf8");

/** 逐字符扫描剥掉注释，保留换行以免结构塌陷。JSX 的 {/* … *\/} 也在其中。 */
function codeOnly(src) {
  let out = "";
  let i = 0;
  let mode = null; // null | "line" | "block"
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === null) {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      out += c;
      i++;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = null; out += c; }
      i++;
      continue;
    }
    if (c === "*" && n === "/") { mode = null; i += 2; continue; }
    if (c === "\n") out += c;
    i++;
  }
  return out;
}

const code = codeOnly(SRC);
const tests = [];
const t = (name, fn) => tests.push({ name, fn });

t("阳历那边不再用 input[type=date]", () => {
  assert.doesNotMatch(code, /type="date"/, "阳历应当与农历一样用三个下拉，而不是日期控件");
});

t("阳历是三个下拉，且各自带 aria-label（核对脚本靠它定位）", () => {
  for (const label of ["阳历年", "阳历月", "阳历日"]) {
    assert.match(
      code,
      new RegExp(`aria-label="${label}"`),
      `少了 aria-label="${label}" —— 去掉它，录屏剧本与出片核对就都定位不到这一个下拉`,
    );
  }
});

t("两套历法的「日」都由当月天数决定，不写死 31", () => {
  // 阳历：solarDayCount 决定长度
  assert.match(code, /length:\s*solarDays/, "阳历的「日」应当按 solarDays 列，不能写死");
  // 农历：三十天是农历的固有上限，写死 30 是对的；但也必须经过 lunarDayName
  assert.match(code, /length:\s*30[\s\S]{0,120}lunarDayName/, "农历的「日」应当逐项走 lunarDayName");
});

t("公历月长的算法本身是对的（含闰年与四个小月）", () => {
  const m = /function solarDayCount\(y: number, m: number\): number \{([\s\S]*?)\n\}/.exec(code);
  assert.ok(m, "找不到 solarDayCount");
  const body = m[1];
  assert.match(body, /m === 2/, "2 月要单独判");
  assert.match(body, /% 4 === 0 && y % 100 !== 0|y % 4 === 0/, "闰年判据必须是公历规则");
  assert.match(body, /\[4, 6, 9, 11\]/, "4/6/9/11 月才是 30 天");
  assert.doesNotMatch(body, /getMonth|new Date\(/, "不该靠 Date 对象绕一圈算月长");
});

t("改写日期时把「日」夹进当月范围，不写出 2 月 31 日", () => {
  // 服务端的正则只校验形状、不校验月内日数，所以必须在源头截住
  const m = /const emitSolar[\s\S]*?\n  \};/.exec(code);
  assert.ok(m, "找不到 emitSolar");
  assert.match(m[0], /Math\.min\(Math\.max\(/, "emitSolar 必须把日 clamp 到当月天数");
  // 上界取自当月的实际天数。**这里的正则要允许换行** —— 代码里那次调用是分行的，
  // 按单行写会误判成"没做"，测的就不是代码而是我的排版。
  assert.match(m[0], /solarDayCount\([\s\S]{0,80}?\)/, "clamp 的上界要取自当月的实际天数");
});

t("下拉的选项文字不带空格（三列并排时会被截断）", () => {
  /*
   * 430px 手机上每列只有约 114px，原生下拉的截断是硬截断 ——
   * 「1990 年」会显示成「1990」，「1 日」的「日」直接掉。去掉空格才放得下。
   *
   * 断言要看的是**右花括号与单位字之间有没有空白**。
   * 第一版写成 /\{[^}]*\}\s*年/ 是错的：`\s*` 允许零个空白，
   * 于是带空格的写法也照样匹配 —— 那条断言恒为真，测了个寂寞。
   */
  const spaced = /\}\s+年|\}\s+月|\}\s+日/.exec(code);
  assert.equal(spaced, null, `选项文字里不要留空格（放不下）：…${spaced?.[0]}`);
  assert.match(code, /\{y\}年/, "年份选项应当是 `{y}年`");
  assert.match(code, /\{m\}月/, "月份选项应当是 `{m}月`");
  assert.match(code, /\{d\}日/, "日期选项应当是 `{d}日`");
});

t("阳历年不从 1900 起（那一年只有 1 月够得着）", () => {
  assert.match(code, /SOLAR_MIN_YEAR\s*=\s*1920/, "下限应当是 1920，理由见注释");
  assert.doesNotMatch(
    code,
    /SOLAR_MIN_YEAR\s*=\s*19(00|01)/,
    "1900/1901 那个年代只有 1 月的数据够得着，列出来却选不了 —— 界面不该摆一个骗人的选项",
  );
});

t("阳历的年月日由 birthDate 反解，不另存一份 state", () => {
  // 出生日期是整张盘唯一的输入。界面显示的和真正提交的若各存一份，迟早不同步。
  assert.match(code, /splitYmd\(value\.birthDate/, "阳历年月日应当从 birthDate 反解");
  assert.doesNotMatch(code, /useState[^\n]*\n[^\n]*solarY/, "不该为阳历年另存 state");
});

t("表单给出生日期一个完整初值（否则下拉会被弹回原位）", () => {
  /*
   * 这一条是踩出来的：阳历年月日不另存 state，全靠 birthDate 反解。
   * birthDate 为空时，三个下拉停在选项首项（1901-01-01），
   * 而用户一改年份写回去的值不等于他看到的组合 —— React 会把下拉弹回去，
   * 表现就是"这几个框根本改不动"。所以初值不是好看的问题，是能不能用的问题。
   */
  const form = codeOnly(readFileSync(new URL("../src/components/FortuneForm.tsx", import.meta.url), "utf8"));
  assert.match(
    form,
    /useState<Record<string,\s*string>>\(\{[\s\S]{0,400}?birthDate:\s*"\d{4}-\d{2}-\d{2}"/,
    "FortuneForm 的初始 formData 里必须有一个合法的 birthDate",
  );
});

t("写回日期时不因“还没选完”而提前返回", () => {
  /*
   * 早先 emitSolar 开头有一句 `if (!y || !m) return;`，本意是"等用户把年月选齐"。
   * 但 birthDate 为空时年月反解为空，于是**每一次改动都被这句话吞掉**，
   * 状态不变、下拉弹回，看着像控件坏了。
   */
  const m = /const emitSolar[\s\S]*?\n  \};/.exec(code);
  assert.ok(m, "找不到 emitSolar");
  assert.doesNotMatch(m[0], /if\s*\(!y\s*\|\|\s*!m\)\s*return/, "emitSolar 不该在年月为空时提前返回");
  assert.match(m[0], /onChange\("birthDate"/, "emitSolar 必须真的写回 birthDate");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} 通过`);
process.exitCode = failed ? 1 : 0;
