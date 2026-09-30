import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MODES, MEMBER_PLANS, formatPrice } from "../src/lib/pricing.ts";

const ROOT = new URL("../src/", import.meta.url);

/**
 * 剥掉注释再扫。
 * 注释不是界面，注释里写价格渲染不出来 —— 但不剥的话，解释这条规则的说明文字
 * 本身就会触发规则（本文件的第一版就被自己的注释绊倒过）。
 * 注意这只删注释，不碰字符串与 JSX 文本，真正的硬编码价格照样在。
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // JSX 注释 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line)) // 整行行注释
    .join("\n");
}

function read(rel: string): string {
  return stripComments(readFileSync(new URL(rel, ROOT), "utf8"));
}

// pricing.ts 是价格表的唯一住处，也是唯一允许出现价格字面量的文件。
// 其余 src/ 下的 .ts/.tsx 一律在监视范围内 —— 这里递归遍历，不再手写文件清单，
// 新建的页面（例如 src/app/fortune/ziwei/page.tsx）会自动被纳入。
const PRICING = "lib/pricing.ts";

function walk(dir: URL, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...walk(new URL(`${entry.name}/`, dir), `${rel}/`));
    } else if (/\.tsx?$/.test(entry.name) && rel !== PRICING) {
      out.push(rel);
    }
  }
  return out;
}

const TARGETS = walk(ROOT, "").sort();

test("监视范围覆盖 src 下除 pricing.ts 外的全部 ts/tsx", () => {
  assert.ok(TARGETS.includes("app/page.tsx"), "首页应在监视范围内");
  assert.ok(TARGETS.includes("app/member/page.tsx"), "会员页应在监视范围内");
  assert.ok(!TARGETS.includes(PRICING), "pricing.ts 是价格表的家，不应被监视");
  assert.ok(TARGETS.length >= 9, `监视范围疑似塌缩，只扫到 ${TARGETS.length} 个文件`);
});

// 递归遍历接管之前，监视清单是手写的这九个文件。`TARGETS.length >= 9` 挡不住
// "遍历不再下探某个子目录"：比如 walk 漏掉 components/ 时，src 下仍有十几个文件，
// 总数照样 >= 9，上面两条 includes 也仍然通过 —— 覆盖范围无声缩水而测试全绿。
// 所以这里把最初的九个路径逐个点名。它们分布在 app/、app/fortune/、components/
// 三个不同层级，任何一层不再被下探都会立刻变红。
// 记个数备查：写下这段时 TARGETS 共 21 个文件（其中 components/ 占 9 个）。
// 数字只作参考，别把它断言成硬上限 —— 新增页面应当让这个数变大。
const ORIGINAL_TARGETS = [
  "app/page.tsx",
  "app/member/page.tsx",
  "components/QuotaBanner.tsx",
  "components/FortuneForm.tsx",
  "app/fortune/daily/page.tsx",
  "app/fortune/oracle/page.tsx",
  "app/fortune/bazi/page.tsx",
  "app/fortune/tarot/page.tsx",
  "app/fortune/love/page.tsx",
];

test("递归遍历没有漏掉最初清单里的任何一个文件", () => {
  for (const rel of ORIGINAL_TARGETS) {
    assert.ok(TARGETS.includes(rel), `${rel} 没有被递归遍历扫到，监视范围可能塌缩`);
  }
});

test("界面文件里不得出现写死的价格数字", () => {
  for (const rel of TARGETS) {
    const src = read(rel);
    // ¥ 后面直接跟数字 = 写死的价格。¥{formatPrice(...)} 的 ¥ 后面是 {，不会命中。
    const hit = src.match(/¥\s*\d[^"'{}\n]*/);
    assert.equal(hit, null, `${rel} 里仍有写死的价格：${hit?.[0] ?? ""}`);
  }
});

test("价格数字不得直接写进 amount 容器", () => {
  // 单独一条：¥ 与数字可能被拆进相邻的两个 span（首页"随缘"卡原本就是这种写法），
  // 上面的 ¥+数字 规则抓不到，所以这里直接盯 amount 容器的内容。
  for (const rel of TARGETS) {
    const hit = read(rel).match(/className="amount"[^>]*>\s*\d/);
    assert.equal(hit, null, `${rel} 的 amount 容器里仍是写死的数字：${hit?.[0] ?? ""}`);
  }
});

test("免费判定必须从 pricing 派生，不得写死模式名", () => {
  // 曾经这里写死 `mode === "daily"`，而 pricing 里灵签也是 0 元 ——
  // 结果首页说灵签免费、按钮显示「¥0 立即测算」、点下去却弹收款码。
  // 以后再加免费模式（比如姻缘限免），只要不改这个判断就会重演，所以钉住。
  const form = read("components/FortuneForm.tsx");
  assert.doesNotMatch(form, /mode === "daily"/, "免费判定写死了 daily");
  assert.doesNotMatch(form, /mode !== "daily"/, "付费判定写死了 daily");
  assert.match(form, /isFreeMode/, "应通过 pricing 的 isFreeMode 判断免费与否");
});

