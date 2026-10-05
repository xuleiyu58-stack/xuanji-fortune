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
const { buildBaziChart } = await import("../src/lib/bazi/index.ts");

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
  /*
   * 生辰是隐私，也是付费后才该完整呈现的东西。样张**显示出来的**只有四柱。
   *
   * 断言范围必须是 SAMPLE 那个对象本身：`SAMPLE_BIRTH` 是刻意留在文件里的
   * 常量（没有它就无法核对四柱是不是真的算得出来），对着整个文件断言
   * 会把那个常量一起否掉 —— 那等于要求把可核验性删掉。
   */
  const sampleObj = /const SAMPLE = \{[\s\S]*?\n\};/.exec(SAMPLE)?.[0] ?? "";
  assert.ok(sampleObj, "应当能切出 SAMPLE 对象");
  assert.doesNotMatch(
    sampleObj,
    /birthDate|birthTime/,
    "展示出去的样张里不该有生辰字段 —— 四柱够了，出生日期与时辰是用户的隐私"
  );
  assert.ok(sampleObj.includes("pillars"), "SAMPLE 里应当有四柱");
});

test("样张的四柱必须真的算得出来 —— 这是它自称可核验的前提", () => {
  /*
   * 这条是拿真事故换来的。
   *
   * 样张原先手写着 `庚戌 · 辛未 · 庚辰 · 辛巳`，而那个组合来自不了任何真实
   * 日期（辛未月的月干只可能是癸）；它下面的「依据」又引用了四柱里根本没有的
   * 「丑」。样张最该可信的地方反而自相矛盾 —— 而它的卖点正是「四柱可自行核对」。
   *
   * 所以这里把 SAMPLE_BIRTH 喂给真的排盘引擎，比对 SAMPLE.pillars。
   * 两者任何一处被单独改动，这条就会报错。
   */
  const birth = /const SAMPLE_BIRTH = \{([^}]*)\}/.exec(SAMPLE)?.[1] ?? "";
  assert.ok(birth.includes("birthDate"), "样张必须留着那个生辰常量，否则四柱无从核对");

  const pick = (k) => new RegExp(`${k}:\\s*"([^"]+)"`).exec(birth)?.[1];
  const input = {
    birthDate: pick("birthDate"),
    birthTime: pick("birthTime"),
    gender: pick("gender"),
  };
  assert.ok(input.birthDate && input.birthTime && input.gender, "生辰常量三个字段都要有");

  const chart = buildBaziChart(input);
  assert.ok(chart, `排盘失败：${JSON.stringify(input)}`);

  const real = chart.pillars.map((p) => `${p.gan}${p.zhi}`).join(" · ");
  const shown = /pillars:\s*"([^"]+)"/.exec(SAMPLE)?.[1];
  assert.equal(
    shown,
    real,
    `样张的四柱与真盘对不上。\n  样张写的：${shown}\n  真盘排的：${real}\n` +
      `（生辰 ${input.birthDate} ${input.birthTime} ${input.gender}）`
  );
});

test("「依据」里点到的干支，必须真的在盘上", () => {
  // 「依据」的可信度全靠这一点：它引用的干支能在上面那行四柱里找到。
  // 原先那句写着"地支未、丑、戌、辰"，而四柱是"庚戌 · 辛未 · 庚辰 · 辛巳"——
  // 丑不在里面，巳又没被提到。
  const birth = /const SAMPLE_BIRTH = \{([^}]*)\}/.exec(SAMPLE)?.[1] ?? "";
  const pick = (k) => new RegExp(`${k}:\\s*"([^"]+)"`).exec(birth)?.[1];
  const chart = buildBaziChart({
    birthDate: pick("birthDate"),
    birthTime: pick("birthTime"),
    gender: pick("gender"),
  });

  const onChart = new Set(chart.pillars.flatMap((p) => [p.gan, p.zhi]));

  /*
   * 只看 SAMPLE 对象里的文本值，**不要看整份源码** ——
   * 解释这次改动的注释里正引用着那串错误地支（"依据又引用了四柱里
   * 根本没有的「丑」"），对着全文匹配会命中那句注释。
   * 这是本项目第三次栽在同一件事上：断言"代码里没有某个写法"之前先剥注释。
   */
  const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
  const textValues = [...SAMPLE_CODE.matchAll(/"([^"\n]{8,})"/g)].map((m) => m[1]).join("\n");

  /*
   * 地支可以连着写（"未丑戌辰四土"），也可以加顿号（"未、丑、戌、辰"）。
   * 两种都要认，所以先把顿号统一成空串，再按单个字取。
   * 第一版只按顿号 split，碰上连写的写法就会得到一整串"未丑戌辰"、
   * 长度断言随即误报 —— 判据要看的是"提到了哪几个字"，不是"有没有顿号"。
   */
  const joined = new RegExp(`地支([${BRANCHES}、]+)`).exec(textValues)?.[1] ?? "";
  const named = (joined.replace(/、/g, "").match(new RegExp(`[${BRANCHES}]`, "g")) ?? []);
  assert.ok(named.length >= 2, `依据里应当点到具体地支，实际：「${joined}」`);

  const missing = named.filter((z) => !onChart.has(z));
  assert.deepEqual(
    missing,
    [],
    `依据里点到的地支必须都在盘上，这几个不在：${missing.join("、")}\n  盘上有的：${[...onChart].join("")}`
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
