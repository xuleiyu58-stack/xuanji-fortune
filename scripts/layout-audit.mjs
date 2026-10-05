#!/usr/bin/env node
/**
 * 在指定视口里量页面的真实宽度 —— 有没有横向溢出、响应式断点按哪个宽度生效。
 *
 * 为什么不靠"看截图猜"：截图上字被切掉，可能是页面真溢出，也可能是拍照参数
 * 写错了（无头模式下 --window-size 是物理像素，CSS 视口宽 = 窗口宽 ÷ dsf，
 * 早先手机档写了 dsf=3，390 的窗口只剩 130 CSS 像素宽，整页都像坏了）。
 * 两种情况从图上看一模一样，只有数字能分开。
 *
 * 为什么不用 iframe 套页面：iframe 里的文档会拿到**外层**窗口的宽度做布局，
 * 于是"宽 390 的 iframe"里量出来的是外层 900 的版式，量了个寂寞。
 * 只有真把这个视口给到页面，量出来的才算数。
 *
 * 做法：起一个带 --remote-debugging-port 的无头 Chrome，用 CDP 直接下命令
 *      （Page.navigate → Emulation.setDeviceMetricsOverride → Runtime.evaluate）。
 * 只连本机端口，不需要梯子；页面本身要连网时才需要。
 *
 * 用法：
 *   node scripts/layout-audit.mjs --url http://localhost:3000 --width 390
 *   node scripts/layout-audit.mjs --preset mobile --shot scripts/_shots/x.png
 *   node scripts/layout-audit.mjs --url http://localhost:3000 --preset mobile --full --shot x.png
 *
 * ——— 关于"最小视口宽"（别再用 --window-size 拍手机档了）———
 * 无头 Chrome 在本机的最小视口宽是 **512 CSS 像素**：给它 --window-size=390,844，
 * 它按 512 排版，然后把图**裁到 390** 存出来。于是截图右边永远缺一块，而
 * window.innerWidth 自报 512 —— 看着像网站坏了，其实是拍照工具的硬限。
 * （实测自检页：请求 390，innerWidth=512、clientWidth=512、scrollWidth=512。）
 * CDP 的 Emulation.setDeviceMetricsOverride **能突破这个下限**，所以窄视口
 * 必须走这条路径：既要量，也要截，都在这里做。
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const PRESETS = {
  mobile: { w: 390, h: 844, mobile: true, label: "手机" },
  phone: { w: 430, h: 932, mobile: true, label: "大屏手机" },
  desktop: { w: 1440, h: 900, mobile: false, label: "桌面" },
  wide: { w: 1920, h: 1080, mobile: false, label: "宽屏" },
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const preset = PRESETS[argOf("preset", "mobile")];
if (!preset) {
  console.error(`未知档位：${argOf("preset", "")}。可选：${Object.keys(PRESETS).join(" / ")}`);
  process.exit(1);
}
const WIDTH = Number(argOf("width", preset.w));
const HEIGHT = Number(argOf("height", preset.h));
/**
 * --scale：像素密度倍数。手机档用 3，因为真机就是 3 倍密度，按 1 倍拍下来
 * 放到剪映里字是糊的。它只改每 CSS 像素对应几个物理像素，**不改 CSS 宽度** ——
 * 与早先那个 dsf 的坑（把 390 的视口算成 130）完全是两回事。
 */
const SCALE = Number(argOf("scale", 1));
/** --scroll-to：截图前滚到某个选择器（拍"会得到什么"那一段要用）。 */
const SCROLL_TO = argOf("scroll-to", "");
/** --click：截图前先点一下某个选择器（折叠的内容要先展开才拍得到）。 */
const CLICK = argOf("click", "");
const URL_ = argOf("url", "https://xuanji-fortune-sage.vercel.app");
const PATH = argOf("path", "/");
const target = URL_.replace(/\/$/, "") + PATH;
const waitMs = Number(argOf("wait", 6000));

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.error("没找到 Chrome 或 Edge。装一个，或用 --browser 指定路径。");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "xj-audit-"));
const PORT = 9333 + Math.floor(Math.random() * 400);

/**
 * 不要在这里加 `--window-size`。
 *
 * 本机两个浏览器在无头模式下都有**最小视口宽**：Chrome 512、Edge 504
 * （实测自检页：请求 360 的窗口，Chrome 的 innerWidth 是 512，Edge 是 504，
 * 而输出的 PNG 却按 360 存 —— 右边永远缺一块）。换浏览器解决不了，
 * 这是两者的共同下限，不是 Chrome 的毛病。
 *
 * 真正能绕过去的是下面那句 Emulation.setDeviceMetricsOverride：
 * 它由浏览器内核直接改设备度量，不受窗口下限约束。窄视口一律走这条路，
 * 截图与量尺寸都用它，别再用命令行 --window-size 拍手机档。
 */
const chrome = spawn(
  exe,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 端口还没起来，继续等 */
    }
    await sleep(250);
  }
  throw new Error("连不上 Chrome 的调试端口");
}

