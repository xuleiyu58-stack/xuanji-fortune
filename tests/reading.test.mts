import test from "node:test";
import assert from "node:assert/strict";
import { parseReading, hasBasis, DISCLAIMER_RE } from "../src/lib/reading.ts";

const SAMPLE = `命理之说，信则有不信则无，仅供参考娱乐。
【命局总评】
结论：日主偏弱而官星有力，一生走的是"以规矩立身"的路子。
依据：月支酉藏辛，辛为日主甲木之正官，且透出年干。
展开：正官主名位与约束。透干说明这份约束来得早，多半体现在家庭与求学阶段。

【事业财运】
结论：宜走专业路线，不宜早创业。
依据：官星透干而无财星相生，财路要靠职位带来。
展开：这类命局的财，通常不是做买卖挣的，而是靠一门手艺或一个位置换来的。

【大师寄语】
结论：把一件事做深，比同时做三件事更快。
依据：日主偏弱，精力宜聚不宜散。
展开：你不需要更努力，你需要更专注。
`;

test("按【】切出小节，顺序不变", () => {
  const { sections } = parseReading(SAMPLE);
  assert.deepEqual(sections.map((s) => s.title), ["命局总评", "事业财运", "大师寄语"]);
});

test("每节的结论 / 依据 / 展开各自归位", () => {
  const { sections } = parseReading(SAMPLE);
  const first = sections[0];
  assert.match(first.part.verdict!, /以规矩立身/);
  assert.match(first.part.basis!, /月支酉藏辛/);
  assert.match(first.part.detail!, /正官主名位与约束/);
});

test("免责声明被剥掉，不会混进任何一节", () => {
  const { sections, preamble } = parseReading(SAMPLE);
  assert.equal(preamble, undefined, "声明不是引子");
  for (const s of sections) {
    assert.doesNotMatch(s.part.verdict ?? "", /仅供参考娱乐/);
    assert.doesNotMatch(s.part.detail ?? "", /仅供参考娱乐/);
  }
});

test("hasBasis 只对真有依据的节为真", () => {
  const { sections } = parseReading(SAMPLE);
  assert.equal(hasBasis(sections[0]), true);

  const noBasis = parseReading("【命局总评】\n结论：就这样。\n展开：没别的了。");
  assert.equal(hasBasis(noBasis.sections[0]), false);
});

test("缺一段时不崩：少「依据」只剩两段", () => {
  const { sections } = parseReading("【命局总评】\n结论：偏弱。\n展开：所以喜印比。");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].part.verdict, "偏弱。");
  assert.equal(sections[0].part.basis, undefined);
  assert.equal(sections[0].part.detail, "所以喜印比。");
});

test("没有【】时退回原文，不白屏", () => {
  const raw = "这是一段没有小节的解读，模型没按格式走。";
  const parsed = parseReading(raw);
  assert.equal(parsed.sections.length, 0);
  assert.equal(parsed.fallback, raw);
});

test("只有标题没有内容，同样算解析失败，退回原文", () => {
  const raw = "【命局总评】\n【事业财运】\n";
  const parsed = parseReading(raw);
  assert.equal(parsed.sections.length, 0);
  assert.ok(parsed.fallback && parsed.fallback.length > 0);
});

test("【】之前的引子被保留，不被静默丢掉", () => {
  const raw = "先说一句总的：这个盘偏寒。\n【命局总评】\n结论：偏弱。";
  const parsed = parseReading(raw);
  assert.equal(parsed.preamble, "先说一句总的：这个盘偏寒。");
  assert.equal(parsed.sections[0].part.verdict, "偏弱。");
});

test("没有前缀的散行接到「展开」上，不丢字", () => {
  const { sections } = parseReading("【命局总评】\n结论：偏弱。\n这两句没写前缀。\n还有这一句。");
  assert.equal(sections[0].part.detail, "这两句没写前缀。\n还有这一句。");
});

test("前缀用中文冒号或半角冒号都认", () => {
  const a = parseReading("【命局总评】\n结论:半角冒号。");
  assert.equal(a.sections[0].part.verdict, "半角冒号。");
  const b = parseReading("【命局总评】\n结论：全角冒号。");
  assert.equal(b.sections[0].part.verdict, "全角冒号。");
});

test("同一前缀重复出现时接续，而不是被后者覆盖", () => {
  const { sections } = parseReading("【命局总评】\n结论：第一句。\n结论：第二句。");
  assert.equal(sections[0].part.verdict, "第一句。第二句。");
});

test("空输入与纯空白都得到空结果，不抛异常", () => {
  for (const raw of ["", "   ", "\n\n"]) {
    const parsed = parseReading(raw);
    assert.equal(parsed.sections.length, 0);
  }
});

test("正文里长短不一的方括号不会把标题认错", () => {
  // 「【今日】」这类短标签是标题；正文里出现的长括号内容不该被切成小节
  const raw = "【命局总评】\n结论：见下。\n展开：所谓【月令司权】指的是……";
  const { sections } = parseReading(raw);
  assert.equal(sections.length, 1, "正文里的【】不该另起一节");
});

test("免责声明的正则既能匹配也能被剥掉", () => {
  const s = "命理之说，信则有不信则无，仅供参考娱乐。";
  assert.match(s, DISCLAIMER_RE);
  assert.equal(s.replace(DISCLAIMER_RE, "").trim(), "");
});

test("整份解读的小节数与标题都完整保留", () => {
  const { sections } = parseReading(SAMPLE);
  assert.equal(sections.length, 3);
  assert.equal(sections[2].title, "大师寄语");
  assert.ok(hasBasis(sections[2]));
});
