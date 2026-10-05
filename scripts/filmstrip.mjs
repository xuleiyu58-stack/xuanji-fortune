#!/usr/bin/env node
/**
 * 把一段视频抽成一张「胶片」（网格拼图），让看不见视频的人也能检查它。
 *
 * 为什么必须有这个：我没有视频播放器，只能看静态图。没有它，"换场叠字、
 * 节奏拖沓、字幕一闪而过"这类问题我永远发现不了 —— 上次「四柱」压在
 * 「五行分布」上面，是用户先看出来的。有了胶片，至少能按时间顺序一眼扫过。
 *
 * 用法：
 *   node scripts/filmstrip.mjs video/rec/hero.mp4
 *   node scripts/filmstrip.mjs in.mp4 --cols 5 --rows 4 --tile 360 --out x.png
 *   node scripts/filmstrip.mjs in.mp4 --start 4 --end 12 --every 0.4
 *
 * 默认从整段均匀取样：cols×rows 个时刻。想盯某几秒就传 --start/--end。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const argv = process.argv;
const val = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);

/*
 * 位置参数要从**脚本名之后**开始找。
 * 踩过的坑：直接 argv.find(...) 会命中 argv[1] —— 那是 node.exe 自己的路径，
 * 于是 ffmpeg 被喂了 "C:\Program Files\nodejs\node.exe"，
 * 报 "Invalid data found when processing input"，看着像视频坏了。
 */
const scriptIdx = argv.findIndex((a) => /filmstrip\.mjs$/i.test(a));
const positional = argv.slice(scriptIdx >= 0 ? scriptIdx + 1 : 2).filter((a) => !a.startsWith("--"));
const input = positional.find((a) => existsSync(a)) ?? positional[0];
if (!input) {
  console.error("用法：node scripts/filmstrip.mjs <视频文件> [--cols 4 --rows 4 --tile 400 --out x.png]");
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`找不到文件：${input}`);
  process.exit(1);
}

const COLS = Number(val("cols", 4));
const ROWS = Number(val("rows", 4));
const TILE = val("tile", "");
// 不写死单格宽度：竖屏视频的帧高远大于宽，固定 400 宽会拼出一张又高又窄、
// 看的时候还要缩得很小的图。默认给**总宽**，由它反推单格宽更实用。
const SHEET_W = Number(val("sheet-width", 3200));
const TILE_PX = TILE ? Number(TILE) : Math.max(120, Math.floor(SHEET_W / COLS));
const OUT = val("out", input.replace(/\.[^.]+$/, "") + "-filmstrip.png");
const START = val("start", "");
const END = val("end", "");
const EVERY = val("every", "");

const ffmpeg = process.env.FFMPEG_PATH;
if (!ffmpeg) {
  console.error("需要设 FFMPEG_PATH（用 imageio-ffmpeg 自带的那个就行）");
  process.exit(1);
}

const info = (() => {
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", input], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    // ffmpeg 把媒体信息写在 stderr 上，且没有输出文件时必然以非零码退出 ——
    // 所以"抛错"是正常路径，信息就在 e.stderr 里，不要当失败处理。
    return String(e.stderr || "");
  }
  return "";
})();

const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(info);
const totalSec = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;

let fpsExpr;
if (EVERY) {
  fpsExpr = `fps=1/${EVERY}`;
  if (START || END) {
    console.log("提示：给了 --every 就按固定间隔抽，--start/--end 只用来限制范围");
  }
} else {
  // 均匀取 cols×rows 个时刻：等效帧率 = 张数 ÷ 时长
  const n = COLS * ROWS;
  const span = END && START ? Number(END) - Number(START) : totalSec;
  const fps = span > 0 ? n / span : 1;
  fpsExpr = `fps=${fps.toFixed(6)}`;
}

const seek = START ? ["-ss", String(START)] : [];
const until = END ? ["-to", String(END)] : [];

const vf = `${fpsExpr},scale=${TILE_PX}:-1:flags=lanczos,tile=${COLS}x${ROWS}:padding=6:color=0x202020`;

try {
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      ...seek,
      ...until,
      "-i", input,
      "-vf", vf,
      "-frames:v", "1",
      OUT,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (e) {
  console.error("抽帧失败：" + String(e.stderr || e.message).slice(0, 600));
  process.exit(1);
}

console.log(`胶片：${OUT}`);
console.log(`  ${COLS}×${ROWS} 格，每格宽 ${TILE_PX}px，取自 ${input}（总长 ${totalSec.toFixed(2)}s）`);
console.log(`  时间顺序：从左到右、从上到下`);