test("不得再向 FortuneForm 传 price 属性", () => {
  for (const rel of TARGETS.filter((f) => f.startsWith("app/fortune/"))) {
    assert.doesNotMatch(read(rel), /price=/, `${rel} 仍在传 price`);
  }
});

// 价格以数据字面量的形式出现：`{ name: "月卡", price: "28.8" }`。
// 前三条规则都看不见它 —— ¥ 在隔壁 span 里、amount 容器里是 `{`、写的是 `price:` 而不是 `price=`。
// 键名不止 price：会员页被删掉的划线价原本写作 `original: "465.6"`，金额字段也常叫
// amount / cost / fee。只认 `price` 一个键名的话，换个名字就整条溜过去了。
// 反向确认：`className="amount"` 和 `price-tag` 这类 CSS 类名后面跟的是 `"` / `-`，
// 不满足 `\s*[:=]`，因此不会被误伤。
const PRICE_AS_DATA = /\b(price|original|amount|cost|fee)\s*[:=]\s*["']?\d/;

test("价格不得以数据字面量的形式出现（price: \"28.8\"）", () => {
  for (const rel of TARGETS) {
    const hit = read(rel).match(PRICE_AS_DATA);
    assert.equal(hit, null, `${rel} 里把价格写成了数据字面量：${hit?.[0] ?? ""}`);
  }
});

test("数据字面量规则不只认 price 一个键名，也不误伤 CSS 类名", () => {
  // 正向：键名换个写法同样是"把价格抄进界面"，必须抓住。
  // `original: "465.6"` 就是会员页被删掉的那条划线价的原样。
  const shouldCatch = [
    `{ original: "465.6" }`,
    `{ amount: 999 }`,
    `{ cost: '6.6' }`,
    `{ fee: 3.8 }`,
    `{ name: "月卡", price: "28.8" }`,
  ];
  for (const s of shouldCatch) {
    assert.ok(PRICE_AS_DATA.test(s), `${s} 应被数据字面量规则抓住`);
  }
  // 反向：这些是正确代码里的形状，键名后面跟的不是 `[:=]`，不能命中。
  // 否则规则会靠"误报"逼着后来者把它改回去。
  const shouldPass = [
    `<div className="amount">`,
    `<span className="price-tag">`,
    `const amount = meta.value;`,
    `price: formatPrice(MODES[mode].price),`,
  ];
  for (const s of shouldPass) {
    assert.equal(PRICE_AS_DATA.test(s), false, `${s} 属于正确写法，不该被数据字面量规则命中`);
  }
});

// 价格表里的每个数值都不许在别处当字面量再抄一遍。
// 0 是"免费模式"的占位，源码里遍地是 0，不承载价格信息，故排除。
const PRICE_VALUES = [
  ...Object.values(MODES).map((m) => m.price),
  ...MEMBER_PLANS.map((p) => p.price),
].filter((v) => v !== 0);

function numericLiteral(value: number): RegExp {
  // 用 formatPrice 生成字面量文本，"6.6" 这种要按正则转义；
  // 前后加数字/小数点护栏，避免把 16.6 或 6.65 误判成 6.6。
  const escaped = formatPrice(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d])`);
}

// SVG 的路径数据里全是坐标，`a4.8 4.8 0 0 1-4.6-3.8z` 这种串会和价格数值撞车。
// 它是几何，不是价格，扫之前先剥掉。
function stripSvgGeometry(src: string): string {
  return src.replace(/\b(d|points|viewBox)="[^"]*"/g, '$1=""');
}

test("价格表里的数值不得在其它文件里作为字面量出现", () => {
  assert.ok(PRICE_VALUES.length >= 3, `价格表疑似为空，只有 ${PRICE_VALUES.length} 个非零价格`);
  for (const rel of TARGETS) {
    const src = stripSvgGeometry(read(rel));
    for (const value of PRICE_VALUES) {
      const hit = src.match(numericLiteral(value));
      assert.equal(hit, null, `${rel} 里重复了价格表里的 ${formatPrice(value)}：${hit?.[0] ?? ""}`);
    }
  }
});

test("剥注释不会连代码里的价格一起剥掉", () => {
  const src = [
    "// 说明：以前这里写死过 ¥6.6",
    "{/* 这个价格曾经是 ¥3.8 */}",
    "const x = <span className=\"amount\">6.6</span>;",
  ].join("\n");
  const stripped = stripComments(src);
  assert.doesNotMatch(stripped, /¥6\.6/, "整行注释应被剥掉");
  assert.doesNotMatch(stripped, /¥3\.8/, "JSX 注释应被剥掉");
  assert.ok(numericLiteral(6.6).test(stripped), "代码里的 6.6 必须留下，否则守卫被架空");
});

test("剥 SVG 几何数据不会连价格一起剥掉", () => {
  const src = `<path d="M6 4a4.8 4.8 0 0 1-4.6-3.8z" /><span className="amount">3.8</span>`;
  const stripped = stripSvgGeometry(src);
  assert.ok(!stripped.includes("-3.8"), "路径数据应被剥掉");
  assert.ok(stripped.includes(`>3.8<`), "路径之外的 3.8 必须留下，否则守卫被架空");
  assert.ok(numericLiteral(3.8).test(stripped), "剥完之后仍应能抓到真正的价格字面量");
});

test("新增的两条规则确实能抓住数据字面量这种写法", () => {
  // 防止后来者把规则改窄到什么都匹配不到来"转绿"。
  const bypass = `const PLANS = [{ name: "月卡", price: "28.8" }];`;
  assert.ok(PRICE_AS_DATA.test(bypass), "price: \"28.8\" 这种写法必须被数据字面量规则抓住");
  const re = numericLiteral(9.9);
  assert.ok(re.test(`const PLANS = [{ name: "月卡", price: 9.9 }];`), "价格表里的 9.9 必须被数值规则抓住");
  assert.ok(!re.test("rgba(201, 150, 58, 0.99)"), "0.99 不应被误判为 9.9");
  // 上面那条对两侧护栏不敏感：0.99 里压根没有 9.9 这个子串，把 lookbehind 和
  // lookahead 全删掉它照样通过，等于什么都没证明。下面两条才是护栏的探针：
  // 19.9 里的 9.9 前一位是数字，只有 lookbehind 能挡住；9.91 里的 9.9 后一位是
  // 数字，只有 lookahead 能挡住。删掉任意一侧，对应的那条就会变红。
  assert.ok(!re.test("margin-bottom: 19.9px"), "19.9 里的 9.9 不应被误判（需要 lookbehind 护栏）");
  assert.ok(!re.test("schema version 9.91"), "9.91 里的 9.9 不应被误判（需要 lookahead 护栏）");
});

/* ---------------------------------------------------------------------------
 * 已知的残留缺口（刻意不修，别再重新发现一遍）
 *
 * 这是一组正则守卫，不是类型系统 —— 下面的写法目前抓不到，属于已知的代价。
 * 若将来真被测出，请加规则，不要靠"把规则改窄"来转绿。
 *
 * 1. 键名是有限枚举。规则 A 只认 price/original/amount/cost/fee 五个词，
 *    且区分大小写、左边要求词边界。`mrp: "465.6"`、`tips: 5`、
 *    `originalPrice: "465.6"`（camelCase 里 price 前面没有词边界）都漏。
 * 2. 值不是裸数字字面量就漏。`original: someVar`、`price: getP() + ""`、
 *    中文数字、`price: "免费"` 都不命中 —— 规则要的是 `[:=]` 后面直接跟数字。
 * 3. JSX 属性写法漏。`<Modal amount={6.6} />` 里 `=` 后面是 `{`，不是数字。
 *    规则 4 的 `price=` 也只覆盖 FortuneForm 那种 `price={...}` 形态，
 *    而且只扫 app/fortune/。
 * 4. 无键的裸数字漏。`<div>6.6 元</div>`、`<span>{6.6}</span>` 都看不见；
 *    只有 ¥+数字、amount 容器内容、以及表里的具体数值（规则 B）三条线兜着。
 * 5. 规则 B 只认价格表里已有的数值。像 465.6 / 999 这种表里没有的数，
 *    只有在带键名时才会被规则 A 抓到，孤立出现则完全隐形。
 * 6. 规则 1/2 依赖 codebase 的既有形状：`¥{formatPrice(...)}` 靠 `{` 让出、
 *    `className="amount"` 靠双引号。换成模板串 `¥${p}` 里直接写数字，
 *    或者 className 用单引号/无引号，仍会被抓，但反过来的"正确写法"一旦
 *    改形状（例如 `amount` 容器改成 `className='amount'`）规则 2 会静默失效。
 * 7. 监视范围只有 src/ 下的 .ts/.tsx。public/ 资源、.json、.js、脚本、
 *    Markdown 与 API 返回体都不在范围内；`lib/pricing.ts` 被整体豁免，
 *    任何新的"合法价格字面量"文件都需要同样处理，否则会满屏误报。
 * 8. 规则 B 把 0 排除在外（免费模式占位），所以写死的 `0` 价格不报。
 * ------------------------------------------------------------------------- */

