import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("首页就是排盘工具页，直接给出出生信息表单", () => {
  // 单产品站不该再有"选一种测算方式"的目录页 —— 那一步纯粹是摩擦
  assert.match(page, /<FortuneForm/);
  assert.match(page, /name: "birthDate"/);
  assert.match(page, /name: "birthTime"/);
});

test("首页不再出现已删除的四个模式入口", () => {
  for (const gone of ["今日运势", "灵签", "塔罗", "姻缘"]) {
    assert.doesNotMatch(page, new RegExp(gone), `首页仍在提「${gone}」`);
  }
});

test("首页为减少动态效果的用户提供静态体验", () => {
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});
