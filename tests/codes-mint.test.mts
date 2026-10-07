import test from "node:test";
import assert from "node:assert/strict";
import { mintCode, isValidCodeFormat, normalizeCode } from "../src/lib/server/codes.ts";

test("mintCode 产出 16 位、格式合法、无需规范化的大写码", () => {
  const code = mintCode();
  assert.equal(code.length, 16);
  assert.equal(isValidCodeFormat(code), true);
  // 生成即已规范：内部含小写或连字符会让"生成"与"核销"两处口径漂移
  assert.equal(normalizeCode(code), code);
});

test("mintCode 不含易混字符 I L O U", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = mintCode();
    assert.doesNotMatch(code, /[ILOU]/, `生成的码里出现了易混字符: ${code}`);
  }
});

test("mintCode 不重复", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) seen.add(mintCode());
  assert.equal(seen.size, 1000);
});
