import test from "node:test";
import assert from "node:assert/strict";
import { GAN, ZHI } from "../src/lib/bazi/constants.ts";
import { findShenSha, groupShenSha, SHEN_SHA_CAVEAT } from "../src/lib/bazi/shensha.ts";

/** 甲木日主，年支申（三合水局），四支为 申寅子戌 */
const JIA_SHEN = {
  dayGan: "甲",
  pillars: [
    { label: "年柱", gan: "甲", zhi: "申" },
    { label: "月柱", gan: "丙", zhi: "寅" },
    { label: "日柱", gan: "甲", zhi: "子" },
    { label: "时柱", gan: "甲", zhi: "戌" },
  ],
};

/** 甲木日主，年支丑（三合金局），四支为 丑卯酉巳 */
const JIA_CHOU = {
  dayGan: "甲",
  pillars: [
    { label: "年柱", gan: "乙", zhi: "丑" },
    { label: "月柱", gan: "丁", zhi: "卯" },
    { label: "日柱", gan: "甲", zhi: "酉" },
    { label: "时柱", gan: "己", zhi: "巳" },
  ],
};

const names = (hits: ReturnType<typeof findShenSha>) => hits.map((h) => h.name);

test("禄神：甲禄在寅，月支见寅即命中", () => {
  const hits = findShenSha(JIA_SHEN);
  const lu = hits.find((h) => h.name === "禄神");
  assert.ok(lu, "甲日主见寅应得禄神");
  assert.equal(lu.hitOn, "寅");
  assert.equal(lu.position, "月柱");
});

test("驿马：年支申属水局，驿马在寅", () => {
  const yi = findShenSha(JIA_SHEN).find((h) => h.name === "驿马");
  assert.ok(yi);
  assert.equal(yi.hitOn, "寅");
});

test("将星：水局将星在子，落于日支", () => {
  const jx = findShenSha(JIA_SHEN).find((h) => h.name === "将星");
  assert.ok(jx);
  assert.equal(jx.hitOn, "子");
  assert.equal(jx.position, "日柱");
});

test("月德贵人：月支寅属火局，月德为丙，月干见丙即命中", () => {
  const yd = findShenSha(JIA_SHEN).find((h) => h.name === "月德贵人");
  assert.ok(yd, "寅月见丙应为月德");
  assert.equal(yd.hitOn, "丙");
});

test("该盘不该出现的神煞就不出现", () => {
  const got = names(findShenSha(JIA_SHEN));
  // 四支申寅子戌里没有丑未，故无天乙；没有巳，故无文昌；没有卯，故无羊刃
  assert.ok(!got.includes("天乙贵人"));
  assert.ok(!got.includes("文昌贵人"));
  assert.ok(!got.includes("羊刃"));
});

test("天乙贵人：甲见丑，落在年支", () => {
  const ty = findShenSha(JIA_CHOU).find((h) => h.name === "天乙贵人");
  assert.ok(ty, "甲日主见丑应为天乙贵人");
  assert.equal(ty.hitOn, "丑");
  assert.equal(ty.position, "年柱");
});

test("文昌贵人：甲见巳，落在时支", () => {
  const wc = findShenSha(JIA_CHOU).find((h) => h.name === "文昌贵人");
  assert.ok(wc);
  assert.equal(wc.hitOn, "巳");
  assert.equal(wc.position, "时柱");
});

test("羊刃：甲刃在卯，落在月支", () => {
  const yr = findShenSha(JIA_CHOU).find((h) => h.name === "羊刃");
  assert.ok(yr);
  assert.equal(yr.hitOn, "卯");
});

test("羊刃只论阳干 —— 乙日主不报羊刃，哪怕盘里有卯", () => {
  const withYi = { ...JIA_CHOU, dayGan: "乙" };
  assert.equal(names(findShenSha(withYi)).includes("羊刃"), false);
});

test("华盖与将星：年支丑属金局，华盖在丑、将星在酉", () => {
  const hits = findShenSha(JIA_CHOU);
  assert.equal(hits.find((h) => h.name === "华盖")?.hitOn, "丑");
  assert.equal(hits.find((h) => h.name === "将星")?.hitOn, "酉");
});

test("孤辰寡宿：年支申属金局，孤辰在亥、寡宿在未", () => {
  const input = {
    dayGan: "甲",
    pillars: [
      { label: "年柱", gan: "甲", zhi: "申" },
      { label: "月柱", gan: "乙", zhi: "亥" },
      { label: "日柱", gan: "甲", zhi: "未" },
      { label: "时柱", gan: "丙", zhi: "午" },
    ],
  };
  const hits = findShenSha(input);
  const gu = hits.find((h) => h.name === "孤辰");
  const gua = hits.find((h) => h.name === "寡宿");
  assert.equal(gu?.hitOn, "亥");
  assert.equal(gu?.position, "月柱");
  assert.equal(gua?.hitOn, "未");
  assert.equal(gua?.position, "日柱");
});

test("桃花：年支申属水局，桃花在酉", () => {
  const input = {
    dayGan: "甲",
    pillars: [
      { label: "年柱", gan: "甲", zhi: "申" },
      { label: "月柱", gan: "乙", zhi: "丑" },
      { label: "日柱", gan: "甲", zhi: "酉" },
      { label: "时柱", gan: "丙", zhi: "辰" },
    ],
  };
  const th = findShenSha(input).find((h) => h.name === "桃花");
  assert.ok(th);
  assert.equal(th.hitOn, "酉");
});

test("每条命中都带位置、吉凶、人话说明", () => {
  for (const input of [JIA_SHEN, JIA_CHOU]) {
    const hits = findShenSha(input);
    assert.ok(hits.length > 0, "这两个盘都该有神煞");
    for (const h of hits) {
      assert.ok(ZHI.includes(h.hitOn as never) || GAN.includes(h.hitOn as never), `${h.hitOn} 不是干支`);
      assert.ok(/^[年月日时]柱$/.test(h.position), `${h.position} 不是柱名`);
      assert.ok(["吉", "凶", "中性"].includes(h.tone));
      assert.ok(h.plain.length >= 10, `${h.name} 的说明太短`);
    }
  }
});

test("分组只做归类，不丢也不多", () => {
  const hits = findShenSha(JIA_CHOU);
  const g = groupShenSha(hits);
  assert.equal(g.吉.length + g.凶.length + g.中性.length, hits.length);
  for (const h of g.吉) assert.equal(h.tone, "吉");
});

test("免责说明存在，且明确它不是断言", () => {
  assert.match(SHEN_SHA_CAVEAT, /倾向/);
  assert.match(SHEN_SHA_CAVEAT, /不是断言/);
});
