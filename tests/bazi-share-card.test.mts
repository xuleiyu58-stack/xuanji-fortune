import test from "node:test";
import assert from "node:assert/strict";
import { buildBaziChart } from "../src/lib/bazi/index.ts";
import {
  buildShareCard, canShare, wrapCJK, CARD_W, CARD_H, type ShareOp,
} from "../src/lib/bazi/share-card.ts";

const chart = buildBaziChart({
  birthDate: "1990-06-15",
  birthTime: "09:37",
  gender: "男",
  province: "浙江省",
  city: "杭州市",
})!;

const textsOf = (ops: ShareOp[]) => ops.filter((o) => o.kind === "text").map((o) => o.text);
const allText = (ops: ShareOp[]) => textsOf(ops).join("\n");

test("四柱的八个字都画上去了，且顺序与盘一致", () => {
  const ops = buildShareCard(chart);
  const all = textsOf(ops);
  for (const p of chart.pillars) {
    assert.ok(all.includes(p.gan), `${p.label} 的天干 ${p.gan} 没画出来`);
    assert.ok(all.includes(p.zhi), `${p.label} 的地支 ${p.zhi} 没画出来`);
  }
  // 顺序：年月日时的天干应依次出现
  const gans = chart.pillars.map((p) => p.gan);
  const idx = gans.map((g) => all.indexOf(g));
  for (let i = 1; i < idx.length; i++) {
    assert.ok(idx[i] > idx[i - 1], "四柱应按年月日时的顺序绘制");
  }
});

test("结论、用神、出生信息都在图上", () => {
  const all = allText(buildShareCard(chart));
  assert.match(all, new RegExp(chart.dayMaster), "应写明日主");
  assert.match(all, new RegExp(chart.strength.verdict), "应写明身强身弱");
  if (chart.pattern) assert.ok(all.includes(chart.pattern.name), "应写明格局");
  for (const el of [chart.strength.yongShen, chart.strength.xiShen, chart.strength.jiShen]) {
    assert.ok(all.includes(el), `用神喜忌里的 ${el} 没画出来`);
  }
  assert.ok(all.includes(String(chart.zodiac)), "应写明生肖");
});

test("落了真太阳时校正的话，图上要如实标明", () => {
  const all = allText(buildShareCard(chart));
  assert.ok(chart.trueSolarTime, "这个盘本来就做了校正");
  assert.ok(all.includes(chart.trueSolarTime!), "校正后的时刻应出现在图上");
  assert.match(all, /真太阳时/);
});

test("十神压在天干上方 —— y 坐标必须小于天干", () => {
  const ops = buildShareCard(chart);
  const texts = ops.filter((o) => o.kind === "text");
  const first = chart.pillars[0];
  const shiShen = texts.find((t) => t.text === first.shiShen);
  const gan = texts.find((t) => t.text === first.gan);
  assert.ok(shiShen && gan, "十神与天干都应绘制");
  assert.ok(
    (shiShen as { y: number }).y < (gan as { y: number }).y,
    "十神应画在天干上方（y 更小）"
  );
});

test("所有绘制指令都落在画布内，不会被裁掉", () => {
  for (const op of buildShareCard(chart)) {
    if (op.kind === "text") {
      assert.ok(op.x >= 0 && op.x <= CARD_W, `文字 "${op.text}" 的 x=${op.x} 出界`);
      assert.ok(op.y >= 0 && op.y <= CARD_H, `文字 "${op.text}" 的 y=${op.y} 出界`);
    } else if (op.kind === "rect") {
      assert.ok(op.x >= 0 && op.y >= 0, "矩形起点出界");
      assert.ok(op.x + op.w <= CARD_W + 1 && op.y + op.h <= CARD_H + 1, "矩形超出画布");
    } else if (op.kind === "circle") {
      assert.ok(op.cx - op.r >= 0 && op.cy - op.r >= 0, "圆形出界");
      assert.ok(op.cx + op.r <= CARD_W && op.cy + op.r <= CARD_H, "圆形超出画布");
    }
  }
});

test("每张图都有底色，不会透出背景", () => {
  const ops = buildShareCard(chart);
  const bg = ops.find((o) => o.kind === "rect" && o.x === 0 && o.y === 0);
  assert.ok(bg, "缺整幅底色");
  assert.equal((bg as { w: number }).w, CARD_W);
  assert.equal((bg as { h: number }).h, CARD_H);
});

test("字体名与站内一致，中文才不会掉回默认字形", () => {
  const ops = buildShareCard(chart);
  // 干支与标题用 serif，正文用 sans；face 只在这两个值里取
  for (const op of ops) {
    if (op.kind === "text" && op.face) {
      assert.ok(["serif", "sans"].includes(op.face), `未定义的字体类型 ${op.face}`);
    }
  }
});

// ── 折行 ─────────────────────────────────────────────────

test("折行：按每行字数切开", () => {
  assert.deepEqual(wrapCJK("一二三四五六七八九十", 4, 3), ["一二三四", "五六七八", "九十"]);
});

test("折行：超出行数时末行加省略号", () => {
  const lines = wrapCJK("一二三四五六七八九十十一十二", 4, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /…$/);
  assert.ok(lines[1].length <= 4, "加省略号后不该超出每行字数");
});

test("折行：去掉空白，避免行首出现空格", () => {
  assert.deepEqual(wrapCJK("一 二 三 四", 2, 2), ["一二", "三四"]);
});

test("折行：空串得到空数组，不产生一个空行", () => {
  assert.deepEqual(wrapCJK("", 5, 3), []);
});

// ── 可用性判断 ───────────────────────────────────────────

test("canShare 只在真有一张四柱俱全的盘时为真", () => {
  assert.equal(canShare(chart), true);
  assert.equal(canShare(null), false);
  assert.equal(canShare(undefined), false);
  assert.equal(canShare({ pillars: [] } as never), false);
});
