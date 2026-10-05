/**
 * 让裸 node 能直接 import `src/` 下的应用代码。
 *
 * 解决两件事：
 *   · `@/lib/xxx` 这个别名，只有 tsc / Next 认识，node 不认识
 *   · `import "./bazi"` 这种无扩展名导入指向的是**目录**，node 的 ESM
 *     解析器不支持目录导入（ERR_UNSUPPORTED_DIR_IMPORT）
 *
 * 为什么要它：脚本要复用站点的真代码（提示词、排盘、判定），
 * 抄一份出来迟早与站点漂移 —— 那时脚本验证的就不是线上跑的东西了。
 *
 *   node --import ./scripts/ts-loader.mjs scripts/xxx.mjs
 *
 * Node 24 本身能擦除类型直接跑 .ts，所以这里只需要**解析**，不需要转译。
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve.mjs", pathToFileURL(import.meta.filename));
