/**
 * 用真日期重新生成首页样张。
 *
 * 背景：`HomepageSample.tsx` 原先手写的四柱（庚戌 · 辛未 · 庚辰 · 辛巳）
 * 来自不了任何真实日期（辛未月的月干只可能是癸），而它下面的「依据」
 * 却引用了四柱里不存在的「丑」。两处对不上 —— 样张最该可信的地方
 * 反而自相矛盾。
 *
 * 这段「依据」本身就是用 1992-02-04 生成的（真盘 辛未 辛丑 庚戌 庚辰，
 * 日主庚金坐戌，未丑戌辰四土俱全），只是写四柱时填错了别的。
 * 所以拿同一天重新生成，文字会自然对上。
 *
 *   node --use-env-proxy --env-file=.env.local scripts/refresh-sample.mjs
 */
import { buildBaziChart } from "../src/lib/bazi/index.ts";
import { chartToPrompt, readBazi } from "../src/lib/ai.ts";

const BIRTH = { birthDate: "1992-02-04", birthTime: "07:20", gender: "男" };

const chart = buildBaziChart(BIRTH);
const pillars = chart.pillars.map((p) => `${p.gan}${p.zhi}`).join(" · ");

console.log(`生辰      : ${BIRTH.birthDate} ${BIRTH.birthTime} ${BIRTH.gender}`);
console.log(`四柱      : ${pillars}`);
console.log(`日主      : ${chart.pillars[2].gan}${chart.pillars[2].zhi}`);
console.log(`五行      : ${chart.elements.map((e) => `${e.name} ${e.score}·${e.percent}%`).join("  ")}`);
console.log("");
console.log("正在生成解读（会花一次模型调用）…");

const reading = await readBazi(chartToPrompt(chart, "bazi"), true);

console.log("");
console.log("=".repeat(72));
console.log(reading);
console.log("=".repeat(72));
