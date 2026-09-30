import test from "node:test";
import assert from "node:assert/strict";
import { drawTarot, tarotToPrompt, DECK_SIZE, POSITIONS } from "../src/lib/tarot.ts";

/** 注入固定序列，使抽牌完全确定。 */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

test("牌库为 78 张（22 大阿卡纳 + 56 小阿卡纳）", () => {
  assert.equal(DECK_SIZE, 78);
});

test("抽三张，位置依次为过去/现在/未来", () => {
  const draw = drawTarot(seq([0.1, 0.4, 0.7, 0.2, 0.8, 0.3]));
  assert.equal(draw.cards.length, 3);
  assert.deepEqual(draw.cards.map((c) => c.position), [...POSITIONS]);
});

test("三张牌不重复", () => {
  for (let i = 0; i < 200; i++) {
    const draw = drawTarot();
    const names = draw.cards.map((c) => `${c.arcana}:${c.name}`);
    assert.equal(new Set(names).size, 3, `出现重复：${names.join(" / ")}`);
  }
});

test("固定随机序列得到固定结果", () => {
  const r = () => seq([0.0, 0.5, 0.99, 0.1, 0.9, 0.2]);
  const draw = drawTarot(r());
  // 0.0 → 第 0 张（愚者）；0.5 → 第 39 张（小阿卡纳）；0.99 → 第 77 张
  assert.equal(draw.cards[0].name, "愚者");
  assert.equal(draw.cards[0].arcana, "major");
  assert.equal(draw.cards[0].numeral, "0");
  assert.equal(draw.cards[0].upright, true); // 0.1 < 0.5
  assert.equal(draw.cards[1].name, "圣杯4");
  assert.equal(draw.cards[1].arcana, "minor");
  assert.equal(draw.cards[1].suit, "圣杯");
  assert.equal(draw.cards[1].upright, false); // 0.9 >= 0.5
  assert.equal(draw.cards[2].upright, true); // 0.2 < 0.5
});

test("正逆位都会被抽到", () => {
  const seen = new Set<boolean>();
  for (let i = 0; i < 300; i++) {
    for (const c of drawTarot().cards) seen.add(c.upright);
  }
  assert.deepEqual([...seen].sort(), [false, true]);
});

test("大阿卡纳与小阿卡纳都会被抽到", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    for (const c of drawTarot().cards) seen.add(c.arcana);
  }
  assert.deepEqual([...seen].sort(), ["major", "minor"]);
});

test("每张牌都有名称与关键词", () => {
  for (let i = 0; i < 100; i++) {
    for (const c of drawTarot().cards) {
      assert.ok(c.name.length > 0);
      assert.ok(c.nameEn.length > 0);
      assert.ok(c.keyword.length > 0);
      assert.ok(c.numeral.length > 0);
    }
  }
});

test("喂给模型的文本含三张牌与正逆位", () => {
  const draw = drawTarot(seq([0.0, 0.5, 0.99, 0.1, 0.9, 0.2]));
  const prompt = tarotToPrompt(draw);
  assert.match(prompt, /已抽定/);
  assert.match(prompt, /过去之牌：愚者/);
  assert.match(prompt, /正位/);
  assert.match(prompt, /逆位/);
});
