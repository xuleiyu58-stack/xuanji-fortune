import test from "node:test";
import assert from "node:assert/strict";
import {
  dayOfYear, equationOfTimeMinutes, trueSolarOffsetMinutes,
  toTrueSolarTime, formatClock, describeOffset,
} from "../src/lib/bazi/solar-time.ts";
import { PLACES, PLACE_NAMES, longitudeOf } from "../src/lib/bazi/places.ts";

test("一年中的第几天", () => {
  assert.equal(dayOfYear(2026, 1, 1), 1);
  assert.equal(dayOfYear(2026, 1, 31), 31);
  assert.equal(dayOfYear(2026, 2, 1), 32);
  assert.equal(dayOfYear(2026, 12, 31), 365);
  assert.equal(dayOfYear(2024, 12, 31), 366, "2024 是闰年");
});

test("均时差的两个极值：2 月中旬约 −14 分，11 月初约 +16 分", () => {
  // 这是可以从天文年历核对的事实，不是自证
  const feb = equationOfTimeMinutes(2026, 2, 11);
  const nov = equationOfTimeMinutes(2026, 11, 3);
  assert.ok(feb < -12 && feb > -17, `2 月 11 日应为约 −14 分，实际 ${feb.toFixed(1)}`);
  assert.ok(nov > 13 && nov < 19, `11 月 3 日应为约 +16 分，实际 ${nov.toFixed(1)}`);
});

test("均时差全年在 −17..+17 分之间，且大致过零", () => {
  let min = Infinity;
  let max = -Infinity;
  for (let d = 1; d <= 365; d += 5) {
    const v = equationOfTimeMinutes(2026, 1, d);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  assert.ok(min > -18 && max < 18, `均时差越界：${min.toFixed(1)}..${max.toFixed(1)}`);
  // 4 月中旬前后应接近 0
  assert.ok(Math.abs(equationOfTimeMinutes(2026, 4, 15)) < 1.5);
});

test("经度时差：每偏离中央经线 1° 差 4 分钟", () => {
  // 取一个均时差接近 0 的日子，把经度项单独看出来
  const day = 15;
  const month = 4;
  const at120 = trueSolarOffsetMinutes(120, 2026, month, day);
  const at121 = trueSolarOffsetMinutes(121, 2026, month, day);
  assert.ok(Math.abs(at121 - at120 - 4) < 1e-9, "1° 应恰好差 4 分钟");
});

test("乌鲁木齐比北京时间慢两个多小时 —— 这正是真太阳时最该被用上的地方", () => {
  const offset = trueSolarOffsetMinutes(87.62, 2026, 4, 15);
  assert.ok(offset < -125, `乌鲁木齐应慢约 130 分钟，实际 ${offset.toFixed(1)}`);
});

test("跨午夜时如实报告 dayShift —— 用错会让日柱整整差一天", () => {
  // 乌鲁木齐 00:30 出生，真太阳时要退到前一天
  const r = toTrueSolarTime(0, 30, 87.62, 2026, 6, 15);
  assert.equal(r.dayShift, -1);
  assert.equal(r.crossedDay, true);
  assert.ok(r.hour >= 22, `退一天后应落在 22 点左右，实际 ${r.hour}`);

  // 东部城市深夜出生会进到第二天
  const fwd = toTrueSolarTime(23, 55, 121.52, 2026, 11, 3);
  assert.ok(fwd.dayShift >= 0);
});

test("不跨日时 dayShift 为 0", () => {
  const r = toTrueSolarTime(12, 0, 116.41, 2026, 4, 15);
  assert.equal(r.dayShift, 0);
  assert.equal(r.crossedDay, false);
  assert.equal(r.hour, 11);
  assert.ok(r.minute >= 0 && r.minute < 60);
});

test("校正结果永远是合法的时刻", () => {
  for (const lon of [87.62, 104.07, 116.41, 120, 126.53]) {
    for (const h of [0, 6, 12, 18, 23]) {
      for (const m of [0, 30, 59]) {
        const r = toTrueSolarTime(h, m, lon, 2026, 7, 1);
        assert.ok(r.hour >= 0 && r.hour <= 23, `${lon} ${h}:${m} → 小时越界 ${r.hour}`);
        assert.ok(r.minute >= 0 && r.minute <= 59, `${lon} ${h}:${m} → 分钟越界 ${r.minute}`);
      }
    }
  }
});

test("中央经线上的偏移只剩均时差，量级只有十几分钟", () => {
  const r = toTrueSolarTime(12, 0, 120, 2026, 4, 15);
  assert.ok(Math.abs(r.offsetMinutes) < 20);
});

test("formatClock 补齐两位", () => {
  assert.equal(formatClock(9, 5), "09:05");
  assert.equal(formatClock(0, 0), "00:00");
  assert.equal(formatClock(23, 59), "23:59");
});

test("偏移说明是人话，且带上城市名", () => {
  const s = describeOffset(-130, "乌鲁木齐");
  assert.ok(s.includes("乌鲁木齐"));
  assert.match(s, /\d+ 分钟/);
  assert.match(s, /慢/);

  const fast = describeOffset(30, "上海");
  assert.match(fast, /快/);

  // 偏移极小时说明「几乎一致」，而不是硬报一个 0 分钟
  assert.match(describeOffset(0, "杭州"), /几乎一致/);
});

test("经度表：城市不重名，经度落在中国的合理范围内", () => {
  assert.equal(new Set(PLACE_NAMES).size, PLACES.length, "有重名城市");
  for (const p of PLACES) {
    assert.ok(p.longitude > 70 && p.longitude < 136, `${p.name} 的经度 ${p.longitude} 不在中国范围内`);
  }
});

test("按名取经度；取不到时返回 undefined 而不是兜底值", () => {
  assert.equal(longitudeOf("北京"), 116.41);
  assert.equal(longitudeOf("  北京  "), 116.41, "应容忍前后空格");
  assert.equal(longitudeOf("不存在的城市"), undefined);
  assert.equal(longitudeOf(undefined), undefined);
  assert.equal(longitudeOf(""), undefined);
});
