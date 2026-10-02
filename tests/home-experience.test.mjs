import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("首页就是排盘工具页，直接给出出生信息表单", () => {
  // 单产品站不该再有"选一种测算方式"的目录页 —— 那一步纯粹是摩擦
  assert.match(page, /<FortuneForm/);
  // 出生信息的字段住在专用的 BirthInput 里，不在首页
  const form = readFileSync(new URL("../src/components/FortuneForm.tsx", import.meta.url), "utf8");
  assert.match(form, /<BirthInput/, "FortuneForm 应渲染专用的出生信息表单");
});

test("出生信息表单支持阳历/农历两种历法", () => {
  const birth = readFileSync(new URL("../src/components/BirthInput.tsx", import.meta.url), "utf8");
  assert.match(birth, /阳历（公历）/, "缺少阳历入口");
  assert.match(birth, /农历（阴历）/, "缺少农历入口");
  assert.match(birth, /农历年|aria-label="农历年"/, "农历应有年月日三个下拉");
  assert.match(birth, /闰月/, "农历应有闰月选项");
  // 农历只有 12 个月名，闰月靠勾选 —— 因为判断某年有无闰月要问服务端的库
  assert.match(birth, /LUNAR_MONTHS/);
});

// 已删除的四个模式的字样不许再出现在任何用户可见的位置。
// 范围刻意包含 layout.tsx：它的 metadata 决定浏览器标签页与搜索摘要，
// 只扫 page.tsx 的话，标题里留着「塔罗 · 姻缘」也照样全绿 —— 第一版就是这样漏的。
const GONE = ["今日运势", "灵签", "塔罗", "姻缘"];

test("首页不再出现已删除的四个模式入口", () => {
  for (const gone of GONE) {
    assert.doesNotMatch(page, new RegExp(gone), `首页仍在提「${gone}」`);
  }
});

test("站点 metadata 也不再宣称已删除的四个模式", () => {
  for (const gone of GONE) {
    assert.doesNotMatch(layout, new RegExp(gone), `metadata 仍在提「${gone}」，标签页与搜索摘要会带上它`);
  }
});

test("全 src 里不留指向已删除路由的链接", () => {
  // /fortune/* 整层已删。留着的链接会 404，而且只在点下去时才暴露。
  const files = ["app/page.tsx", "app/member/page.tsx", "app/layout.tsx", "components/Header.tsx", "components/Footer.tsx"];
  for (const rel of files) {
    const src = readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\/fortune\//, `${rel} 仍链向已删除的 /fortune/*`);
  }
});

test("出生地是省 → 市 → 区县三级联动，且只用于真太阳时", () => {
  const birth = readFileSync(new URL("../src/components/BirthInput.tsx", import.meta.url), "utf8");
  assert.match(birth, /真太阳时/, "选了出生地却不说明用途，用户不知道为什么要填");
  assert.match(birth, /citiesIn/, "市应由所选省份推导");
  assert.match(birth, /countiesIn/, "区县应由所选城市推导");
});

test("区划数据按需加载 —— 60KB 的表不该跟着首屏一起发出去", () => {
  const birth = readFileSync(new URL("../src/components/BirthInput.tsx", import.meta.url), "utf8");

  assert.match(birth, /import\("@\/lib\/bazi\/regions"\)/, "应当动态导入");
  // 静态导入会把整份数据拖回首屏包，动态导入的意义就没了
  assert.doesNotMatch(
    birth,
    /^import\s+(?!type\b)[^;]*from\s+"@\/lib\/bazi\/regions";/m,
    "不得静态导入区划数据"
  );
  // 类型导入是允许的 —— 它会被完全擦除
  assert.match(birth, /import type \{[^}]*\} from "@\/lib\/bazi\/regions";/);
});

test("命盘组件不得从 @/lib/bazi 入口取值 —— 那会把 places 连同区划数据一起拽进来", () => {
  const chart = readFileSync(new URL("../src/components/BaziChart.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(
    chart,
    /^import\s+(?!type\b)[^;]*from\s+"@\/lib\/bazi";/m,
    "常量应改从叶子模块（shensha / constants / strength）导入"
  );
  assert.match(chart, /from "@\/lib\/bazi\/shensha"/);
  assert.match(chart, /from "@\/lib\/bazi\/constants"/);
});

test("出生时刻填到分钟，而不是挑一个时辰", () => {
  const birth = readFileSync(new URL("../src/components/BirthInput.tsx", import.meta.url), "utf8");
  assert.match(birth, /type="time"/, "应当是精确时间输入，而不是十二时辰下拉");
  assert.doesNotMatch(birth, /TIME_OPTIONS/, "十二时辰下拉已废");
  assert.match(birth, /晚子时/, "23 点后的子时口径与常规不同，界面必须说明");
});

test("命盘上须写明时间是怎么定的", () => {
  const chart = readFileSync(new URL("../src/components/BaziChart.tsx", import.meta.url), "utf8");
  assert.match(chart, /出生时间/, "应说明排盘用的是哪个时刻");
  assert.match(chart, /真太阳时/, "做了校正就必须显示出来");
  assert.match(chart, /跨了午夜|trueSolarCrossedDay/, "跨日会改日柱，必须提示");
});

test("首页为减少动态效果的用户提供静态体验", () => {
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});
