import test from "node:test";
import assert from "node:assert/strict";
import { GAN, ZHI } from "../src/lib/bazi/constants.ts";
import { analyzePattern, patternPlain } from "../src/lib/bazi/pattern.ts";

/** 甲木日主，月支可换 */
const jiaWithMonth = (monthZhi: string, monthGan = "丙") => ({
  dayGan: "甲",
  pillars: [
    { label: "年柱", gan: "甲", zhi: "子" },
    { label: "月柱", gan: monthGan, zhi: monthZhi },
    { label: "日柱", gan: "甲", zhi: "子" },
    { label: "时柱", gan: "甲", zhi: "子" },
  ],
});

test("月支本气为正官 → 正官格（甲日酉月，酉藏辛，辛克甲为正官）", () => {
  const p = analyzePattern(jiaWithMonth("酉"))!;
  assert.equal(p.name, "正官格");
  assert.equal(p.shiShen, "正官");
  assert.equal(p.basis, "月支本气");
  assert.match(p.note, /酉/);
  assert.match(p.note, /辛/);
});

test("月支本气为正财 → 正财格（甲日丑月，丑本气己）", () => {
  const p = analyzePattern(jiaWithMonth("丑"))!;
  assert.equal(p.name, "正财格");
  assert.equal(p.shiShen, "正财");
});

test("月支本气为七杀 → 七杀格（甲日申月，申本气庚）", () => {
  assert.equal(analyzePattern(jiaWithMonth("申"))?.name, "七杀格");
});

test("月支本气为正印 → 正印格（甲日子月，子藏癸）", () => {
  assert.equal(analyzePattern(jiaWithMonth("子"))?.name, "正印格");
});

test("月支本气为偏印 → 偏印格（甲日亥月，亥本气壬）", () => {
  assert.equal(analyzePattern(jiaWithMonth("亥"))?.name, "偏印格");
});

test("月支本气为食神 → 食神格（甲日巳月，巳本气丙）", () => {
  assert.equal(analyzePattern(jiaWithMonth("巳"))?.name, "食神格");
});

test("**建禄格**：甲日寅月，寅是甲的禄位 —— 不能被中气丙截走取成食神格", () => {
  const p = analyzePattern(jiaWithMonth("寅"))!;
  assert.equal(p.name, "建禄格", `寅月甲日应取建禄格，实际取到 ${p.name}`);
  assert.equal(p.shiShen, null);
  assert.match(p.note, /禄/);
});

test("**羊刃格**：甲日卯月，卯是甲的帝旺之地", () => {
  const p = analyzePattern(jiaWithMonth("卯"))!;
  assert.equal(p.name, "羊刃格", `卯月甲日应取羊刃格，实际取到 ${p.name}`);
});

test("乙日卯月是建禄格 —— 卯正是乙木的禄位（乙长生在午、逆行至卯为临官）", () => {
  const p = analyzePattern({
    dayGan: "乙",
    pillars: [
      { label: "年柱", gan: "乙", zhi: "子" },
      { label: "月柱", gan: "乙", zhi: "卯" },
      { label: "日柱", gan: "乙", zhi: "子" },
      { label: "时柱", gan: "乙", zhi: "子" },
    ],
  })!;
  assert.equal(p.name, "建禄格");
});

test("阴干不论羊刃：乙日寅月是帝旺之地，但落到比劫格而不是羊刃格", () => {
  const p = analyzePattern({
    dayGan: "乙",
    pillars: [
      { label: "年柱", gan: "乙", zhi: "子" },
      { label: "月柱", gan: "乙", zhi: "寅" },
      { label: "日柱", gan: "乙", zhi: "子" },
      { label: "时柱", gan: "乙", zhi: "子" },
    ],
  })!;
  assert.equal(p.name, "比劫格", `阴干不该取羊刃格，实际取到 ${p.name}`);
});

test("透干会被标出来，并在说明里写明", () => {
  // 甲日酉月，辛透到月干上
  const p = analyzePattern(jiaWithMonth("酉", "辛"))!;
  assert.equal(p.transparent, true);
  assert.match(p.note, /透出天干/);

  const q = analyzePattern(jiaWithMonth("酉", "丙"))!;
  assert.equal(q.transparent, false);
  assert.match(q.note, /未透天干/);
});

test("十种月支对甲日都能取到一个格，没有落空的", () => {
  for (const zhi of ZHI) {
    const p = analyzePattern(jiaWithMonth(zhi));
    assert.ok(p, `月支${zhi}取格失败`);
    assert.ok(p.name.endsWith("格"), `${zhi} 取到的格名不合法：${p.name}`);
    assert.ok(p.plain.length >= 15, `${p.name} 的人话说明太短`);
    assert.ok(p.note.length >= 15, `${p.name} 的推理说明太短`);
  }
});

test("缺少月柱时返回 null，而不是编一个格出来", () => {
  assert.equal(
    analyzePattern({
      dayGan: "甲",
      pillars: [
        { label: "年柱", gan: "甲", zhi: "子" },
        { label: "日柱", gan: "甲", zhi: "子" },
      ],
    }),
    null
  );
});

test("格名与人话对得上，且每个格都有说明", () => {
  const names = ["正官格", "七杀格", "正财格", "偏财格", "正印格", "偏印格", "食神格", "伤官格", "建禄格", "羊刃格", "比劫格"];
  for (const n of names) {
    assert.notEqual(patternPlain(n), patternPlain("不存在的格"));
  }
});

test("取格说明里点明了日主、月支与本气，用户可自行核验", () => {
  const p = analyzePattern(jiaWithMonth("酉"))!;
  for (const token of ["甲", "酉", "辛"]) {
    assert.ok(p.note.includes(token), `说明里应出现「${token}」`);
  }
  assert.ok(GAN.includes("辛"));
});
