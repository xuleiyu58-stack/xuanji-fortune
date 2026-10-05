/**
 * 清掉限流与试读的当日计数。
 *
 * 用途：录演示视频、反复自测的时候，不留神就把免费试读额度试光了 ——
 * 于是下一次请求直接弹付款窗。那个付款窗会**盖在正文上**（浮层本来就该盖），
 * 录进宣传片里就成了"产品上来先要钱"，完全不是要展示的东西。
 *
 * 只清 `usage` 表里当日的计数行。**不动 `pass_consumptions`**（那是审计台账，
 * 记着哪张券在哪台设备上被消费过，清掉就等于放开了重放）。
 *
 *   node --use-env-proxy --env-file=.env.local scripts/reset-quota.mjs
 *   node --use-env-proxy --env-file=.env.local scripts/reset-quota.mjs --dry-run
 *   node --use-env-proxy --env-file=.env.local scripts/reset-quota.mjs --yes
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const YES = process.argv.includes("--yes");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。");
  console.error("本地跑要带代理与 env 文件：");
  console.error("  node --use-env-proxy --env-file=.env.local scripts/reset-quota.mjs");
  process.exitCode = 1;
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** 与 src/lib/server/usage-store.ts 的 today() 同源：北京时间的自然日。 */
function today() {
  const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

const day = today();

const { data: rows, error: readErr } = await db
  .from("usage")
  .select("key, day, count")
  .eq("day", day)
  .order("key");

if (readErr) {
  console.error("读取 usage 失败：", readErr.message);
  if (/fetch failed|ENOTFOUND|ETIMEDOUT/i.test(readErr.message)) {
    console.error("（看着像网络问题：本机 Node 连 Supabase 要挂代理，见文件头注释。）");
  }
  process.exitCode = 1;
}

if (!rows || !rows.length) {
  console.log(`${day} 没有任何计数，不用清。`);
  process.exitCode = 0;
  // 不能在还有存活连接时 process.exit()：libuv 会抛
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"。
  // 设 exitCode 让事件循环自然收尾即可。
} else {
  console.log(`${day} 的计数行（共 ${rows.length} 条）：`);
  for (const r of rows) console.log(`  ${String(r.count).padStart(5)}  ${r.key}`);

  if (DRY) {
    console.log("\n--dry-run：什么都没做。");
  } else if (!YES) {
    console.log(`\n要删掉上面这 ${rows.length} 条吗？确认请加 --yes。`);
  } else {
    const { error: delErr } = await db.from("usage").delete().eq("day", day);
    if (delErr) {
      console.error("删除失败：", delErr.message);
      process.exitCode = 1;
    } else {
      console.log(`\n已清掉 ${rows.length} 条。pass_consumptions 台账未动。`);
    }
  }
}
