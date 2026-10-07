import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES, MEMBER_PLANS, FREE_DAILY_QUOTA, FREE_IP_DAILY_LIMIT, SINGLE_PASS_DAYS,
  isMode, getModePrice, isFreeMode, formatPrice,
  PLANS, isPlanId,
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

test("PLANS 是价格的唯一来源，MODES 与 MEMBER_PLANS 由它派生", () => {
  assert.equal(MODES.bazi.price, PLANS.bazi.price);
  assert.equal(MODES.bazi.title, PLANS.bazi.name);

  const month = MEMBER_PLANS.find((p) => p.id === "member_month");
  const year = MEMBER_PLANS.find((p) => p.id === "member_year");
  assert.equal(month?.price, PLANS.member_month.price);
  assert.equal(month?.days, PLANS.member_month.days);
  assert.equal(year?.price, PLANS.member_year.price);
  assert.equal(year?.days, PLANS.member_year.days);
});

test("价格数值与改造前一致（改这个测试等于改价，先想清楚）", () => {
  assert.equal(PLANS.bazi.price, 6.6);
  assert.equal(PLANS.member_month.price, 9.9);
  assert.equal(PLANS.member_year.price, 69);
  assert.equal(PLANS.bazi.kind, "single");
  assert.equal(PLANS.bazi.mode, "bazi");
  assert.equal(PLANS.member_month.kind, "member");
});

test("单次计划的 days 与 SINGLE_PASS_DAYS 同源", () => {
  assert.equal(PLANS.bazi.days, SINGLE_PASS_DAYS);
});

test("isPlanId 只认已知计划", () => {
  assert.equal(isPlanId("bazi"), true);
  assert.equal(isPlanId("member_year"), true);
  assert.equal(isPlanId("member_lifetime"), false);
  assert.equal(isPlanId("__proto__"), false, "不能把原型链上的键当计划");
});
