import test from "node:test";
import assert from "node:assert/strict";
import { payInstructionFor } from "../src/lib/pay.ts";
import { PLANS } from "../src/lib/pricing.ts";

test("金额来自 PLANS，不是调用方传进来的", () => {
  const inst = payInstructionFor("bazi");
  assert.equal(inst.amount, PLANS.bazi.price);
  assert.equal(inst.kind, "qr");
});

test("金额格式化为两位小数，用于拼收款码文件名", () => {
  const inst = payInstructionFor("bazi");
  assert.equal(inst.kind, "qr");
  if (inst.kind !== "qr") return;
  assert.deepEqual(inst.channels.map((c) => c.qrSrc), ["/pay/wechat-6.60.png"]);
});

test("年卡拼出 69.00 而不是 69", () => {
  // 两位小数不是洁癖：69 与 69.00 会指向两张不同的图，而只有一张存在
  const inst = payInstructionFor("member_year");
  assert.equal(inst.kind, "qr");
  if (inst.kind !== "qr") return;
  assert.ok(inst.channels[0]!.qrSrc.endsWith("-69.00.png"), inst.channels[0]!.qrSrc);
});

test("每个计划都给出微信渠道", () => {
  for (const planId of ["bazi", "member_month", "member_year"] as const) {
    const inst = payInstructionFor(planId);
    assert.equal(inst.kind, "qr");
    if (inst.kind !== "qr") return;
    assert.deepEqual(
      inst.channels.map((c) => c.id),
      ["wechat"],
      `${planId} 缺少渠道`
    );
  }
});

test("金额取自 PLANS，年卡是 69 而不是别的", () => {
  const inst = payInstructionFor("member_year");
  assert.equal(inst.amount, PLANS.member_year.price);
  assert.equal(inst.amount, 69);
});
