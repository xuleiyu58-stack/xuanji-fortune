/**
 * 判断 DeepSeek 是否在拒绝我们。
 *
 * 症状是：线上 3 秒失败、本地 9.4 秒成功。3 秒不是一个正常的推理耗时 ——
 * 要么被快速拒绝（401/429/余额），要么请求根本没发到。
 *
 * 这里连续打 20 次，把每一次的状态码与错误体都打出来。
 * 如果出现 429，说明是限流；如果全是 200，说明 key 与账户都正常，
 * 问题在 Vercel 那一侧。
 */
const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.error("没有 DEEPSEEK_API_KEY");
  process.exit(1);
}

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
