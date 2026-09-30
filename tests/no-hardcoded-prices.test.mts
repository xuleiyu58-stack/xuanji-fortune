import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MODES, MEMBER_PLANS, formatPrice } from "../src/lib/pricing.ts";

const ROOT = new URL("../src/", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
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

test("不得再向 FortuneForm 传 price 属性", () => {
  for (const rel of TARGETS.filter((f) => f.startsWith("app/fortune/"))) {
    assert.doesNotMatch(read(rel), /price=/, `${rel} 仍在传 price`);
  }
});

// 价格以数据字面量的形式出现：`{ name: "月卡", price: "28.8" }`。
// 前三条规则都看不见它 —— ¥ 在隔壁 span 里、amount 容器里是 `{`、写的是 `price:` 而不是 `price=`。
const PRICE_AS_DATA = /price\s*[:=]\s*["']?\d/;

test("价格不得以数据字面量的形式出现（price: \"28.8\"）", () => {
  for (const rel of TARGETS) {
    const hit = read(rel).match(PRICE_AS_DATA);
    assert.equal(hit, null, `${rel} 里把价格写成了数据字面量：${hit?.[0] ?? ""}`);
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

test("价格表里的数值不得在其它文件里作为字面量出现", () => {
  assert.ok(PRICE_VALUES.length >= 3, `价格表疑似为空，只有 ${PRICE_VALUES.length} 个非零价格`);
  for (const rel of TARGETS) {
    const src = read(rel);
    for (const value of PRICE_VALUES) {
      const hit = src.match(numericLiteral(value));
      assert.equal(hit, null, `${rel} 里重复了价格表里的 ${formatPrice(value)}：${hit?.[0] ?? ""}`);
    }
  }
});

test("新增的两条规则确实能抓住数据字面量这种写法", () => {
  // 防止后来者把规则改窄到什么都匹配不到来"转绿"。
  const bypass = `const PLANS = [{ name: "月卡", price: "28.8" }];`;
  assert.ok(PRICE_AS_DATA.test(bypass), "price: \"28.8\" 这种写法必须被数据字面量规则抓住");
  const re = numericLiteral(9.9);
  assert.ok(re.test(`const PLANS = [{ name: "月卡", price: 9.9 }];`), "价格表里的 9.9 必须被数值规则抓住");
  assert.ok(!re.test("rgba(201, 150, 58, 0.99)"), "0.99 不应被误判为 9.9");
});
