import test from "node:test";
import assert from "node:assert/strict";
import { SHENG, KE, type WuXing } from "../src/lib/bazi/constants.ts";
import {
  analyzeStrength, scoreStrength, groupElements, powerByElement,
  elementShengMe, elementKeMe, type StrengthInput,
} from "../src/lib/bazi/strength.ts";

// 帮身到极致：甲木日主，四柱全是水木
const ALL_HELP: StrengthInput = {
  dayGan: "甲",
  pillars: [
    { label: "年柱", gan: "甲", zhi: "寅" },
    { label: "月柱", gan: "乙", zhi: "卯" },
    { label: "日柱", gan: "甲", zhi: "子" },
    { label: "时柱", gan: "癸", zhi: "亥" },
  ],
};

// 耗身到极致：甲木日主，四柱全是金土火
const ALL_DRAIN: StrengthInput = {
  dayGan: "甲",
  pillars: [
    { label: "年柱", gan: "庚", zhi: "申" },
    { label: "月柱", gan: "辛", zhi: "酉" },
    { label: "日柱", gan: "甲", zhi: "午" },
    { label: "时柱", gan: "丙", zhi: "戌" },
  ],
};

test("五行求逆：生我者、克我者", () => {
  assert.equal(elementShengMe("木"), "水"); // 水生木
  assert.equal(elementKeMe("木"), "金"); // 金克木
  for (const e of ["金", "木", "水", "火", "土"] as WuXing[]) {
    assert.equal(SHENG[elementShengMe(e)], e, `生 ${e} 的应当是 ${elementShengMe(e)}`);
    assert.equal(KE[elementKeMe(e)], e, `克 ${e} 的应当是 ${elementKeMe(e)}`);
  }
});

test("十神五组的五行全部由日主推出：甲木 → 比劫木 / 食伤火 / 财土 / 官杀金 / 印水", () => {
  assert.deepEqual(groupElements("木"), { 比劫: "木", 食伤: "火", 财: "土", 官杀: "金", 印: "水" });
  assert.deepEqual(groupElements("水"), { 比劫: "水", 食伤: "木", 财: "火", 官杀: "土", 印: "金" });
});

test("月令权重翻倍：同一个月支，在月柱比在它柱分量重", () => {
  const asMonth = scoreStrength({
    dayGan: "甲",
    pillars: [{ label: "月柱", gan: "丙", zhi: "寅" }, { label: "日柱", gan: "甲", zhi: "子" }],
  });
  const asYear = scoreStrength({
    dayGan: "甲",
    pillars: [{ label: "年柱", gan: "丙", zhi: "寅" }, { label: "日柱", gan: "甲", zhi: "子" }],
  });
  const monthHelp = asMonth.entries.filter((e) => e.from.includes("寅")).reduce((s, e) => s + e.weight, 0);
  const yearHelp = asYear.entries.filter((e) => e.from.includes("寅")).reduce((s, e) => s + e.weight, 0);
  assert.equal(monthHelp, yearHelp * 2);
});

test("日干本身不参与计分 —— 它是「我」，不是「我的助力」", () => {
  const s = scoreStrength(ALL_HELP);
  assert.equal(s.entries.some((e) => e.from.includes("日柱天干甲")), false);
});

test("计分账目：每一项权重为正，且帮身+耗身等于权重总和", () => {
  for (const input of [ALL_HELP, ALL_DRAIN]) {
    const s = scoreStrength(input);
    assert.ok(s.entries.length > 0);
    for (const e of s.entries) assert.ok(e.weight > 0, `${e.from} 权重非正`);
    const sum = s.entries.reduce((acc, e) => acc + e.weight, 0);
    assert.ok(Math.abs(sum - (s.helpScore + s.drainScore)) < 1e-9);
  }
});

test("全帮身的盘判身强，全耗身的盘判身弱", () => {
  assert.equal(analyzeStrength(ALL_HELP).verdict, "身强");
  assert.equal(analyzeStrength(ALL_DRAIN).verdict, "身弱");
});

test("帮身占比落在 0..1，且与两个分项自洽", () => {
  for (const input of [ALL_HELP, ALL_DRAIN]) {
    const r = analyzeStrength(input);
    assert.ok(r.ratio > 0 && r.ratio < 1);
    assert.ok(Math.abs(r.ratio - r.helpScore / (r.helpScore + r.drainScore)) < 1e-9);
  }
});

test("身强取克泄耗为用神，身弱取生扶为用神", () => {
  const strong = analyzeStrength(ALL_HELP);
  const strongPool = [strong.groups.官杀, strong.groups.食伤, strong.groups.财];
  assert.ok(strongPool.includes(strong.yongShen), `身强却取了 ${strong.yongShen} 为用神`);

  const weak = analyzeStrength(ALL_DRAIN);
  const weakPool = [weak.groups.印, weak.groups.比劫];
  assert.ok(weakPool.includes(weak.yongShen), `身弱却取了 ${weak.yongShen} 为用神`);
});

test("喜神取生用神者，忌神取克用神者", () => {
  for (const input of [ALL_HELP, ALL_DRAIN]) {
    const r = analyzeStrength(input);
    assert.equal(SHENG[r.xiShen], r.yongShen, `喜神 ${r.xiShen} 应当生用神 ${r.yongShen}`);
    assert.equal(KE[r.jiShen], r.yongShen, `忌神 ${r.jiShen} 应当克用神 ${r.yongShen}`);
  }
});

test("身强之局，印与比劫落在忌神一侧；身弱之局反过来", () => {
  // 全帮身的盘用神取火（食伤，盘中有），忌神是克火的水 —— 水恰是甲木的印
  const strong = analyzeStrength(ALL_HELP);
  assert.equal(strong.yongShen, "火");
  assert.equal(strong.jiShen, "水", "身强时印星水应当在忌神一侧");

  // 全耗身的盘用神取水（印），忌神是克水的土 —— 土恰是甲木的财
  const weak = analyzeStrength(ALL_DRAIN);
  assert.equal(weak.yongShen, "水");
  assert.equal(weak.jiShen, "土", "身弱时财星土应当在忌神一侧");
});

test("每种判决都有一句可读结语，且带上百分比", () => {
  for (const input of [ALL_HELP, ALL_DRAIN]) {
    const r = analyzeStrength(input);
    assert.match(r.summary, /\d+%/);
    assert.ok(r.summary.includes(r.yongShen), "结语里应点明用神");
    assert.ok(r.summary.includes(r.verdict));
  }
});

test("五行势力汇总：help 与 drain 分别累加，保留两位小数", () => {
  const entries = scoreStrength(ALL_HELP).entries;
  const power = powerByElement(entries);
  const helpTotal = Object.values(power).reduce((s, v) => s + v.help, 0);
  const drainTotal = Object.values(power).reduce((s, v) => s + v.drain, 0);
  assert.ok(Math.abs(helpTotal - scoreStrength(ALL_HELP).helpScore) < 0.01);
  assert.ok(Math.abs(drainTotal - scoreStrength(ALL_HELP).drainScore) < 0.01);
});
