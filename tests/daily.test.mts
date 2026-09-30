import test from "node:test";
import assert from "node:assert/strict";
import {
  BAGUA,
  BAGUA_ORDER,
  castDailyHexagram,
  hexagramName,
  movingLineIndex,
  parseDailyReading,
  stripStructuredSections,
  type BaGuaName,
} from "../src/lib/daily.ts";

test("八卦爻线与取象歌一致", () => {
  // 乾三连、坤六断、震仰盂、艮覆碗、离中虚、坎中满、兑上缺、巽下断
  assert.deepEqual(BAGUA.乾.bars, [true, true, true]);
  assert.deepEqual(BAGUA.坤.bars, [false, false, false]);
  assert.deepEqual(BAGUA.震.bars, [false, false, true]); // 仰盂：下实上虚
  assert.deepEqual(BAGUA.艮.bars, [true, false, false]); // 覆碗：上实下虚
  assert.deepEqual(BAGUA.离.bars, [true, false, true]); // 中虚
  assert.deepEqual(BAGUA.坎.bars, [false, true, false]); // 中满
  assert.deepEqual(BAGUA.兑.bars, [false, true, true]); // 上缺
  assert.deepEqual(BAGUA.巽.bars, [true, true, false]); // 下断
});

test("八纯卦：上下同卦即该卦本身", () => {
  for (const name of BAGUA_ORDER) {
    assert.equal(hexagramName(name, name), `${name}为${BAGUA[name].image}`, `${name}的纯卦名不对`);
  }
});

test("卦名与文王卦序可交叉验证", () => {
  // 这八个卦在传世卦序里的位置是确定的，用来钉住整张表的行列方向
  assert.equal(hexagramName("乾", "乾"), "乾为天"); // 1
  assert.equal(hexagramName("坤", "坤"), "坤为地"); // 2
  assert.equal(hexagramName("坎", "震"), "水雷屯"); // 3：上坎水下震雷
  assert.equal(hexagramName("艮", "坎"), "山水蒙"); // 4：上艮山下坎水
  assert.equal(hexagramName("坤", "乾"), "地天泰"); // 11：上坤地下乾天
  assert.equal(hexagramName("乾", "坤"), "天地否"); // 12
  assert.equal(hexagramName("坎", "离"), "水火既济"); // 63
  assert.equal(hexagramName("离", "坎"), "火水未济"); // 64
});

test("卦名读法是「上卦象＋下卦象＋卦名」", () => {
  // 水雷屯 = 上坎(水) 下震(雷)；屯是卦名
  const name = hexagramName("坎", "震");
  assert.ok(name.startsWith("水雷"), `应以「水雷」开头，实际 ${name}`);
  assert.equal(name.slice(2), "屯");
});

test("起卦：六爻为上卦三爻接下卦三爻", () => {
  const h = castDailyHexagram(new Date(2026, 8, 30));
  assert.equal(h.lines.length, 6);
  assert.deepEqual(h.lines.slice(0, 3), [...h.upper.bars]);
  assert.deepEqual(h.lines.slice(3, 6), [...h.lower.bars]);
  assert.equal(h.name, hexagramName(h.upper.name, h.lower.name));
});

test("起卦：动爻落在 1-6", () => {
  for (let d = 1; d <= 28; d++) {
    const h = castDailyHexagram(new Date(2026, 8, d));
    assert.ok(h.movingLine >= 1 && h.movingLine <= 6, `动爻越界：${h.movingLine}`);
  }
});

test("动爻下标：初爻对应数组末位，上爻对应首位", () => {
  // 爻号自下而上，数组自上而下，方向相反 —— 这里钉死换算，防止渲染层算反
  const h = castDailyHexagram(new Date(2026, 8, 30));
  assert.equal(movingLineIndex({ ...h, movingLine: 1 }), 5, "初爻（最下）应落在数组末位");
  assert.equal(movingLineIndex({ ...h, movingLine: 6 }), 0, "上爻（最上）应落在数组首位");
  assert.equal(movingLineIndex({ ...h, movingLine: 3 }), 3);
  for (let m = 1; m <= 6; m++) {
    const idx = movingLineIndex({ ...h, movingLine: m });
    assert.ok(idx >= 0 && idx < 6, `动爻 ${m} 的下标越界：${idx}`);
  }
});

