import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES, MEMBER_PLANS, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT,
  isMode, getModePrice, isFreeMode, formatPrice,
} from "../src/lib/pricing.ts";

test("全站只有八字一个模式", () => {
  assert.deepEqual(Object.keys(MODES), ["bazi"]);
  assert.equal(MODES.bazi.title, "八字命理");
  assert.equal(MODES.bazi.price, 6.6);
});

test("会员只有月卡和年卡两种，终身卡已移除", () => {
  assert.equal(MEMBER_PLANS.length, 2);
  assert.deepEqual(MEMBER_PLANS.map((p) => p.id), ["member_month", "member_year"]);
  assert.equal(MEMBER_PLANS[0].price, 9.9);
  assert.equal(MEMBER_PLANS[1].price, 69);
});

test("额度常量为 3 与 6", () => {
  assert.equal(FREE_DAILY_QUOTA, 3);
  assert.equal(FREE_IP_DAILY_LIMIT, 6);
});

test("isMode 只认白名单内的模式", () => {
  assert.equal(isMode("bazi"), true);
  assert.equal(isMode("admin"), false);
  assert.equal(isMode(""), false);
  assert.equal(isMode("__proto__"), false);
  // 已删除的四个模式不该再被认得
  for (const gone of ["daily", "oracle", "tarot", "love"]) {
    assert.equal(isMode(gone), false, `${gone} 已删除，不该仍被 isMode 认作合法`);
  }
});

test("八字是付费模式", () => {
  assert.equal(isFreeMode("bazi"), false);
  assert.equal(getModePrice("bazi"), 6.6);
});

test("formatPrice 不补多余小数", () => {
  assert.equal(formatPrice(6.6), "6.6");
  assert.equal(formatPrice(69), "69");
  assert.equal(formatPrice(9.9), "9.9");
});
