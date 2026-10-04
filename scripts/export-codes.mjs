/**
 * 把库里的激活码导出成一份人可读的清单。
 *
 * 为什么需要导出：发码命令把码打印到终端就完事了，关掉窗口就找不回来 ——
 * 而那是能换钱的凭据。导出一份留底，也方便对账（哪些发了、哪些用了）。
 *
 * 输出文件被 .gitignore 挡住，不会进仓库。
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data, error } = await db
  .from("redeem_codes")
  .select("code,kind,mode,days,batch,redeemed_at,redeemed_by")
  .order("batch")
  .order("code");

if (error) {
  console.error("读取失败:", error.message);
  process.exit(1);
}

const batches = [...new Set(data.map((r) => r.batch ?? "(无批次)"))];
const stamp = new Date().toLocaleString("zh-CN", { hour12: false });

const describe = (r) =>
  r.kind === "member" ? `会员卡 ${r.days} 天` : `单次解读（${r.mode}）`;

let out = `玄机 · 激活码清单
导出时间：${stamp}
总计：${data.length} 个

使用方式
  用户付款后，取一个「未使用」的码发给他
  用户在网站弹窗里输入该码即解锁
  一码只能用一次；核销后此表不会自动更新，需重新导出核对

定价参考
  单次解读  ¥6.6
  会员月卡  ¥9.9
  会员年卡  ¥69

`;

for (const b of batches) {
  const rows = data.filter((r) => (r.batch ?? "(无批次)") === b);
  const unused = rows.filter((r) => !r.redeemed_at);
  out += `━━━ 批次：${b} ━━━\n`;
  out += `共 ${rows.length} 个，已用 ${rows.length - unused.length} 个，未用 ${unused.length} 个\n\n`;

  out += `【未使用】\n`;
  for (const r of unused) out += `  ${r.code}    ${describe(r)}\n`;

  const used = rows.filter((r) => r.redeemed_at);
  if (used.length) {
    out += `\n【已使用】\n`;
    for (const r of used) {
      const when = new Date(r.redeemed_at).toLocaleString("zh-CN", { hour12: false });
      // 只留设备指纹前 8 位 —— 完整值没有对账价值，却是一串可关联的标识
      const who = (r.redeemed_by ?? "").slice(0, 8);
      out += `  ${r.code}    ${describe(r)}    兑换于 ${when}${who ? `  ${who}…` : ""}\n`;
    }
  }
  out += `\n`;
}

out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
out += `补发新码：\n`;
out += `  node --use-env-proxy --env-file=.env.local scripts/gen-codes.mjs \\\n`;
out += `    --kind single --mode bazi --count 50 --batch <批次名>\n`;

const file = `激活码清单-${new Date().toISOString().slice(0, 10)}.txt`;
writeFileSync(file, out, "utf8");

console.log(`已导出 ${data.length} 个码到：${file}`);
console.log(`  批次: ${batches.join("、")}`);
console.log("");
for (const b of batches) {
  const rows = data.filter((r) => (r.batch ?? "(无批次)") === b);
  console.log(`  ${b}: ${rows.length} 个（未用 ${rows.filter((r) => !r.redeemed_at).length} 个）`);
}