test("起卦：同一天同一卦，连续多天应出现不同卦", () => {
  const a = castDailyHexagram(new Date(2026, 8, 30, 1, 0, 0));
  const b = castDailyHexagram(new Date(2026, 8, 30, 23, 0, 0));
  assert.equal(a.name, b.name, "同一自然日应同卦，否则'今日之卦'就不成立");
  assert.equal(a.ganzhi, b.ganzhi);

  const names = new Set<string>();
  for (let d = 1; d <= 30; d++) names.add(castDailyHexagram(new Date(2026, 8, d)).name);
  assert.ok(names.size >= 10, `一个月内只出现了 ${names.size} 种卦，起卦可能退化了`);
});

test("起卦：干支取自真实历法", () => {
  const h = castDailyHexagram(new Date(2026, 8, 30));
  assert.match(h.ganzhi, /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/);
  assert.ok(h.lunarDate.length > 0);
});

test("解读解析：正常的宜忌幸运能抽出来", () => {
  const text = [
    "【卦象解读】",
    "今日气机通畅，宜顺势而为。",
    "【宜】祭祀、出行、签约",
    "【忌】动土、远行、争执",
    "【幸运指南】颜色：青｜数字：3｜方位：东南",
    "【大师寄语】",
    "心静则明。",
  ].join("\n");

  const r = parseDailyReading(text, castDailyHexagram(new Date(2026, 8, 30)));
  assert.ok(r);
  assert.deepEqual(r.good, ["祭祀", "出行", "签约"]);
  assert.deepEqual(r.bad, ["动土", "远行", "争执"]);
  assert.equal(r.lucky.color, "青");
  assert.equal(r.lucky.number, "3");
  assert.equal(r.lucky.direction, "东南");
});

test("解读解析：格式不符时返回 null 而不是乱猜", () => {
  const h = castDailyHexagram(new Date(2026, 8, 30));
  assert.equal(parseDailyReading("今天不错，宜出门。", h), null, "没有【宜】标记应放弃解析");
  assert.equal(parseDailyReading("【宜】出行\n没有忌", h), null, "缺【忌】应放弃解析");
  assert.equal(parseDailyReading("【宜】\n【忌】\n", h), null, "空内容应放弃解析");
});

test("解读解析：幸运项缺项时留空而不是报错", () => {
  const text = "【宜】出行\n【忌】争执\n【幸运指南】颜色：赤";
  const r = parseDailyReading(text, castDailyHexagram(new Date(2026, 8, 30)));
  assert.ok(r);
  assert.equal(r.lucky.color, "赤");
  assert.equal(r.lucky.number, undefined);
  assert.equal(r.lucky.direction, undefined);
});

test("剥掉结构段：宜忌幸运不再在正文里重复出现", () => {
  const text = [
    "命理之说，信则有不信则无，仅供参考娱乐",
    "",
    "【卦象解读】",
    "雷出地奋，豫而能顺。",
    "",
    "【宜】谋定后动、整理文书",
    "【忌】冒进争先、轻信口诺",
    "【幸运指南】颜色：黄｜数字：5｜方位：西南",
    "",
    "【大师寄语】",
    "心静则明。",
  ].join("\n");

  const out = stripStructuredSections(text);
  assert.doesNotMatch(out, /【宜】/);
  assert.doesNotMatch(out, /【忌】/);
  assert.doesNotMatch(out, /【幸运指南】/);
  // 该留的一句都不能少
  assert.match(out, /【卦象解读】/);
  assert.match(out, /雷出地奋/);
  assert.match(out, /【大师寄语】/);
  assert.match(out, /心静则明/);
  assert.match(out, /仅供参考娱乐/);
});

test("八卦次序覆盖全部八卦且无重复", () => {
  assert.equal(BAGUA_ORDER.length, 8);
  assert.equal(new Set(BAGUA_ORDER).size, 8);
  for (const n of BAGUA_ORDER) {
    assert.ok(BAGUA[n as BaGuaName], `${n} 缺爻线定义`);
  }
});
