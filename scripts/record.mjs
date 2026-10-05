#!/usr/bin/env node
/**
 * 录网页的真实动效 —— 用 Chrome 自己的录屏接口把页面运行过程存成视频。
 *
 * 为什么不用 make_video.py 那套逐帧画：那是在**假造**动画。页面本来就有的动
 * （标题浮入、五行条生长、解读逐字打出、下拉三级的联动），逐帧画出来只是模仿，
 * 而且排版坐标要手调七八轮。录屏录的是真页面，排版由网站自己负责。
 *
 * 走 CDP 的 Page.startScreencast：
 *   - 帧由浏览器内核推过来（Base64 PNG），每帧必须 ack 下一帧才会来；
 *   - 帧的**时间戳由浏览器给**，所以哪怕渲染卡了、掉帧了，时间轴仍然是对的
 *     （这一点很重要：按"我收到几帧"来算时长，会越算越长，音画对不上）。
 *   - 之后交给 ffmpeg 用 `-f concat` 按各帧自己的时长拼成视频，再统一转成
 *     yuv420p / 30fps —— 只有统一帧率之后手机才认。
 *
 * 用法：
 *   node scripts/record.mjs --url http://localhost:3000 --out video/rec/hero.mp4
 *   node scripts/record.mjs --script scripts/rec/hero.actions.json
 *
 * 动作文件是一个数组，按顺序执行：
 *   { "wait": 1200 }
 *   { "scrollTo": 1767 }            滚到某个 y
 *   { "scrollBy": { "y": 600, "ms": 1200 } }   平滑滚动（录"滚动"这个动作本身）
 *   { "click": "#sample button" }
 *   { "hover": ".btn-mystic" }
 *   { "move": { "x": 540, "y": 1600 } }        鼠标移过去（配合 hover 效果）
 *   { "type": { "selector": "input[name=birthDate]", "text": "1992-02-04" } }
 *   { "eval": "document.title" }              逃生口，做上面没覆盖到的事
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const argOf = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const URL_ = argOf("url", "http://localhost:3000");
const OUT = resolve(argOf("out", "video/rec/recording.mp4"));
const WIDTH = Number(argOf("width", 360));
const HEIGHT = Number(argOf("height", 640));
/**
 * 录屏画布（CSS 像素）。
 *
 * 手机档给的是 360×640，那是**手机上真实的样子**；但直接录下来字体在视频里
 * 小得看不清，而且早先录出来只有 360×640 —— Page.startScreencast 的 maxWidth
 * 是布局像素，deviceScaleFactor 放大不了它。
 *
 * 所以竖屏宣传片走 vw/vh：把 CSS 视口直接开到 1080×1920，页面按这个宽度排版，
 * 字号自然就是该有的视觉大小。**注意这时的断点是桌面断点**（1080 ≥ 640），
 * 页面会显示桌面版的排布 —— 对宣传片通常更好看（导航完整、留白舒展），
 * 但如果你要看"手机上长什么样"，就用 --width 360 那套。
 */
const CSS_W = Number(argOf("vw", WIDTH));
const CSS_H = Number(argOf("vh", HEIGHT));
/** 输出视频的像素尺寸。CSS 画布按这个尺寸录，再整体缩到它（1080×1920 是竖屏标准）。 */
const VIDEO_W = Number(argOf("out-width", 1080));
const VIDEO_H = Number(argOf("out-height", 1920));
const SCALE = Number(argOf("scale", 1));
const FPS = Number(argOf("fps", 30));
const MOBILE = !process.argv.includes("--desktop");
const STARTUP_WAIT = Number(argOf("startup", 6000));
const scriptFile = argOf("script", "");

const actions = scriptFile
  ? JSON.parse(readFileSync(resolve(scriptFile), "utf8"))
  : [{ wait: Number(argOf("duration", 8000)) }];

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.error("没找到 Chrome 或 Edge。");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "xj-rec-"));
const framesDir = mkdtempSync(join(tmpdir(), "xj-frames-"));
const PORT = 9500 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  exe,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {
      /* 端口还没起来 */
    }
    await sleep(250);
  }
  throw new Error("连不上 Chrome 的调试端口");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
        }
        return;
      }
      const h = this.handlers.get(m.method);
      if (h) h(m.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    this.handlers.set(method, fn);
  }
}

