import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 首页样张的契约。
 *
 * 样张是个容易"越做越送"的东西：一开始只想展示一节，后来觉得
 * "再放一节更有说服力"，最后整份解读都摆在首页上，付费墙就没了。
 * 这几条断言就是那道闸。
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * 去掉注释，只留可执行代码。
 *
 * 断言「代码里没有某个写法」时必须先做这一步：解释改动**为什么**的注释
 * 里，往往正引用着那个被删掉的旧写法 —— 直接对着原文匹配，测的就是注释。
 *
 * 不能简单地按行过滤（"以 * 开头就当注释"）：JSX 里的
 * `{/* … *\/}` 块，中间行往往既不以 * 开头、也不含 //，
 * 上一版就是这么漏掉一行的。
 *
 * 这里做一个字符级扫描，跟踪"是否在块注释里"。不追求覆盖所有 JS 语法
 * （模板字符串里的 // 会被误判），够用即可 —— 判错的代价是少测一行注释。
 */
function codeOnly(src) {
  let out = "";
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote = null;

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      if (c === "\n") out += c; // 保留换行，行号与结构不塌
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

const SAMPLE = read("../src/components/HomepageSample.tsx");
const SAMPLE_CODE = codeOnly(SAMPLE);
const HOME = read("../src/app/page.tsx");

const { SECTION_TITLES } = await import("../src/lib/reading.ts");

test("样张只展示一节，不能把整份解读摆上去", () => {
  // 数一下样张源码里出现了几个【小节名】——超过一个就等于白送
  const shown = SECTION_TITLES.filter((t) =>
    new RegExp(`title:\\s*"${t}"`).test(SAMPLE)
  );
  assert.equal(
    shown.length,
    1,
    `样张只该完整展示一节，实际展示了：${shown.join("、") || "（无）"}`
  );
  assert.equal(shown[0], "命局总评", "展示的应当是命局总评");
});

test("样张必须带「依据」——那是产品的可核验性所在", () => {
  assert.match(SAMPLE, /basis:\s*"/, "样张要有依据字段");
  assert.match(SAMPLE, /依据/, "界面上要显示「依据」这个标签");
});

test("样张保留四柱，好让「依据」可以被对照核验", () => {
  // 四柱是从生辰推出来的。留着它，用户才能验证"依据里引用的干支确实在盘上"——
  // 这正是「代码排盘、AI 只解读」这条线的落点。隐去四柱就只剩一段无从核验的文字。
  assert.match(SAMPLE, /pillars:\s*"/, "样张要有四柱");
});

test("样张不得包含完整生辰", () => {
  // 生辰是隐私，也是付费后才该完整呈现的东西。样张只留四柱。
  assert.doesNotMatch(
    SAMPLE,
    /birthDate|birthTime/,
    "样张不该带生辰字段 —— 四柱够了，出生日期与时辰是用户的隐私"
  );
});

test("样张明确标注是样品", () => {
  assert.match(SAMPLE, /真实生成/, "要说明这是真实生成的");
  assert.match(SAMPLE, /生辰已隐去/, "要说明生辰已隐去");
});

test("样张带上免责声明", () => {
  assert.match(SAMPLE, /DISCLAIMER/, "样张也要有免责声明");
});

test("样张说明总共几节、试读能看几节", () => {
  assert.match(SAMPLE, /SECTION_TITLES\.length/, "要说明总节数");
  assert.match(SAMPLE, /未激活可先免费试读/, "要告诉用户可以先试读");
});

test("样张默认收起，且放在表单之后", () => {
  // 默认展开的话，第一屏会被一大段文字占满，把真正要做的事（填表）挤出视野
  assert.match(SAMPLE, /useState\(false\)/, "样张应当默认收起");
  assert.match(SAMPLE, /aria-expanded/, "折叠按钮要有 aria-expanded");

  const formAt = HOME.indexOf("<FortuneForm");
  const sampleAt = HOME.indexOf("<HomepageSample");
  assert.ok(formAt > 0 && sampleAt > 0, "首页应当同时有表单与样张");
  assert.ok(formAt < sampleAt, "样张必须在表单之后 —— 先把表单给人");
});

test("收起用的是 hidden 属性，不是条件渲染 —— 否则搜索引擎抓不到", () => {
  // 这段样张是首页最有价值的原创内容，而 `{open && …}` 会让它
  // 根本不出现在服务端产出的 HTML 里。折叠面板本来就是给搜索引擎
  // 和犹豫的用户看的，抓不到就等于白做。
  //
  // 只看代码，不看注释：解释这个选择的注释里正引用着那个旧写法。
  assert.doesNotMatch(
    SAMPLE_CODE,
    /\{open\s*&&/,
    "不得用条件渲染收起样张正文 —— 内容必须始终在 HTML 里"
  );
  assert.match(SAMPLE_CODE, /hidden=\{!open\}/, "应当用 hidden 属性收起");
});

test("样张用的是真实的解读渲染样式，不是另写一套", () => {
  // 样张必须代表真实交付的样子。另写一套排版迟早与 ReadingPanel 漂移，
  // 那时样张就在骗人。
  assert.match(SAMPLE, /inlineHtml/, "应当复用 lib/sanitize 的渲染");
  assert.match(SAMPLE, /结论/, "要有结论标签");
  assert.match(SAMPLE, /展开/, "要有展开段落");
});
