import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { CONTACT_EMAIL } from "../src/lib/contact.ts";

/**
 * 法律页的存在性守卫。
 *
 * 为什么值得一个测试：Footer 里曾经挂着三个 href="#" 的死链，点了只跳回页顶 ——
 * 用户以为有条款可看，点下去什么也没有。现在链接指向真实页面，
 * 但这层保障只靠"文件还在"这一个事实，删掉一个 page.tsx 就会静默变回死链。
 *
 * 顺带钉住两件容易漂移的事：联系方式必须与 lib/contact.ts 同源；
 * 每页必须有 canonical，否则 /terms 之类的页面会被当成首页的重复内容。
 */

const PAGES = [
  { route: "/terms", file: "src/app/terms/page.tsx", title: "用户协议" },
  { route: "/privacy", file: "src/app/privacy/page.tsx", title: "隐私政策" },
  { route: "/disclaimer", file: "src/app/disclaimer/page.tsx", title: "免责声明" },
];

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/**
 * 剥掉注释再断言。
 *
 * 必须剥：Footer 的注释里正好解释着"这里原有三个 href=\"#\" 的死链"，
 * 不剥的话，这层守卫会被它自己的说明文字绊倒（第一版就是这样红的）。
 */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

const readCode = (rel: string) => stripComments(read(rel));

test("三个法律页都真实存在", () => {
  for (const p of PAGES) {
    assert.ok(
      existsSync(new URL(`../${p.file}`, import.meta.url)),
      `${p.route} 的页面文件不存在 —— 页脚会变成一个 404 链接`
    );
  }
});

test("每个法律页都声明了自己的标题与 canonical", () => {
  for (const p of PAGES) {
    const src = read(p.file);
    assert.match(src, /export const metadata/, `${p.route} 缺少 metadata`);
    assert.match(src, new RegExp(p.title), `${p.route} 的标题里没有「${p.title}」`);
    assert.match(src, /canonical:\s*"\/[a-z]+"/, `${p.route} 缺少 canonical`);
  }
});

test("页脚的三个链接与页面一一对应", () => {
  const footer = read("src/components/Footer.tsx");
  for (const p of PAGES) {
    assert.match(
      footer,
      new RegExp(`href:\\s*"${p.route}"`),
      `页脚没有指向 ${p.route} 的链接`
    );
    assert.match(footer, new RegExp(p.title), `页脚缺少「${p.title}」这个链接文案`);
  }
});

test("页脚不得再出现空锚点死链", () => {
  const footer = readCode("src/components/Footer.tsx");
  assert.doesNotMatch(
    footer,
    /href=["']#["']/,
    '出现了 href="#" —— 点了只会跳回页顶，比没有链接更糟'
  );
});

test("联系客服指向真实邮箱，且与 lib/contact.ts 同源", () => {
  const footer = read("src/components/Footer.tsx");
  // 不允许把邮箱写死在页脚里：改一处忘一处就会出现两个不同的联系方式
  assert.doesNotMatch(
    footer,
    /@qq\.com/,
    "页脚不应写死邮箱，应从 lib/contact.ts 取"
  );
  assert.match(footer, /CONTACT_EMAIL|CONTACT_MAILTO/, "页脚应引用联系方式常量");

  // 付款弹窗同理 —— 用户付完钱要能立刻知道找谁
  const modal = read("src/components/PaymentModal.tsx");
  assert.match(modal, /CONTACT_EMAIL/, "付款弹窗必须显示联系方式");
  assert.doesNotMatch(modal, /@qq\.com/, "付款弹窗不应写死邮箱");
});

test("联系方式是一个可用的邮箱格式", () => {
  assert.match(CONTACT_EMAIL, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, "联系方式不是合法邮箱");
});

test("隐私政策如实说明出生信息会发给第三方模型", () => {
  // 这不是文案偏好，是合规事实：排盘结果确实会送到 DeepSeek。
  // 有人为了"看起来更安全"把这句删掉，这一页就变成了不实陈述。
  const privacy = read("src/app/privacy/page.tsx");
  assert.match(privacy, /DeepSeek/, "隐私政策必须点名第三方 AI 服务");
  assert.match(privacy, /localStorage|本地存储|浏览器/, "必须说明排盘历史存在本地");
});

test("免责声明明确排除专业建议", () => {
  const disclaimer = read("src/app/disclaimer/page.tsx");
  for (const topic of ["医疗", "投资", "法律"]) {
    assert.match(disclaimer, new RegExp(topic), `免责声明缺少「${topic}」的排除说明`);
  }
});

test("用户协议里的价格来自 pricing.ts，不是写死的", () => {
  const terms = read("src/app/terms/page.tsx");
  assert.match(terms, /from "@\/lib\/pricing"/, "应引用价格表");
  assert.match(terms, /MODES\.bazi\.price|MEMBER_PLANS/, "价格应取自价格表");
  // ¥ 后面直接跟数字 = 写死价格（与 no-hardcoded-prices 同一条规则）
  assert.doesNotMatch(terms, /¥\s*\d/, "用户协议里出现了写死的价格");
});

// ── 环境变量文档不得与代码漂移 ────────────────────────────

/**
 * 这一组防的是"代码要一个变量，但文档里没写" ——
 * 那种情况的典型表现是部署后某个功能静默失效（比如缺 PASS_SECRET 时
 * 兑换接口返 503），而看文档完全不知道为什么。
 */
const ENV_EXAMPLE = read(".env.example");

const REQUIRED_ENV = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_DAILY_BUDGET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PASS_SECRET",
];

