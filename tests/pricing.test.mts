import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES, MEMBER_PLANS, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT,
  isMode, getModePrice, isFreeMode, formatPrice,
} from "../src/lib/pricing.ts";

test("五种模式的名称与价格符合统一基准", () => {
  assert.equal(MODES.daily.title, "今日运势");
  assert.equal(MODES.daily.price, 0);
  assert.equal(MODES.oracle.price, 0);
  assert.equal(MODES.bazi.price, 6.6);
  assert.equal(MODES.tarot.price, 3.8);
  assert.equal(MODES.love.price, 8.8);
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
});

test("免费模式判定", () => {
  assert.equal(isFreeMode("daily"), true);
  assert.equal(isFreeMode("oracle"), true);
  assert.equal(isFreeMode("bazi"), false);
});

test("formatPrice 不补多余小数", () => {
  assert.equal(formatPrice(6.6), "6.6");
  assert.equal(formatPrice(69), "69");
  assert.equal(formatPrice(9.9), "9.9");
});
