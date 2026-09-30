import test from "node:test";
import assert from "node:assert/strict";
import { validateFortuneRequest, MAX_SHORT_FIELD } from "../src/lib/validation.ts";

const ALLOWED = ["daily", "oracle", "bazi", "tarot", "love"];

test("缺少 mode 时拒绝", () => {
  const r = validateFortuneRequest({}, ALLOWED);
  assert.equal(r.ok, false);
});

test("白名单外的 mode 被拒绝", () => {
  const r = validateFortuneRequest({ mode: "admin" }, ALLOWED);
  assert.equal(r.ok, false);
});

test("原型链上的键不被当作合法 mode", () => {
  assert.equal(validateFortuneRequest({ mode: "__proto__" }, ALLOWED).ok, false);
  assert.equal(validateFortuneRequest({ mode: "toString" }, ALLOWED).ok, false);
});

test("非对象请求体被拒绝", () => {
  assert.equal(validateFortuneRequest(null, ALLOWED).ok, false);
  assert.equal(validateFortuneRequest("x", ALLOWED).ok, false);
  assert.equal(validateFortuneRequest([], ALLOWED).ok, false);
});

test("合法请求通过并剥离 mode 与非法字段", () => {
  const r = validateFortuneRequest(
    { mode: "bazi", birthDate: "1990-01-01", evil: "x", nested: { a: 1 } },
    ALLOWED
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.mode, "bazi");
    assert.deepEqual(r.input, { birthDate: "1990-01-01" });
  }
});

test("超长短字段被拒绝", () => {
  const r = validateFortuneRequest(
    { mode: "bazi", birthDate: "x".repeat(MAX_SHORT_FIELD + 1) },
    ALLOWED
  );
  assert.equal(r.ok, false);
});

test("文本域上限比短字段宽", () => {
  const ok = validateFortuneRequest(
    { mode: "tarot", question: "x".repeat(MAX_SHORT_FIELD + 1) },
    ALLOWED
  );
  assert.equal(ok.ok, true);

  const bad = validateFortuneRequest(
    { mode: "tarot", question: "x".repeat(500 + 1) },
    ALLOWED
  );
  assert.equal(bad.ok, false);
});