/** 极简 CDP 客户端：只为发几条命令，不引任何依赖。 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("WebSocket 连不上")));
  });
}

const MEASURE = `(() => {
  const de = document.documentElement;
  const W = ${WIDTH};
  // 判据用**内容盒**（clientWidth）当基准，不是请求的宽度。
  // 踩过的坑：页面自己把内容盒撑宽之后（比如页头按被撑宽的视口算成 444），
  // 任何占满宽度的元素右边界都变成 444，拿 390 去比会把它们全报成溢出 ——
  // 于是真正该看的那个（宽 493 的装饰图）混在一堆误报里认不出来。
  const box = de.clientWidth;
  const out = {
    innerWidth: window.innerWidth,
    clientWidth: de.clientWidth,
    scrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    devicePixelRatio: window.devicePixelRatio,
    smActive: window.matchMedia("(min-width: 640px)").matches,
    culprits: [],
  };
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > box + 1) {
      const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
      out.culprits.push(
        el.tagName.toLowerCase() + (cls ? "." + cls : "") +
        " right=" + Math.round(r.right) + " w=" + Math.round(r.width)
      );
      if (out.culprits.length >= 8) break;
    }
  }
  return JSON.stringify(out);
})()`;

let ws;
try {
  ws = await connect(await findTarget());
  const cdp = new CDP(ws);

  await cdp.send("Page.enable");
  // 先定视口再导航：反过来的话首屏会按默认宽度排版一次，量到的是中间态
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    // --scale 只影响**像素密度**（手机屏是 3 倍密度，按 1 倍拍出来字是糊的），
    // 不改变 CSS 宽度 —— 所以它跟早先那个 dsf 的坑不是一回事。
    deviceScaleFactor: SCALE,
    mobile: preset.mobile,
  });
  if (preset.mobile) {
    await cdp.send("Network.enable");
    await cdp.send("Network.setUserAgentOverride", { userAgent: IPHONE_UA });
  }

  const loaded = new Promise((resolve) => {
    const onMsg = (ev) => {
      if (JSON.parse(ev.data).method === "Page.loadEventFired") {
        ws.removeEventListener("message", onMsg);
        resolve();
      }
    };
    ws.addEventListener("message", onMsg);
  });

  await cdp.send("Page.navigate", { url: target });
  await Promise.race([loaded, sleep(20000)]); // 连不上网时别死等
  await sleep(waitMs);

  const res = await cdp.send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
  const data = JSON.parse(res.result.value);

  // 滚动要在"量尺寸"之后做：量的是整页布局，与滚动位置无关，
  // 但截图必须在滚动之后，否则拍到的还是首屏。
  if (CLICK) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(CLICK)});
        if (!el) return "not-found";
        el.click();
        return "clicked";
      })()`,
      returnByValue: true,
    });
    if (r.result.value === "not-found") {
      console.error(`⚠ 没找到选择器 ${CLICK}`);
    } else {
      console.log(`已点击          : ${CLICK}`);
      await sleep(900);
    }
  }

  if (SCROLL_TO) {
    /*
     * scroll-offset：让目标**往下移**若干像素再拍。
     * 光有 scrollIntoView(block:"start") 不够用 —— 目标会被顶到屏幕最上沿，
     * 它上面那一行（比如想一起看的标签）就正好被切掉。
     */
    const SCROLL_OFFSET = Number(argOf("scroll-offset", 90));
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(SCROLL_TO)});
        if (!el) return "not-found";
        el.scrollIntoView({ block: "start", behavior: "instant" });
        window.scrollBy(0, -${SCROLL_OFFSET});
        return Math.round(window.scrollY) + "";
      })()`,
      returnByValue: true,
    });
    if (r.result.value === "not-found") {
      console.error(`⚠ 没找到选择器 ${SCROLL_TO}，截图仍是当前位置`);
    } else {
      console.log(`已滚动到        : ${SCROLL_TO}（scrollY=${r.result.value}）`);
      await sleep(900); // 等滚动触发的入场动画落定
    }
  }

  // 顺带截图。**必须在这一条路径上截** —— 见文件末尾关于最小视口宽的说明。
  const shotPath = argOf("shot", "");
  if (shotPath) {
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: process.argv.includes("--full"),
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    console.log(`截图已保存        : ${shotPath}`);
  }

  const overflow = Math.max(data.scrollWidth, data.bodyScrollWidth) - WIDTH;
  const okWidth = Math.abs(data.innerWidth - WIDTH) <= 1;
  // 真正的判据：**文档**能不能横向滚（documentElement.scrollWidth 有没有超过内容盒）。
  // body.scrollWidth 偏大是正常的 —— 拿 clip 裁掉的装饰溢出仍算在 body 里。
  const hScroll = data.scrollWidth - data.clientWidth;

  console.log(`目标            : ${target}`);
  console.log(`请求的视口      : ${WIDTH}×${HEIGHT}（${preset.label}）`);
  console.log(`页面自报 innerWidth : ${data.innerWidth}  ${okWidth ? "✓ 一致" : "✗ 不一致 —— 视口没设进去"}`);
  console.log(`documentElement.clientWidth : ${data.clientWidth}`);
  console.log(`documentElement.scrollWidth : ${data.scrollWidth}`);
  console.log(`body.scrollWidth            : ${data.bodyScrollWidth}（偏大不一定是问题，见下）`);
  console.log(
    `横向可滚动      : ${hScroll > 1 ? hScroll + " px  <<< 页面能左右拖，要修" : "否 ✓"}`,
  );
  console.log(
    `断点 sm(≥640)   : ${data.smActive ? "生效 <<< 页面按 ≥640 排的版" : "未生效（预期如此）"}`,
  );
  if (data.culprits.length) {
    console.log(`\n越过内容盒右边界的元素（最多 8 个，装饰性溢出可接受）：`);
    for (const c of data.culprits) console.log("  " + c);
  } else {
    console.log(`\n没有元素越过内容盒右边界。`);
  }
  void overflow;

  process.exitCode = hScroll > 1 || !okWidth ? 1 : 0;
} catch (err) {
  console.error("审计失败：" + err.message);
  process.exitCode = 2;
} finally {
  try {
    ws?.close();
  } catch {
    /* 已关 */
  }
  chrome.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 临时目录删不掉不影响结论 */
  }
}
