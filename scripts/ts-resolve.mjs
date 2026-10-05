/**
 * `ts-loader.mjs` 的实现部分（解析钩子）。
 *
 * 规则，按顺序：
 *   1. `@/x`  → `<仓库根>/src/x`
 *   2. 相对路径指向目录 → 先试 `/index.ts`、`/index.tsx`
 *   3. 相对路径没有扩展名 → 依次试 `.ts`、`.tsx`、`.mjs`、`.js`
 *
 * 只处理仓库内的路径；node_modules 与 node: 内建模块原样放行。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const SRC = path.join(ROOT, "src");
const EXTS = [".ts", ".tsx", ".mjs", ".js"];

/** 猜一个真实存在的文件。找不到就返回 null，交给下一个钩子。 */
function firstExisting(base) {
  if (existsSync(base) && !existsSync(path.join(base, "."))) {
    // 是文件（不是目录）
    try {
      if (path.extname(base)) return base;
    } catch {
      /* 落到下面 */
    }
  }
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p)) return p;
  }
  for (const ext of EXTS) {
    const p = path.join(base, "index" + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // 别名
  if (specifier.startsWith("@/")) {
    const hit = firstExisting(path.join(SRC, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }

  // 相对/绝对路径的补全
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
    const abs = specifier.startsWith("/")
      ? specifier
      : path.resolve(path.dirname(parent), specifier);
    if (path.extname(abs) && existsSync(abs)) {
      return { url: pathToFileURL(abs).href, shortCircuit: true };
    }
    const hit = firstExisting(abs);
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
