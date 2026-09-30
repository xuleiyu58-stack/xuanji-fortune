import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../src/", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, ROOT), "utf8");
}

const TARGETS = [
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
