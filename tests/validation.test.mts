import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFortuneRequest,
  validateReadingPayload,
  MAX_SHORT_FIELD,
  MAX_LONG_FIELD,
  MAX_READING_RESULT,
} from "../src/lib/validation.ts";

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

// ── 上云记录的校验 ─────────────────────────────────────────

const READING = { mode: "bazi", title: "八字命理", result: "【命局总评】…", input: { calendar: "solar" } };

test("合法的上云记录通过", () => {
  const r = validateReadingPayload(READING);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.mode, "bazi");
    assert.equal(r.value.title, "八字命理");
  }
});

test("非对象一律拒绝", () => {
  for (const bad of [null, undefined, "x", 42, []]) {
    assert.equal(validateReadingPayload(bad).ok, false, `${JSON.stringify(bad)} 不该通过`);
  }
});

test("缺 mode / title / result 时拒绝", () => {
  assert.equal(validateReadingPayload({ ...READING, mode: "" }).ok, false);
  assert.equal(validateReadingPayload({ ...READING, title: "  " }).ok, false);
  assert.equal(validateReadingPayload({ ...READING, result: "" }).ok, false);
  assert.equal(validateReadingPayload({ ...READING, result: "   \n " }).ok, false, "纯空白不算内容");
});

test("过长的正文被拒绝 —— 没有上限就能被灌任意大的文本", () => {
  const ok = validateReadingPayload({ ...READING, result: "x".repeat(MAX_READING_RESULT) });
  assert.equal(ok.ok, true, "正好到上限应通过");

  const bad = validateReadingPayload({ ...READING, result: "x".repeat(MAX_READING_RESULT + 1) });
  assert.equal(bad.ok, false);
});

test("input 只保留字符串值，且逐项限长", () => {
  const r = validateReadingPayload({
    ...READING,
    input: {
      calendar: "solar",
      nested: { evil: true },       // 非字符串，丢弃
      big: "x".repeat(MAX_LONG_FIELD + 1), // 过长，丢弃
      ["k".repeat(41)]: "v",        // 键名过长，丢弃
    },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(Object.keys(r.value.input), ["calendar"]);
  }
});

test("input 不是对象时退化成空对象，而不是报错", () => {
  // 历史记录可能来自没有 input 的旧版本，不该因此判为非法
  for (const bad of [null, "x", 42, []]) {
    const r = validateReadingPayload({ ...READING, input: bad });
    assert.equal(r.ok, true, `input=${JSON.stringify(bad)} 应仍可保存`);
    if (r.ok) assert.deepEqual(r.value.input, {});
  }
});

test("不套用 MODE_FIELDS 白名单 —— 老记录不该被今天的字段集合判为非法", () => {
  // 排盘请求的 input 会进 prompt，所以要白名单；
  // 记录的 input 只是存档，用白名单卡会把历史记录全部判非法。
  const r = validateReadingPayload({
    ...READING,
    input: { province: "北京市", city: "北京市", question: "事业", lunarLeap: "false" },
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(Object.keys(r.value.input).length, 4);
});
