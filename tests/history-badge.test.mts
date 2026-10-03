import test from "node:test";
import assert from "node:assert/strict";

/**
 * 排盘历史：红点与"看过了"的判定。
 *
 * 这一组测的是一个**真实修过的 bug**：红点原先判的是 `history.length > 0`，
 * 也就是"只要排过一次盘就永远亮着"。它从"有新的没看"退化成了一个
 * 永不熄灭的装饰，用户只会觉得它坏了。
 *
 * store.ts 是给浏览器用的，但这两个函数只依赖 localStorage 的读写，
 * 所以这里装一个最小的 localStorage 就能直接测 —— 比开浏览器快得多，
 * 也比只断言源码文本有意义得多。
 */

// ── 最小 localStorage 桩 ────────────────────────────────────
function installStorage() {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  return { map, storage };
}

const { map } = installStorage();
// 动态导入：确保桩在模块求值前就位
const store = await import("../src/lib/store.ts");

const reset = () => map.clear();

test("没有记录时不该有红点", () => {
  reset();
  assert.equal(store.hasUnseenHistory(), false);
});

test("排完一条之后该有红点", () => {
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "解读正文", input: {} });
  assert.equal(store.hasUnseenHistory(), true, "新记录应点亮红点");
});

test("看过之后红点熄灭", () => {
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "解读正文", input: {} });
  assert.equal(store.hasUnseenHistory(), true);

  store.markHistorySeen();
  assert.equal(store.hasUnseenHistory(), false, "打开历史后红点应熄灭 —— 这正是原先的 bug");
});

test("看过之后又来一条新的，红点重新亮起", () => {
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "第一条", input: {} });
  store.markHistorySeen();
  assert.equal(store.hasUnseenHistory(), false);

  store.saveReading({ mode: "bazi", title: "八字命理", result: "第二条", input: {} });
  assert.equal(store.hasUnseenHistory(), true, "新记录应重新点亮红点");
});

test("只看过旧记录、又来了新的，依然亮着", () => {
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "旧", input: {} });
  store.markHistorySeen();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "新", input: {} });
  assert.equal(store.hasUnseenHistory(), true);
});

test("标记已看记的是「最新那条的 id」，不是「现在」", () => {
  // 这一条防的是一个具体的错误实现：若记成"当前时间"或"当前时间戳"，
  // 用户在打开抽屉那一瞬间之后产生的记录会被误标为已看，红点就不亮了。
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "一", input: {} });
  store.markHistorySeen();

  // 紧接着在同一毫秒内再来一条（createdAt 会完全相同）
  store.saveReading({ mode: "bazi", title: "八字命理", result: "二", input: {} });

  assert.equal(
    store.hasUnseenHistory(),
    true,
    "同一毫秒内产生的新记录也必须点亮红点 —— 这正是用时间戳判会漏掉的情况"
  );
});

test("删掉被标记的那条之后，不该把剩下的全当成新的", () => {
  reset();
  const first = store.saveReading({ mode: "bazi", title: "八字命理", result: "一", input: {} });
  store.markHistorySeen();
  assert.equal(store.hasUnseenHistory(), false);

  store.deleteReading(first.id);
  assert.equal(
    store.hasUnseenHistory(),
    false,
    "删掉已看的那条不该重新点亮红点（列表空了，没有新东西）"
  );
});

test("清空历史之后既没有记录也没有红点", () => {
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "x", input: {} });
  store.markHistorySeen();
  store.clearHistory();
  assert.equal(store.getHistory().length, 0);
  assert.equal(store.hasUnseenHistory(), false);
  assert.equal(map.has("xuanji_history_seen"), false, "清空历史应把已看标记一起清掉");
});

test("已看标记指向一个不存在的 id 时，按「有新的」处理", () => {
  // 宁可在数据不一致时多亮一次红点，也不要让红点永远不亮
  // （比如用户换了浏览器配置、或标记被别的东西覆盖了）
  reset();
  store.saveReading({ mode: "bazi", title: "八字命理", result: "x", input: {} });
  localStorage.setItem("xuanji_history_seen", "stale-id-that-no-longer-exists");
  assert.equal(store.hasUnseenHistory(), true);
});
