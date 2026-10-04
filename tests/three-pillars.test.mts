import test from "node:test";
import assert from "node:assert/strict";
import { buildBaziChart, chartToPrompt, TIME_UNKNOWN_NOTE } from "../src/lib/bazi/index.ts";

/**
 * 时辰不详：只排年、月、日三柱。
 *
 * 这是产品上必须支持的一种情况 —— 很多人根本不知道自己是几点生的，
 * 问父母也问不出来。此前的做法是时辰必填，这批人卡在表单上就走了。
 *
 * 关键在于**不猜**：不取"子时"或"午时"之类的默认值。时柱一错，
 * 时柱本身、五行分布、身强身弱、格局、大运起运岁数全跟着错。
 * 宁可少给一柱，也不能给一柱假的。
 */

const BASE = { birthDate: "1988-11-22", gender: "男", calendar: "solar" } as const;

const full = buildBaziChart({ ...BASE, birthTime: "05:45" })!;
const three = buildBaziChart({ ...BASE, birthTime: "", timeUnknown: true })!;

test("时辰不详时只出三柱", () => {
  assert.equal(full.pillars.length, 4);
  assert.equal(three.pillars.length, 3);
  assert.deepEqual(
    three.pillars.map((p) => p.label),
    ["年柱", "月柱", "日柱"]
  );
});

test("三柱与四柱的年月日必须完全一致", () => {
  // 这是三柱盘能成立的前提：内部那个用于日历换算的脚手架时刻，
  // 不能影响到年、月、日三柱。
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      three.pillars[i].gan + three.pillars[i].zhi,
      full.pillars[i].gan + full.pillars[i].zhi,
      `${three.pillars[i].label} 不一致`
    );
  }
});

test("三柱盘在全年各月日都成立 —— 不因跨日或节气而漂", () => {
  // 脚手架时刻取正午，离换日的子时最远。这里逐月验证一遍，
  // 确认年月日三柱在任何日期下都与四柱相同。
  const dates = [
    "1988-01-01", "1988-02-04", "1988-03-15", "1988-05-05",
    "1988-06-21", "1988-08-07", "1988-09-23", "1988-11-22", "1988-12-31",
  ];
  for (const d of dates) {
    const f = buildBaziChart({ ...BASE, birthDate: d, birthTime: "05:45" });
    const t = buildBaziChart({ ...BASE, birthDate: d, birthTime: "", timeUnknown: true });
    assert.ok(f && t, `${d} 应当都能排盘`);
    for (let i = 0; i < 3; i += 1) {
      assert.equal(
        t.pillars[i].gan + t.pillars[i].zhi,
        f.pillars[i].gan + f.pillars[i].zhi,
        `${d} 的 ${t.pillars[i].label} 漂了`
      );
    }
  }
});

test("时辰不详时不给出任何由时辰推出的东西", () => {
  // 命宫与身宫都要用到时辰。给出来就等于给了假数据。
  assert.equal(three.mingGong, undefined, "命宫要略去");
  assert.equal(three.shenGong, undefined, "身宫要略去");
  // 胎元只由年柱月柱决定，仍然有效
  assert.equal(three.taiYuan, full.taiYuan, "胎元应当照常给出");

  // 没有时刻就无从做真太阳时校正
  assert.equal(three.trueSolarTime, undefined);
  assert.equal(three.solarOffsetMinutes, undefined);
  assert.equal(three.clockTime, "", "钟表时间应为空串");
  assert.equal(three.birthTime, "", "时辰字段应为空串");
});

test("时辰不详被显式标出，且带上给用户看的说明", () => {
  assert.equal(three.timeUnknown, true);
  assert.equal(full.timeUnknown, undefined, "正常四柱不该带这个标记");
  assert.equal(three.timeUnknownNote, TIME_UNKNOWN_NOTE);
  // 说明必须如实讲清少了什么 —— 不淡化也不夸大
  assert.match(TIME_UNKNOWN_NOTE, /三柱/, "要说清只有三柱");
  assert.match(TIME_UNKNOWN_NOTE, /子女|晚年/, "要点明时柱所主的部分无从判断");
});

test("提示词必须告诉模型时辰不详，否则它会自己编一个时柱", () => {
  const prompt = chartToPrompt(three);

  // 要显式说明，并明确禁止模型推测。
  // 注意：这里**不能**断言"提示词里不出现「时柱」二字" —— 恰恰相反，
  // 提示词必须提到时柱来说明它缺失。早期版本的测试就是这么写错的。
  assert.match(prompt, /时辰不详/, "提示词要显式说明");
  assert.match(prompt, /没有时柱/, "要说清是没有时柱");
  assert.match(prompt, /不要提及|不要推测/, "要明确禁止模型推测时柱");

  // 真正该断言的是：**没有时柱的数据**。
  // 时柱数据的形态是「时柱：<天干><地支>」，这绝不能出现。
  assert.doesNotMatch(prompt, /时柱：[甲乙丙丁戊己庚辛壬癸]/, "提示词不得含时柱数据");
  // 三柱里只该有年月日
  assert.equal(
    [...prompt.matchAll(/^(年柱|月柱|日柱|时柱)：/gm)].map((m) => m[1]).join(","),
    "年柱,月柱,日柱",
    "提示词里只该有年、月、日三柱"
  );

  // 命宫身宫也要从提示词里去掉，免得模型拿它们当依据
  assert.doesNotMatch(prompt, /命宫|身宫/, "缺时辰时命宫身宫不该进提示词");
});

test("正常四柱的提示词不受影响", () => {
  const prompt = chartToPrompt(full);
  assert.match(prompt, /时柱/, "四柱盘照常含时柱");
  assert.match(prompt, /命宫/, "四柱盘照常含命宫");
  assert.doesNotMatch(prompt, /时辰不详/, "四柱盘不该说时辰不详");
});

test("五行分布按三柱算，不是按四柱", () => {
  // 少了时柱，力量分布必然不同 —— 这点要在数值上体现出来，
  // 而不是沿用四柱的结果（那就是自相矛盾）。
  const totalOf = (c: typeof full) =>
    Math.round(c.elements.reduce((s, e) => s + e.value, 0) * 100) / 100;
  assert.ok(
    totalOf(three) < totalOf(full),
    `三柱总量（${totalOf(three)}）应当小于四柱（${totalOf(full)}）`
  );
});
