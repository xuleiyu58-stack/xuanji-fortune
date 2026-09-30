import test from "node:test";
import assert from "node:assert/strict";
import { buildBaziChart, parseHourMinute, chartToPrompt } from "../src/lib/bazi.ts";

/**
 * 正确性锚点来自**外部独立来源**，不是本库自证：
 *   文献记载 2005-02-09 为「乙酉年正月初一」，且该日为甲子日；
 *   同源推算 2005-07-18 距该日 159 天，159 mod 60 = 39，对应癸卯日。
 * 这两条同时钉住年柱、农历、生肖、日柱四条代码路径。
 */
const ANCHOR_DATE = "2005-02-09";

test("锚点：2005-02-09 为乙酉年正月初一、甲子日、属鸡", () => {
  const chart = buildBaziChart({ birthDate: ANCHOR_DATE, birthTime: "午时 11:00-13:00", gender: "男" });
  assert.ok(chart, "应能排出盘");
  assert.equal(chart.pillars[0].gan + chart.pillars[0].zhi, "乙酉");
  assert.equal(chart.pillars[2].gan + chart.pillars[2].zhi, "甲子");
  assert.equal(chart.zodiac, "鸡");
  assert.equal(chart.lunarDate, "二〇〇五年正月初一");
});

test("锚点：2005-07-18 为癸卯日", () => {
  const chart = buildBaziChart({ birthDate: "2005-07-18", birthTime: "午时 11:00-13:00", gender: "女" });
  assert.ok(chart);
  assert.equal(chart.pillars[2].gan + chart.pillars[2].zhi, "癸卯");
});

test("四柱与日主", () => {
  const chart = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
  assert.ok(chart);
  assert.deepEqual(
    chart.pillars.map((p) => p.gan + p.zhi),
    ["庚午", "己卯", "己卯", "己巳"]
  );
  assert.equal(chart.dayMaster, "己");
  assert.equal(chart.dayMasterElement, "土");
  assert.equal(chart.pillars[2].shiShen, "日主");
  assert.equal(chart.pillars[2].isDayMaster, true);
  assert.equal(chart.pillars.filter((p) => p.isDayMaster).length, 1);
});

test("男命大运顺排、女命逆排", () => {
  const male = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
  const female = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "女" });
  assert.ok(male && female);
  // 月柱己卯，顺推为庚辰，逆推为戊寅
  assert.equal(male.daYun[0].ganZhi, "庚辰");
  assert.equal(female.daYun[0].ganZhi, "戊寅");
  assert.notEqual(male.daYun[0].ganZhi, female.daYun[0].ganZhi, "性别必须影响大运方向");
});

test("大运每步跨度十年且年份连续", () => {
  const chart = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
  assert.ok(chart);
  assert.ok(chart.daYun.length >= 5);
  for (const step of chart.daYun) {
    assert.equal(step.endYear - step.startYear, 9, `${step.ganZhi} 跨度应为十年`);
  }
  for (let i = 1; i < chart.daYun.length; i++) {
    assert.equal(chart.daYun[i].startYear, chart.daYun[i - 1].endYear + 1, "大运年份应首尾相接");
  }
});

test("五行统计：非负、占比合计约 100", () => {
  const chart = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
  assert.ok(chart);
  assert.equal(chart.elements.length, 5);
  for (const e of chart.elements) {
    assert.ok(e.value >= 0, `${e.element} 分值不应为负`);
    assert.ok(e.percent >= 0 && e.percent <= 100);
  }
  const sum = chart.elements.reduce((s, e) => s + e.percent, 0);
  assert.ok(sum >= 99 && sum <= 101, `占比合计应约为 100，实际 ${sum}`);
});

test("五行强弱与缺失判定自洽", () => {
  const chart = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
  assert.ok(chart);
  const strongest = chart.elements.find((e) => e.element === chart.strongest);
  const weakest = chart.elements.find((e) => e.element === chart.weakest);
  assert.ok(strongest && weakest);
  assert.ok(strongest.value >= weakest.value);
  // missing 必须是分值为 0 的那些
  const zero = chart.elements.filter((e) => e.value === 0).map((e) => e.element);
  assert.deepEqual([...chart.missing].sort(), [...zero].sort());
});

test("早子时与晚子时的时柱不同", () => {
  const early = buildBaziChart({ birthDate: "1990-03-15", birthTime: "早子时 00:00-01:00", gender: "男" });
  const late = buildBaziChart({ birthDate: "1990-03-15", birthTime: "晚子时 23:00-24:00", gender: "男" });
  assert.ok(early && late);
  // 本库采用「日柱不变、晚子时时柱按次日日干起」的口径
  assert.equal(early.pillars[2].gan + early.pillars[2].zhi, "己卯");
  assert.equal(late.pillars[2].gan + late.pillars[2].zhi, "己卯");
  assert.equal(early.pillars[3].gan + early.pillars[3].zhi, "甲子");
  assert.equal(late.pillars[3].gan + late.pillars[3].zhi, "丙子");
  assert.notEqual(
    early.pillars[3].gan + early.pillars[3].zhi,
    late.pillars[3].gan + late.pillars[3].zhi,
    "两半子时的时柱必须区分，否则四分之一张盘是错的"
  );
});

test("时辰解析", () => {
  assert.deepEqual(parseHourMinute("巳时 09:00-11:00"), { hour: 9, minute: 0 });
  assert.deepEqual(parseHourMinute("10:30"), { hour: 10, minute: 30 });
  assert.deepEqual(parseHourMinute("子时 23:00-01:00"), { hour: 23, minute: 0 });
  assert.equal(parseHourMinute("请选择"), null);
  assert.equal(parseHourMinute(""), null);
  assert.equal(parseHourMinute("25:00"), null);
});

test("非法输入返回 null 而不是抛异常", () => {
  const bad = [
    { birthDate: "", birthTime: "巳时 09:00-11:00", gender: "男" },
    { birthDate: "1990/03/15", birthTime: "巳时 09:00-11:00", gender: "男" },
    { birthDate: "1990-03-15", birthTime: "请选择", gender: "男" },
    { birthDate: "1800-03-15", birthTime: "巳时 09:00-11:00", gender: "男" },
  ];
  for (const input of bad) {
    assert.equal(buildBaziChart(input), null, `应拒绝：${JSON.stringify(input)}`);
  }
});

test("喂给模型的文本包含四柱与日主", () => {
  const chart = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
  assert.ok(chart);
  const prompt = chartToPrompt(chart);
  assert.match(prompt, /庚午/);
  assert.match(prompt, /己卯/);
  assert.match(prompt, /日主：己（土）/);
  assert.match(prompt, /大运：/);
});