test(".env.example 记录了全部必需变量", () => {
  for (const name of REQUIRED_ENV) {
    assert.match(ENV_EXAMPLE, new RegExp(`^${name}=`, "m"), `.env.example 缺少 ${name}`);
  }
});

test("可选变量在 .env.example 里是注释掉的", () => {
  // 账号功能与本地自测用的变量不该让新用户以为必须填
  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "DEV_REDEEM_CODES", "NEXT_PUBLIC_SITE_URL"]) {
    assert.match(
      ENV_EXAMPLE,
      new RegExp(`^#\\s*${name}=`, "m"),
      `${name} 应是注释掉的可选项`
    );
  }
});

test("必需变量没有留空值以外的默认 —— 空值表示必须自己填", () => {
  for (const name of REQUIRED_ENV) {
    // 必须同时按 \r?\n 切分并去掉行尾 \r：这个项目用 CRLF 换行
    // （Windows 检出的正常状态），只按 \n 切会把 \r 留在行尾，
    // 于是 "KEY=" 变成 "KEY=\r" 而误报。这是测试自己的健壮性问题。
    const line =
      ENV_EXAMPLE.split(/\r?\n/)
        .find((l) => l.startsWith(`${name}=`))
        ?.replace(/\r$/, "") ?? "";
    // 只允许空值，或确实有意义的默认（每日预算有 300 的默认）
    if (name === "DEEPSEEK_DAILY_BUDGET") continue;
    assert.equal(line, `${name}=`, `${name} 不该预填任何值`);
  }
});

test("服务端专用的变量都被明确标注了", () => {
  // 这几个泄露的后果最严重，文档里必须点明不许加 NEXT_PUBLIC_ 前缀
  const src = read(".env.example");
  for (const name of ["DEEPSEEK_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PASS_SECRET"]) {
    const idx = src.indexOf(`${name}=`);
    assert.ok(idx > 0, `未找到 ${name}`);
    // 看它上方 400 字内的注释有没有提醒
    const comment = src.slice(Math.max(0, idx - 400), idx);
    assert.match(
      comment,
      /服务端|NEXT_PUBLIC_/,
      `${name} 附近应注明它是服务端专用、不得加 NEXT_PUBLIC_ 前缀`
    );
  }
});

test("README 说明的生产环境禁用项与代码一致", () => {
  // allowMemoryFallback 在生产未配数据层时抛错 → README 必须提到 503
  const runtime = read("src/lib/server/runtime.ts");
  assert.match(runtime, /NODE_ENV === "production"/, "生产环境应有专门分支");
  assert.match(runtime, /拒绝提供服务/, "应明确拒绝服务");

  const readme = read("README.md");
  assert.match(readme, /503/, "README 必须说明未配数据层会 503");
  assert.match(readme, /DEV_REDEEM_CODES/, "README 必须提醒上线前删掉兜底码");
});
