/**
 * 批量生成激活码。
 *
 * 用法（在仓库根目录）：
 *   node --env-file=.env.local scripts/gen-codes.mjs --kind member --days 30 --count 20 --batch 2026-10
 *   node --env-file=.env.local scripts/gen-codes.mjs --kind single --mode tarot --count 50 --batch 2026-10
 *
 * 刻意不做管理后台：一个只用于发码的网页要额外的密钥与暴露面，脚本够了。
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function makeCode() {
  // 32 整除 256，随机字节取模 32 是无偏的
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`缺少环境变量 ${name}。请确认 .env.local 已配好 Supabase。`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind;
  const count = Number.parseInt(args.count ?? "10", 10);

  if (kind !== "member" && kind !== "single") {
    console.error("--kind 必须是 member 或 single");
    process.exit(1);
  }
  const days = kind === "member" ? Number.parseInt(args.days ?? "30", 10) : 0;
  const mode = kind === "single" ? args.mode : null;
  if (kind === "single" && !mode) {
    console.error("--kind single 时必须给 --mode（bazi / tarot / love）");
    process.exit(1);
  }
  if (!Number.isInteger(count) || count <= 0 || count > 500) {
    console.error("--count 必须是 1..500 的整数");
    process.exit(1);
  }

  const db = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  const rows = [];
  const seen = new Set();
  while (rows.length < count) {
    const code = makeCode();
    if (seen.has(code)) continue; // 生日碰撞概率极低，但重复插入会整批失败，挡一下
    seen.add(code);
    rows.push({ code, kind, mode, days, batch: args.batch ?? null });
  }

  // 插入带重试。
  //
  // 为什么需要：实测中偶发 `TypeError: fetch failed`（网络抖动），
  // 而发码是一次性的手工操作 —— 失败一次就得重来，很烦。
  // 重试是安全的：主键冲突会返回 23505，那种情况说明这批码已经写进去了，
  // 直接当作成功，不会重复发放。
  let written = false;
  let lastError = "";
  for (let attempt = 1; attempt <= 4 && !written; attempt += 1) {
    const { error } = await db.from("redeem_codes").insert(rows);

    if (!error) {
      written = true;
      break;
    }
    lastError = error.message;

    // 主键冲突 = 这批码已经写成功过（上一次请求其实到了，只是回包丢了）
    if (error.code === "23505") {
      console.log("\n注意：这批码已存在于库中（上次请求实际写成功了，只是回包里丢了）。");
      written = true;
      break;
    }
    // 表不存在之类的结构性错误重试没有意义
    if (/does not exist|schema cache/i.test(error.message)) break;

    if (attempt < 4) {
      const wait = attempt * 1200;
      console.log(`写入失败（第 ${attempt} 次）：${error.message} —— ${wait}ms 后重试`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  if (!written) {
    console.error("\n写入失败：", lastError);
    console.error("若提示表不存在，先在 Supabase SQL Editor 执行 supabase/redeem.sql");
    console.error("若是网络问题，重跑本命令即可（已写入的码不会重复发）。");
    process.exit(1);
  }

  const header = kind === "member" ? `会员 ${days} 天` : `单次 · ${mode}`;
  console.log(`\n已生成 ${count} 个激活码（${header}${args.batch ? ` · 批次 ${args.batch}` : ""}）：\n`);
  for (const r of rows) console.log(r.code);
  console.log("\n发放方式：用户付款后把其中一个发给对方，站内输入即解锁。一码只能用一次。\n");
}

main();
