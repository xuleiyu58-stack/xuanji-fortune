#!/usr/bin/env node
/**
 * 给网页拍照 —— 让我能"看见"网站，而不是靠用户截图告诉我哪里坏了。
 *
 * 为什么是这个方案：先前试过 agentbrowse 和 tabbit，两个都因为要连 CDP
 * （devtools 管道）在沙箱里起不来。Chrome 自带的 `--headless --screenshot`
 * 不需要那套 —— 它自己截完写文件就退出，正好绕开沙箱对管道/端口的限制。
 * 所以不用装任何依赖：本机已经有 Chrome（或 Edge）。
 *
 * 用法：
 *   node scripts/shot.mjs                                   # 拍线上首页
 *   node scripts/shot.mjs --url http://localhost:3000       # 拍本地
 *   node scripts/shot.mjs --mobile                          # 手机版（390×844）
 *   node scripts/shot.mjs --full                            # 整页，不止一屏
 *   node scripts/shot.mjs --path /history --out docs/a.png  # 指定页面与输出
 *
 * 一次拍多张、每张不同尺寸：
 *   node scripts/shot.mjs --preset all
 */

import { closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 常见安装位置。Chrome 优先 —— 它的无头模式最稳。 */
const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/**
 * 预设尺寸。dsf 一律为 1 —— 这一条踩过坑，别改回去。
 *
 * 无头模式下 `--window-size` 给的是**物理**像素，CSS 视口宽 = 窗口宽 ÷ dsf。
 * 先前手机档写了 dsf=3，于是 390 的窗口只有 130 CSS 像素宽，页面按 130px
 * 排版、整屏溢出 —— 截出来的图看着像网站坏了，其实是拍照参数写错了。
 * 要"看得清"就把图放大看，不要靠 dsf 把 CSS 宽度搞乱。
 */
const PRESETS = {
  desktop: { w: 1440, h: 900, dsf: 1, mobile: false, label: "桌面" },
  wide: { w: 1920, h: 1080, dsf: 1, mobile: false, label: "宽屏" },
  mobile: { w: 390, h: 844, dsf: 1, mobile: true, label: "手机" },
  phone: { w: 430, h: 932, dsf: 1, mobile: true, label: "大屏手机" },
};

function findBrowser() {
  const found = BROWSERS.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error(
      "没找到 Chrome 或 Edge。装一个，或者用 --browser 指定路径。",
    );
  }
  return found;
}

function parseArgs(argv) {
  const out = {
    url: "https://xuanji-fortune-sage.vercel.app",
    path: "/",
    out: null,
    preset: "desktop",
    full: false,
    wait: 7000,
    browser: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--url") out.url = next();
    else if (a === "--path") out.path = next();
    else if (a === "--out") out.out = next();
    else if (a === "--preset") out.preset = next();
    else if (a === "--browser") out.browser = next();
    else if (a === "--wait") out.wait = Number(next());
    else if (a === "--full") out.full = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "给网页拍照。",
          "",
          "  --url <地址>      默认线上站点",
          "  --path <路径>     默认 /",
          "  --preset <档位>   desktop | wide | mobile（或 all = 三档都拍）",
          "  --out <文件>      输出路径，默认 scripts/_shots/<档位>.png",
          "  --full            整页截图，不止一屏",
          "  --wait <毫秒>     等页面稳定的时间，默认 7000",
          "  --browser <路径>  指定浏览器可执行文件",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return out;
}

function pngSize(file) {
  // PNG 的宽高写死在 IHDR 里，固定偏移 16/20。只读文件头 24 字节就够，
  // 不必把整张图读进来，也不必装任何图片库。
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(24);
    readSync(fd, head, 0, 24, 0);
    return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
  } finally {
    closeSync(fd);
  }
}

function shoot(browser, cfg, url, outFile, wait, full) {
  mkdirSync(dirname(outFile), { recursive: true });
  if (existsSync(outFile)) rmSync(outFile);

  // 用户数据目录必须每次独立且可写；放在系统临时目录，不污染仓库
  const profile = resolve(
    process.env.TEMP || "C:\\Windows\\Temp",
    `xj-shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    `--user-data-dir=${profile}`,
    `--window-size=${cfg.w},${cfg.h}`,
    `--force-device-scale-factor=${cfg.dsf}`,
  ];
  if (cfg.mobile) {
    // 让页面真的走手机布局（媒体查询、触摸目标），而不只是把窗口缩窄
    args.push("--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
  }
  // virtual-time-budget 会让页面"以为"时间过得更快，异步内容也能落定
  args.push(`--virtual-time-budget=${wait}`);
  args.push(`--screenshot=${outFile}`, url);

  try {
    execFileSync(browser, args, { stdio: ["ignore", "ignore", "ignore"], timeout: 120_000 });
  } finally {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不算错 */
    }
  }

  if (!existsSync(outFile)) throw new Error(`浏览器没写出截图：${outFile}`);
  const { w, h } = pngSize(outFile);
  return { w, h, bytes: statSync(outFile).size };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const browser = opts.browser || findBrowser();
  const url = opts.url.replace(/\/$/, "") + opts.path;

  const wanted =
    opts.preset === "all"
      ? ["desktop", "wide", "mobile"]
      : [opts.preset];

  for (const name of wanted) {
    const cfg = PRESETS[name];
    if (!cfg) throw new Error(`不认识的档位「${name}」，可选：${Object.keys(PRESETS).join(", ")}`);

    const outFile = opts.out
      ? resolve(ROOT, opts.out)
      : resolve(ROOT, "scripts", "_shots", `${name}.png`);

    const r = shoot(browser, cfg, url, outFile, opts.wait, opts.full);
    if (!opts.quiet) {
      console.log(
        `${cfg.label.padEnd(4)} ${r.w}×${r.h}  ${(r.bytes / 1024).toFixed(0)} KB  ${outFile}`,
      );
    }
  }
}

main();
