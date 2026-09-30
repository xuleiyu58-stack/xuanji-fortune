import test from "node:test";
import assert from "node:assert/strict";
import {
  drawOracle,
  gradeOf,
  oracleToPrompt,
  parseOracle,
  GRADE_BANDS,
  ORACLE_COUNT,
} from "../src/lib/oracle.ts";

function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

test("签等分带完整覆盖 1-100，既不重叠也不留空", () => {
  let cursor = 1;
  for (const band of GRADE_BANDS) {
    assert.equal(band.from, cursor, `${band.grade} 的起点应接上一段的终点`);
    assert.ok(band.to >= band.from, `${band.grade} 的区间反了`);
    cursor = band.to + 1;
  }
  assert.equal(cursor - 1, ORACLE_COUNT, "分带必须恰好覆盖到第 100 签");
});

test("签等边界取值正确", () => {
  assert.equal(gradeOf(1)?.grade, "上上");
  assert.equal(gradeOf(5)?.grade, "上上");
  assert.equal(gradeOf(6)?.grade, "上吉");
  assert.equal(gradeOf(15)?.grade, "上吉");
  assert.equal(gradeOf(16)?.grade, "中吉");
  assert.equal(gradeOf(35)?.grade, "中吉");
  assert.equal(gradeOf(36)?.grade, "中平");
  assert.equal(gradeOf(70)?.grade, "中平");
  assert.equal(gradeOf(71)?.grade, "中下");
  assert.equal(gradeOf(90)?.grade, "中下");
  assert.equal(gradeOf(91)?.grade, "下下");
  assert.equal(gradeOf(100)?.grade, "下下");
});

test("越界签号返回 null 而不是猜一个", () => {
  assert.equal(gradeOf(0), null);
  assert.equal(gradeOf(101), null);
  assert.equal(gradeOf(-3), null);
  assert.equal(gradeOf(1.5), null);
});

test("摇签：签号落在 1-100 且签等与签号一致", () => {
  for (let i = 0; i < 2000; i++) {
    const d = drawOracle();
    assert.ok(Number.isInteger(d.number) && d.number >= 1 && d.number <= ORACLE_COUNT);
    assert.equal(d.grade, gradeOf(d.number)?.grade, `第 ${d.number} 签的签等与分带不符`);
  }
});

test("摇签：固定随机序列得到固定结果", () => {
  assert.equal(drawOracle(seq([0.0])).number, 1);
  assert.equal(drawOracle(seq([0.0])).grade, "上上");
  assert.equal(drawOracle(seq([0.999])).number, 100);
  assert.equal(drawOracle(seq([0.999])).grade, "下下");
  assert.equal(drawOracle(seq([0.5])).number, 51);
  assert.equal(drawOracle(seq([0.5])).grade, "中平");
});

test("摇签：好签少、平签多，且各等都能摇到", () => {
  const counts = new Map<string, number>();
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const g = drawOracle().grade;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  for (const band of GRADE_BANDS) {
    assert.ok((counts.get(band.grade) ?? 0) > 0, `${band.grade} 一次都没摇到`);
  }
  const top = (counts.get("上上") ?? 0) / N;
  const mid = (counts.get("中平") ?? 0) / N;
  assert.ok(top < 0.08, `上上签出现率 ${(top * 100).toFixed(1)}% 过高，不像求签`);
  assert.ok(mid > 0.25, `中平签出现率 ${(mid * 100).toFixed(1)}% 过低`);
});

test("喂给模型的文本含签号与签等，并禁止它另摇", () => {
  const prompt = oracleToPrompt({ number: 38, grade: "中平", note: "平" });
  assert.match(prompt, /第 38 签/);
  assert.match(prompt, /中平/);
  assert.match(prompt, /不得改动、不得另摇/);
});

const GOOD_TEXT = [
  "【签文】",
  "云开月出照庭前",
  "柳暗花明又一村",
  "莫道前路无知己",
  "春风送暖入屠苏",
  "",
  "【典故】",
  "取陆游《游山西村》意。",
  "",
  "【解曰】",
  "困局将解，转机在望。",
  "",
  "【大师开示】",
  "静待时变。",
].join("\n");

test("解签解析：四句签文与各段都能抽出", () => {
  const r = parseOracle(GOOD_TEXT, { number: 38, grade: "中平", note: "平" });
  assert.ok(r);
  assert.equal(r.verse.length, 4);
  assert.equal(r.verse[0], "云开月出照庭前");
  assert.equal(r.verse[3], "春风送暖入屠苏");
  assert.equal(r.allusion, "取陆游《游山西村》意。");
  assert.equal(r.explanation, "困局将解，转机在望。");
  assert.equal(r.message, "静待时变。");
  assert.equal(r.draw.number, 38);
});

test("解签解析：签文不是四句就返回 null，不硬凑", () => {
  const draw = { number: 38, grade: "中平" as const, note: "平" };
  assert.equal(parseOracle("【签文】\n只有一句\n【大师开示】\n好", draw), null, "一句不该被当成签文");
  assert.equal(
    parseOracle("【签文】\n一\n二\n三\n四\n五\n【大师开示】\n好", draw),
    null,
    "五句同样不该通过"
  );
  assert.equal(parseOracle("【大师开示】\n好", draw), null, "没有签文段应放弃解析");
  assert.equal(parseOracle("【签文】\n一\n二\n三\n四", draw), null, "没有开示段应放弃解析");
});

test("解签解析：句末标点会被去掉，便于竖排", () => {
  const text = "【签文】\n云开月出照庭前，\n柳暗花明又一村。\n莫道前路无知己；\n春风送暖入屠苏！\n【大师开示】\n静待。";
  const r = parseOracle(text, { number: 1, grade: "上上", note: "大吉" });
  assert.ok(r);
  assert.deepEqual(r.verse, ["云开月出照庭前", "柳暗花明又一村", "莫道前路无知己", "春风送暖入屠苏"]);
});

test("解签解析：有「大师寄语」时也能取到", () => {
  const text = "【签文】\n一\n二\n三\n四\n【大师寄语】\n且行且看。";
  const r = parseOracle(text, { number: 1, grade: "上上", note: "大吉" });
  assert.ok(r);
  assert.equal(r.message, "且行且看。");
});
