/**
 * 用真日期重新生成首页样张。
 *
 * 背景：`HomepageSample.tsx` 手写的四柱（庚戌 · 辛未 · 庚辰 · 辛巳）
 * 来自不了任何真实日期（辛未月的月干只可能是癸），而它下面的「依据」
 * 却引用了四柱里不存在的「丑」。两处对不上 —— 样张最该可信的地方
 * 反而自相矛盾，而样张的卖点正是「四柱可自行核对」。
 *
 * 真盘：`1992-02-04 07:20 男` → 辛未 辛丑 庚戌 庚辰，
 * 日主庚金坐戌，年支未、月支丑、时支辰，未丑戌辰四土俱全 ——
 * 「依据」那句话本身是对的，错的只是写四柱时填了别的日子。
 *
 * 这个脚本拿同一天重新生成整节解读，让样张从盘到字都是真的。
 *
 *   node --use-env-proxy --env-file=.env.local --import ./scripts/ts-loader.mjs scripts/refresh-sample.mjs
 *
 * 注：`readBazi` 内部自己排盘并拼提示词（就是线上那条路径），
 * 所以这里不必、也不该自己去调 `chartToPrompt` —— 手拼一次提示词，
 * 就等于样张与线上跑的不是同一条流水线，那它的"真实"又要打折扣。
 */
import { buildBaziChart } from "../src/lib/bazi/index.ts";
import { readBazi } from "../src/lib/ai.ts";

const BIRTH = {
  calendar: "solar",
  birthDate: "1992-02-04",
  birthTime: "07:20",
  gender: "男",
};

const chart = buildBaziChart(BIRTH);
if (!chart) {
  console.error("排盘失败 —— 先查日期，不要继续花模型调用");
  process.exit(1);
}

console.log(`生辰 : ${BIRTH.birthDate} ${BIRTH.birthTime} ${BIRTH.gender}`);
console.log(`四柱 : ${chart.pillars.map((p) => p.gan + p.zhi).join(" · ")}`);
console.log(`日主 : ${chart.pillars[2].gan}${chart.pillars[2].zhi}`);
console.log(`五行 : ${chart.elements.map((e) => `${e.element} ${e.value}·${e.percent}%`).join("  ")}`);
console.log(`地支 : ${chart.pillars.map((p) => p.zhi).join("、")}`);
console.log("");
console.log("正在生成（一次模型调用）…");

const result = await readBazi(BIRTH, true);
if (!result.success || !result.content) {
  console.error(`生成失败：${result.error ?? "返回里没有 content"}`);
  process.exit(1);
}

console.log("");
console.log("=".repeat(72));
console.log(result.content);
console.log("=".repeat(72));
