import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 四柱的对齐结构。
 *
 * 起因是一个真实的排版缺陷：地支藏干的数量天生不等 —— 子 1 个、午 2 个、
 * 丑 3 个 —— 四列按内容自然堆叠时，下面那三行标注（纳音／十二长生／空亡）
 * 每列高度都不同，于是上下错开。手机上尤其明显，看着像表格没对齐。
 *
 * 修法是让每列成为 flex 纵向容器，藏干区吃掉多余高度（flex-1），
 * 标注块用 mt-auto 落到底部。这样四列的标注必然在同一水平线上，
 * 与藏干几个无关。
 *
 * 这几条断言就是那个结构。纯视觉的东西测不了，但结构可以。
 */

const SRC = readFileSync(
  new URL("../src/components/BaziChart.tsx", import.meta.url),
  "utf8"
);

/** 取某个 class 出现处的整段标签文本，方便断言它上下文的类名。 */
const tagWith = (needle) => {
  const at = SRC.indexOf(needle);
  assert.ok(at > 0, `源码里找不到 ${needle}`);
  // 往前找最近的 '<'，往后找最近的 '>'
  const start = SRC.lastIndexOf("<", at);
  const end = SRC.indexOf(">", at);
  return SRC.slice(start, end + 1);
};

test("四柱网格拉伸到等高", () => {
  const grid = tagWith("grid-cols-4");
  assert.match(grid, /items-stretch/, "网格要 items-stretch，否则各列自己多高就多高");
});

test("每一列是 flex 纵向容器", () => {
  const col = tagWith("flex flex-col rounded-lg border");
  assert.match(col, /flex-col/, "列要纵向 flex");
});

test("藏干区吃掉多余高度 —— 这是对齐的关键", () => {
  const box = tagWith("flex-1 mt-3 pt-3");
  assert.match(
    box,
    /flex-1/,
    "藏干区要 flex-1：藏干少的列由它补足高度，标注才会落到底部"
  );
});

test("底部标注块用 mt-auto 顶到底部", () => {
  const box = tagWith("mt-auto pt-2");
  assert.match(box, /mt-auto/, "标注块要 mt-auto");
});

test("分隔线落在固定的边上，不随内容浮沉", () => {
  // 这里容易想错：flex-1 拉伸的是**底边**，顶边不动。
  // 所以 `flex-1 … border-t` 的分隔线位置是固定的，正是我们要的 ——
  // 藏干几个都不影响它落在哪一行。
  //
  // 反过来，若把 border-t 去掉、改成"藏干 div 后面再加一条线"，
  // 那条线就会落在内容末尾，于是又跟着藏干数量上下跑。
  const flexible = tagWith("flex-1 mt-3 pt-3");
  assert.match(
    flexible,
    /border-t/,
    "分隔线要挂在 flex-1 那层的顶边 —— 顶边不随伸缩移动"
  );
  assert.match(flexible, /pt-3/, "线下面要有内边距，否则文字贴着线");

  // 底部那一层也要有分隔线，且它靠 mt-auto 固定在底边
  const meta = tagWith("mt-auto pt-2");
  assert.match(meta, /border-t/, "底部标注层也要分隔线");
  assert.match(meta, /mt-auto/, "底边要用 mt-auto 固定住");
});

test("藏干容器不带固定高度 —— 高度该由 flex 协商，不该写死", () => {
  const flexible = tagWith("flex-1 mt-3 pt-3");
  assert.doesNotMatch(
    flexible,
    /min-h-\[|h-\[\d/,
    "不要给藏干区写死高度：写死了以后有派别算 4 个藏干时会溢出"
  );
});

test("藏干仍然按实际数量渲染，没有被写死成固定条数", () => {
  // 数量由 ZHI_HIDE_GAN 决定（1～3 个）。写死循环次数会让藏干显示错。
  assert.match(SRC, /p\.hidden\.map\(/, "应当遍历实际的 hidden 数组");
  assert.doesNotMatch(
    SRC,
    /hidden\.slice\(0,\s*\d\)/,
    "不该截断藏干 —— 藏干几个就是几个"
  );
});
