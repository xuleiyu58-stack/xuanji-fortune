import test from "node:test";
import assert from "node:assert/strict";
import {
  zodiacRelation,
  elementRelation,
  matchCharts,
  loveToPrompt,
  ZHI_PAIRS,
} from "../src/lib/love.ts";
import { buildBaziChart } from "../src/lib/bazi.ts";

test("生肖六合", () => {
  assert.equal(zodiacRelation("子", "丑"), "六合");
  assert.equal(zodiacRelation("丑", "子"), "六合");
  assert.equal(zodiacRelation("寅", "亥"), "六合");
  assert.equal(zodiacRelation("午", "未"), "六合");
});

test("生肖六冲", () => {
  assert.equal(zodiacRelation("子", "午"), "六冲");
  assert.equal(zodiacRelation("卯", "酉"), "六冲");
  assert.equal(zodiacRelation("辰", "戌"), "六冲");
});

test("生肖六害与相刑", () => {
  assert.equal(zodiacRelation("子", "未"), "六害");
  assert.equal(zodiacRelation("卯", "辰"), "六害");
  assert.equal(zodiacRelation("子", "卯"), "相刑");
});

test("同时成立两种关系时取更重的那个", () => {
  // 寅巳既属六害又属相刑（寅巳申三刑）—— 必须判相刑，判成六害会低估严重度
  assert.equal(zodiacRelation("寅", "巳"), "相刑");
  const bothHayAndXing = (x: string, y: string) =>
    ZHI_PAIRS.六害.some(([a, b]) => (a === x && b === y) || (a === y && b === x)) &&
    ZHI_PAIRS.相刑.some(([a, b]) => (a === x && b === y) || (a === y && b === x));
  assert.ok(bothHayAndXing("寅", "巳"), "寅巳确实同时在六害与相刑两张表里");
  // 寅申既相冲又相刑 —— 冲更重
  assert.equal(zodiacRelation("寅", "申"), "六冲");
});

test("生肖三合", () => {
  assert.equal(zodiacRelation("申", "子"), "三合");
  assert.equal(zodiacRelation("子", "辰"), "三合");
  assert.equal(zodiacRelation("亥", "卯"), "三合");
  assert.equal(zodiacRelation("亥", "未"), "三合");
});

test("同支为自刑", () => {
  assert.equal(zodiacRelation("辰", "辰"), "自刑");
  assert.equal(zodiacRelation("午", "午"), "自刑");
});

test("六冲优先于三合 —— 两者不能同时成立", () => {
  // 子午相冲，但子与辰申三合。冲的判定必须先于合。
  assert.equal(zodiacRelation("子", "午"), "六冲");
  assert.notEqual(zodiacRelation("子", "午"), "三合");
});

test("一般组合判为普通", () => {
  assert.equal(zodiacRelation("子", "寅"), "普通");
  assert.equal(zodiacRelation("丑", "卯"), "普通");
});

test("五行关系：相生、比和、相克", () => {
  assert.equal(elementRelation("木", "火"), "相生");
  assert.equal(elementRelation("火", "木"), "相生");
  assert.equal(elementRelation("水", "金"), "相生");
  assert.equal(elementRelation("土", "土"), "比和");
  assert.equal(elementRelation("木", "土"), "相克");
  assert.equal(elementRelation("金", "木"), "相克");
});

test("两个五行之间的关系必有且仅有三种之一", () => {
  const els = ["金", "木", "水", "火", "土"] as const;
  for (const x of els) {
    for (const y of els) {
      const r = elementRelation(x, y);
      assert.ok(["相生", "比和", "相克"].includes(r), `${x}/${y} 判成了 ${r}`);
      assert.equal(elementRelation(x, y), elementRelation(y, x), "五行关系应对称");
    }
  }
});

const chartA = buildBaziChart({ birthDate: "1990-03-15", birthTime: "巳时 09:00-11:00", gender: "男" });
const chartB = buildBaziChart({ birthDate: "1993-10-20", birthTime: "申时 15:00-17:00", gender: "女" });

test("合婚：分数落在 0-100，且与各项加减分自洽", () => {
  assert.ok(chartA && chartB);
  const m = matchCharts(chartA, chartB);
  assert.ok(m.score >= 0 && m.score <= 100, `分数越界：${m.score}`);
  const sum = 50 + m.factors.reduce((s, f) => s + f.delta, 0);
  assert.equal(m.score, Math.max(0, Math.min(100, sum)), "分数必须等于加权和（截断后）");
});

test("合婚：每一项加减分都带可读依据", () => {
  assert.ok(chartA && chartB);
  const m = matchCharts(chartA, chartB);
  assert.ok(m.factors.length >= 2);
  for (const f of m.factors) {
    assert.ok(f.name.length > 0);
    assert.ok(f.detail.length > 0, `${f.name} 缺依据说明`);
    assert.ok(Number.isFinite(f.delta));
  }
  assert.ok(m.band.length > 0);
});

test("合婚：生肖与日主关系与独立判定函数一致", () => {
  assert.ok(chartA && chartB);
  const m = matchCharts(chartA, chartB);
  assert.equal(m.zodiac.relation, zodiacRelation(chartA.pillars[0].zhi, chartB.pillars[0].zhi));
  assert.equal(m.dayMaster.relation, elementRelation(chartA.dayMasterElement, chartB.dayMasterElement));
});

test("合婚：完全相同的两个人（自配）不应判为高分", () => {
  assert.ok(chartA);
  const m = matchCharts(chartA, chartA);
  // 同支自刑 -6，日主比和 +8，基数 50 → 52；互补必为空
  assert.ok(m.score < 65, `同盘自配不该是高分，实际 ${m.score}`);
  assert.equal(m.zodiac.relation, "自刑");
  assert.equal(m.dayMaster.relation, "比和");
  assert.deepEqual(m.complements, [], "自己补不了自己缺的五行");
});

test("合婚：互补只认对方明显偏旺的五行", () => {
  assert.ok(chartA && chartB);
  const m = matchCharts(chartA, chartB);
  const strongB = new Set(chartB.elements.filter((e) => e.percent >= 20).map((e) => e.element));
  const strongA = new Set(chartA.elements.filter((e) => e.percent >= 20).map((e) => e.element));
  const expected = [
    ...new Set([...chartA.missing.filter((e) => strongB.has(e)), ...chartB.missing.filter((e) => strongA.has(e))]),
  ];
  assert.deepEqual(m.complements, expected);
});

test("喂给模型的文本列出分数与依据", () => {
  assert.ok(chartA && chartB);
  const m = matchCharts(chartA, chartB);
  const prompt = loveToPrompt(m);
  assert.match(prompt, new RegExp(`${m.score} 分`));
  assert.match(prompt, /生肖/);
  assert.match(prompt, /日主/);
  assert.match(prompt, /不得改动/);
});
