import test from "node:test";
import assert from "node:assert/strict";
import { buildBaziChart, chartToPrompt, type BaziInput } from "../src/lib/bazi/index.ts";

const base = (over: Partial<BaziInput>): BaziInput => ({
  birthDate: "1990-06-15",
  birthTime: "10:00",
  gender: "男",
  ...over,
});

/** 四柱压成一行，便于比对 */
const pillarsOf = (i: BaziInput) => {
  const c = buildBaziChart(i);
  return c ? c.pillars.map((p) => `${p.gan}${p.zhi}`).join(" ") : null;
};

// ── 农历输入 ─────────────────────────────────────────────

test("农历闰二月能正确换算成公历（2023 年闰二月初一 = 阳历 2023-03-22）", () => {
  const viaLunar = buildBaziChart(
    base({ birthDate: "2023-02-01", calendar: "lunar", lunarLeap: true, birthTime: "10:00" })
  )!;
  const viaSolar = buildBaziChart(base({ birthDate: "2023-03-22", calendar: "solar" }))!;

  assert.equal(viaLunar.solarDate, "2023 年 3 月 22 日");
  assert.deepEqual(
    viaLunar.pillars.map((p) => `${p.gan}${p.zhi}`),
    viaSolar.pillars.map((p) => `${p.gan}${p.zhi}`),
    "农历与阳历两条路径应排出同一张盘"
  );
});

test("不勾闰月时走的是普通二月（2023 年二月初一 = 阳历 2023-02-20）", () => {
  const c = buildBaziChart(
    base({ birthDate: "2023-02-01", calendar: "lunar", lunarLeap: false })
  )!;
  assert.equal(c.solarDate, "2023 年 2 月 20 日");
  assert.equal(c.lunarDate, "二〇二三年二月初一");
});

test("农历输入时，展示的农历日期仍是用户报的那个，不被换算过", () => {
  const c = buildBaziChart(base({ birthDate: "2025-06-01", calendar: "lunar", lunarLeap: true }))!;
  assert.equal(c.lunarDate, "二〇二五年闰六月初一");
  assert.equal(c.calendar, "lunar");
});

test("默认历法是阳历", () => {
  assert.equal(buildBaziChart(base({}))!.calendar, "solar");
  assert.equal(buildBaziChart(base({ birthDate: "2023-03-22" }))!.solarDate, "2023 年 3 月 22 日");
});

// ── 真太阳时 ─────────────────────────────────────────────

test("不填出生地就不校正，时柱按钟表时间算", () => {
  const c = buildBaziChart(base({}))!;
  assert.equal(c.trueSolarTime, undefined);
  assert.equal(c.solarOffsetMinutes, undefined);
  assert.equal(c.birthPlace, undefined);
  assert.equal(c.clockTime, "10:00");
});

test("出生地不在经度表里时同样不校正，而不是拿默认经度硬算", () => {
  const c = buildBaziChart(base({ place: "某个不存在的地方" }))!;
  assert.equal(c.trueSolarTime, undefined);
});

test("**真太阳时能改掉时柱**：乌鲁木齐 10:00 实际是辰时，不是巳时", () => {
  const plain = buildBaziChart(base({}))!;
  const withPlace = buildBaziChart(base({ place: "乌鲁木齐" }))!;

  assert.equal(plain.pillars[3].zhi, "巳", "钟表 10:00 是巳时");
  assert.equal(withPlace.pillars[3].zhi, "辰", "乌鲁木齐真太阳时 07:5x，应落入辰时");
  assert.notEqual(plain.pillars[3].zhi, withPlace.pillars[3].zhi, "时柱必须不同");
});

test("同一个钟表时间，北京与乌鲁木齐排出的盘不同 —— 这正是校正的意义", () => {
  const bj = pillarsOf(base({ place: "北京" }));
  const wlmq = pillarsOf(base({ place: "乌鲁木齐" }));
  assert.notEqual(bj, wlmq);
});

test("校正量级符合经度差：乌鲁木齐约 −130 分钟，北京只有几分钟", () => {
  const wlmq = buildBaziChart(base({ place: "乌鲁木齐" }))!;
  const bj = buildBaziChart(base({ place: "北京" }))!;
  assert.ok(Math.abs(wlmq.solarOffsetMinutes!) > 125, `乌鲁木齐应差两小时上下`);
  assert.ok(Math.abs(bj.solarOffsetMinutes!) < 20, `北京应只差十几分钟`);
});

test("**跨日时如实改日柱**：乌鲁木齐 00:30 出生，真太阳时退到前一天", () => {
  const plain = buildBaziChart(base({ birthTime: "00:30" }))!;
  const wlmq = buildBaziChart(base({ birthTime: "00:30", place: "乌鲁木齐" }))!;

  assert.equal(wlmq.trueSolarCrossedDay, true);
  assert.ok(wlmq.chartDateText, "跨日时应给出排盘实际所用日期");
  assert.notEqual(
    plain.pillars[2].gan + plain.pillars[2].zhi,
    wlmq.pillars[2].gan + wlmq.pillars[2].zhi,
    "跨日会改变日柱 —— 这也正是必须把 dayShift 用上的原因"
  );
});

test("不跨日时不给 chartDateText，免得界面上多出一行无效信息", () => {
  const c = buildBaziChart(base({ birthTime: "14:00", place: "北京" }))!;
  assert.equal(c.trueSolarCrossedDay, false);
  assert.equal(c.chartDateText, undefined);
});

test("上报的生日不被校正改写 —— 用户填的日期就是他的生日", () => {
  const c = buildBaziChart(base({ birthTime: "00:30", place: "乌鲁木齐" }))!;
  assert.equal(c.solarDate, "1990 年 6 月 15 日", "展示的生日应保持用户填的那天");
});

test("prompt 里写明了时间校正，模型才知道时柱是怎么来的", () => {
  const withPlace = chartToPrompt(buildBaziChart(base({ place: "乌鲁木齐" }))!);
  assert.match(withPlace, /真太阳时/);
  assert.match(withPlace, /乌鲁木齐/);
  assert.match(withPlace, /差 -?\d+ 分钟/);

  const plain = chartToPrompt(buildBaziChart(base({}))!);
  assert.match(plain, /未作真太阳时校正/);
});
