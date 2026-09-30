import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("首页给首次访问者明确的今日运势入口", () => {
  assert.match(page, /立即看今日运势/);
  assert.match(page, /aria-label="前往今日运势"/);
});

test("首页为减少动态效果的用户提供静态体验", () => {
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});
