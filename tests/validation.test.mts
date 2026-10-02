import test from "node:test";
import assert from "node:assert/strict";
import { validateFortuneRequest, MAX_SHORT_FIELD, MAX_LONG_FIELD } from "../src/lib/validation.ts";

const ALLOWED = ["bazi"];

test("缺少 mode 时拒绝", () => {
  assert.equal(validateFortuneRequest({}, ALLOWED).ok, false);
});

test("白名单外的 mode 被拒绝", () => {
  assert.equal(validateFortuneRequest({ mode: "admin" }, ALLOWED).ok, false);
  // 已删除的模式不再是合法入口
  for (const gone of ["daily", "oracle", "tarot", "love"]) {
    assert.equal(validateFortuneRequest({ mode: gone }, ALLOWED).ok, false, `${gone} 不该仍可用`);
  }
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

test("合法请求通过并剥离非法字段", () => {
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

test("关注方向会被保留 —— 它此前不在白名单里，被服务端静默丢掉了", () => {
  const r = validateFortuneRequest(
    { mode: "bazi", birthDate: "1990-01-01", question: "事业" },
    ALLOWED
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.input.question, "事业");
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
    { mode: "bazi", question: "x".repeat(MAX_SHORT_FIELD + 1) },
    ALLOWED
  );
  assert.equal(ok.ok, true);

  const bad = validateFortuneRequest(
    { mode: "bazi", question: "x".repeat(MAX_LONG_FIELD + 1) },
    ALLOWED
  );
  assert.equal(bad.ok, false);
});
