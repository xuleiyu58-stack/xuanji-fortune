/**
 * 体检 DeepSeek 这一侧：key 是否有效、账户是否可用、有没有被限流。
 *
 * 起因是一次真实的故障：线上解读稳定失败，排查了很久，最后发现是
 * **Vercel 上的 DEEPSEEK_API_KEY 填成了别的变量的值**（长度 20、以 "_URL"
 * 结尾，显然是配置时错位了）。上游返回 401，耗时 0.4 秒。
 *
 * 那次教训是：key 配错的表现（秒级失败）和超时、限流长得很像，光看
 * 「失败」两个字分不出来。所以这个脚本先把**形状**检一遍 —— 长度不对
 * 当场就能看出来，不必等到发请求。
 *
 * 用法：
 *   node --use-env-proxy --env-file=.env.local scripts/check-deepseek.mjs
 *
 * 线上那份配置它查不到（那是 Vercel 的环境），要查线上得在部署里临时加
 * 一个诊断端点 —— 见 README「常见故障」一节。
 */
const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.error("没有 DEEPSEEK_API_KEY");
  process.exit(1);
}

// ── 先看形状 ────────────────────────────────────────────────
// 这一步能在发请求之前就抓出「填错格子」这类问题
console.log("=== key 的形状 ===");
console.log(`  长度: ${key.length}${key.length === 35 ? " ✓" : `  ✗ 应该是 35 —— 长度不对说明填错了值`}`);
console.log(`  前缀: ${key.slice(0, 3)}${key.startsWith("sk-") ? " ✓" : "  ✗ 应当以 sk- 开头"}`);
console.log(`  前后空白: ${key !== key.trim() ? "✗ 有空白字符，多半是粘贴时带进来的" : "无 ✓"}`);

// 填错格子时最常见的两种形态
if (key.endsWith("_URL") || key.startsWith("http")) {
  console.log("  ✗ 这个值看起来像 Supabase 的 URL，不是 API key —— 配置时错位了");
}
if (key.startsWith("eyJ")) {
  console.log("  ✗ 这个值看起来像 JWT（Supabase 的 anon/service key），不是 DeepSeek key");
}
if (key.length !== 35 || !key.startsWith("sk-") || key !== key.trim()) {
  console.log("\n形状就不对，先修配置再往下测。");
  process.exit(1);
}
console.log("");

const tally = {};
const samples = [];

for (let i = 1; i <= 20; i += 1) {
  const t = Date.now();
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "说一个字" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    const code = String(r.status);
    tally[code] = (tally[code] ?? 0) + 1;
    if (r.status !== 200) {
      const body = await r.text();
      samples.push(`  #${i}  HTTP ${code}  ${secs}s  ${body.slice(0, 200)}`);
    } else {
      await r.text();
      if (i === 1) samples.push(`  #${i}  HTTP 200  ${secs}s  （正常）`);
    }
  } catch (e) {
    tally.ERROR = (tally.ERROR ?? 0) + 1;
    samples.push(`  #${i}  请求异常: ${e.message}`);
  }
}

console.log("=== 20 次连续请求的状态码分布 ===");
for (const [k, v] of Object.entries(tally)) console.log(`  HTTP ${k}: ${v} 次`);
console.log("\n=== 非 200 的样本 ===");
console.log(samples.length ? samples.slice(0, 8).join("\n") : "  （没有异常，全部 200）");

console.log("\n=== 结论 ===");
if (tally["200"] === 20) {
  console.log("  key 与账户完全正常，无任何限流 —— 问题在 Vercel 那一侧");
} else if (tally["429"]) {
  console.log("  出现 429：被限流。可能是并发过高或账户配额限制");
} else if (tally["401"] || tally["403"]) {
  console.log("  出现 401/403：key 无效或已吊销");
} else if (tally["402"]) {
  console.log("  出现 402：余额不足");
} else {
  console.log("  有其他异常，见上方样本");
}