async function main() {
  const wsUrl = await findTarget();
  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(wsUrl);
    s.addEventListener("open", () => res(s));
    s.addEventListener("error", () => rej(new Error("WebSocket 连不上")));
  });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: CSS_W,
    height: CSS_H,
    deviceScaleFactor: SCALE,
    mobile: MOBILE,
  });
  if (MOBILE) {
    await cdp.send("Network.enable");
    await cdp.send(
      "Network.setUserAgentOverride",
      {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    );
  }

  // 录屏帧：浏览器推一帧，必须 ack，否则它就不再推了
  const frames = [];
  let firstTs = null;
  cdp.on("Page.screencastFrame", async (p) => {
    const ts = p.metadata.timestamp ?? Date.now() / 1000;
    if (firstTs === null) firstTs = ts;
    frames.push({ index: frames.length, t: ts - firstTs, data: p.data });
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId });
    } catch {
      /* 收尾阶段会有一两帧 ack 不上，忽略 */
    }
  });
  const loaded = new Promise((res) => {
    cdp.on("Page.loadEventFired", res);
    setTimeout(res, 25000);
  });
  await cdp.send("Page.navigate", { url: URL_ });
  await loaded;
  await sleep(STARTUP_WAIT); // 等字体与入场动画落定，且此时还没开始录

  console.log(`开始录制 ${actions.length} 个动作……`);
  await cdp.send("Page.startScreencast", {
    format: "png",
    quality: 100,
    // 这两个是**布局像素**上限，deviceScaleFactor 放大不了它们 —— 所以画布开多大，
    // 录出来就是多大。要 1080 宽的片子就得把 CSS 视口开到 1080。
    maxWidth: CSS_W * SCALE,
    maxHeight: CSS_H * SCALE,
    everyNthFrame: 1,
  });

  for (const [i, a] of actions.entries()) {
    await runAction(cdp, a);
    console.log(`  ${i + 1}/${actions.length} ${describe(a)}`);
  }

  await cdp.send("Page.stopScreencast");
  await sleep(400);
  ws.close();

  if (!frames.length) throw new Error("一帧都没录到");

  // 每一帧的时长 = 下一帧的时间戳 − 这一帧的时间戳；最后一帧按平均帧间隔给
  const last = frames[frames.length - 1];
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).filter((g) => g > 0);
  const avg = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 1 / FPS;
  const tail = Math.max(avg, 1 / FPS);

  const manifest = [];
  for (const [i, f] of frames.entries()) {
    const name = `f${String(i).padStart(5, "0")}.png`;
    writeFileSync(join(framesDir, name), Buffer.from(f.data, "base64"));
    const next = frames[i + 1];
    const dur = next ? Math.max(next.t - f.t, 1 / 120) : tail;
    manifest.push({ name, dur });
  }

  const listFile = join(framesDir, "list.txt");
  writeFileSync(
    listFile,
    manifest.map((m) => `file '${m.name}'\nduration ${m.dur.toFixed(5)}`).join("\n") +
      `\nfile '${manifest[manifest.length - 1].name}'\n`,
    "utf8",
  );

  const total = manifest.reduce((s, m) => s + m.dur, 0);
  console.log(
    `录到 ${frames.length} 帧，时长 ${total.toFixed(2)}s，平均 ${(total / frames.length * 1000).toFixed(0)}ms/帧`,
  );

  mkdirSync(dirname(OUT), { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH || (await findFfmpeg());
  // -vf 里先把帧缩到目标视频尺寸再定帧率：录到的帧可能比目标大（画布大），
  // 也可能带奇数宽高（x264 要求偶数），一次缩放同时解决两件事。
  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-vsync", "vfr",
    "-vf", `scale=${VIDEO_W}:${VIDEO_H}:flags=lanczos,fps=${FPS},format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-movflags", "+faststart",
    OUT,
  ];
  execFileSync(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`完成：${OUT}`);
}

function describe(a) {
  if (a.wait) return `等 ${a.wait}ms`;
  if (a.click) return `点击 ${a.click}`;
  if (a.hover) return `悬停 ${a.hover}`;
  if (a.scrollTo !== undefined) return `滚到 y=${a.scrollTo}`;
  if (a.scrollBy) return `平滑滚动 ${a.scrollBy.y}px / ${a.scrollBy.ms}ms`;
  if (a.type) return `在 ${a.type.selector} 输入`;
  if (a.eval) return `求值`;
  return JSON.stringify(a);
}

async function runAction(cdp, a) {
  const evalJs = async (expr) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`页面里报错：${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
    }
    return r.result.value;
  };

  if (a.wait) return sleep(a.wait);

  if (a.scrollTo !== undefined) {
    // 用 instant：这一段录的是"结果"，不是"滚动这个动作"，直接到位更干净
    await evalJs(`window.scrollTo({top:${a.scrollTo},behavior:"instant"});0`);
    return sleep(220);
  }

  if (a.scrollBy) {
    const { y = 0, ms = 1000, minStep = 75 } = a.scrollBy;
    /*
     * 自己按帧推进，而不是用 behavior:"smooth" —— 平滑滚动的时长由浏览器定，
     * 我控制不了；自己推进才能在"该慢的地方慢"（视频节奏就靠这个）。
     *
     * minStep 是必须的：Chromium 对滚动/transform 这类动画会**自己合并回调**，
     * 你请求 36ms 一帧，它就干脆一步跳到终点。实测小位移（60px / 900ms）下
     * 整个滚动只发生一次，录出来是"刷"地跳过去。给每步一个最小间隔，
     * 步数就按它反推，动画才会真的分很多帧走完。
     */
    const totalSteps = Math.max(1, Math.floor(ms / Math.max(minStep, 16)));
    const step = Math.max(ms / totalSteps, 16);
    await evalJs(`(async () => {
      const from = window.scrollY, to = from + (${y});
      const steps = ${totalSteps}, stepMs = ${step};
      for (let k = 1; k <= steps; k++) {
        const p = k / steps;
        const e = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2; // ease-in-out
        window.scrollTo(0, Math.round(from + (to - from) * e));
        await new Promise(r => setTimeout(r, stepMs));
      }
      window.scrollTo(0, Math.round(to));
      return Math.round(window.scrollY);
    })()`);
    return;
  }

  if (a.click) {
    const id = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(a.click)});
      if (!el) return "not-found";
      el.scrollIntoView({block:"center",behavior:"instant"});
      el.click();
      return "ok";
    })()`);
    if (id === "not-found") throw new Error(`没找到 ${a.click}`);
    return sleep(150);
  }

  if (a.hover) {
    // CSS 的 :hover 用鼠标坐标就能触发，不必真的移动系统光标
    const box = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(a.hover)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
    })()`);
    if (!box) throw new Error(`没找到 ${a.hover}`);
    const { x, y } = JSON.parse(box);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
    return sleep(120);
  }

  if (a.move) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: a.move.x,
      y: a.move.y,
      buttons: 0,
    });
    return;
  }

  if (a.type) {
    const { selector, text } = a.type;
    // 一个字一个字地派发按键：React 的受控输入要靠真实事件才会更新状态，
    // 直接改 value 页面是不知道的。
    const ok = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      return true;
    })()`);
    if (!ok) throw new Error(`没找到 ${selector}`);
    for (const ch of text) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch });
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", text: ch });
      await sleep(70);
    }
    return;
  }

  if (a.fill) {
    // { "fill": { "selector": ".x", "value": "v", "delay": 90, "scroll": true } }
    const { selector, value, delay = 0 } = a.fill;
    const scroll = a.fill.scroll !== false;
    const ok = await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "not-found";
      ${scroll ? 'el.scrollIntoView({block:"center",behavior:"instant"});' : ""}
      el.focus();
      return "ok";
    })()`);
    if (ok === "not-found") throw new Error(`没找到 ${selector}`);

    const setter = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "not-found";
      /*
       * 必须用原型上的原生 setter，不能写 el.value = v。
       * React 在 input 上挂了自己的 value 追踪器：直接赋值会让它以为"值没变"，
       * 于是 onChange 根本不触发，页面拿到的是空表单。用原生 setter 绕开追踪器，
       * 再派发 input 事件，React 才会当成用户真的输入了。
       */
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                  : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return String(el.value);
    })()`;

    if (!delay) {
      const got = await evalJs(setter);
      if (got === "not-found") throw new Error(`填值时找不到 ${selector}`);
      if (got !== value) throw new Error(`填 ${selector} 失败：期望 ${value}，实际 ${got}`);
      return sleep(180);
    }

    // 带 delay：模拟人打字，一个字符一个字符地填（日期框也吃这套）
    for (let i = 1; i <= value.length; i++) {
      await evalJs(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 0;
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        desc.set.call(el, ${JSON.stringify(value)}.slice(0, ${i}));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return 1;
      })()`);
      await sleep(delay);
    }
    return;
  }

  if (a.eval) {
    const v = await evalJs(a.eval);
    if (v !== undefined && v !== 0) console.log(`    → ${String(v).slice(0, 200)}`);
    return;
  }

  if (a.waitFor) {
    const deadline = Date.now() + (a.waitFor.timeout ?? 30000);
    while (Date.now() < deadline) {
      const hit = await evalJs(`!!document.querySelector(${JSON.stringify(a.waitFor.selector)})`);
      if (hit) return sleep(a.waitFor.then ?? 200);
      await sleep(300);
    }
    throw new Error(`等不到 ${a.waitFor.selector}`);
  }
}

async function findFfmpeg() {
  // imageio-ffmpeg 自带一个静态 ffmpeg 二进制，不必联网装
  const py = process.env.PYTHON_PATH;
  if (py && existsSync(py)) {
    try {
      const { execFileSync } = await import("node:child_process");
      const p = execFileSync(py, ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], {
        encoding: "utf8",
      }).trim();
      if (p && existsSync(p)) return p;
    } catch {
      /* 换下面的兜底 */
    }
  }
  throw new Error("找不到 ffmpeg。设 FFMPEG_PATH，或设 PYTHON_PATH 指向带 imageio-ffmpeg 的 python。");
}

try {
  await main();
} catch (err) {
  console.error("录制失败：" + err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(300);
  for (const d of [profile, framesDir]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不影响产物 */
    }
  }
}
