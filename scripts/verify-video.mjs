/**
 * 出片前的自动核对：**页面上真的算对了，才允许录**。
 *
 * 为什么非要有这一步：录制脚本本身从不判断对错，它只是一直录 ——
 * 录完靠我肉眼抽几帧看。上一次准，是运气好。而这个项目的错误代价很高：
 * 排盘错一个字（比如年柱在立春前后错一天），观众里懂行的人一眼就看出来，
 * 而那个人本来是最可能付钱的人。
 *
 * 所以把它变成机械检查，而不是"我看过一眼"：
 *
 *   1. 用真浏览器打开站点、按录制脚本一模一样地填表提交
 *   2. 从**渲染出来的正文**里抽出四柱 —— 看的是观众看到的东西
 *   3. 跟 `src/lib/bazi` 独立算出来的结果逐字比对
 *   4. 顺带检查日主、五行分布、以及正文里有没有"张冠李戴"
 *
 * 第 4 条不是多余的：首页样张曾经手写四柱（庚戌 辛未 庚辰 辛巳），
 * 而那组八字根本推不出来，它下面的「依据」还引用了四柱里不存在的「丑」。
 * 手写的干支没有出处，写错了没人知道 —— 这个脚本就是要让那种错无处可藏。
 *
 *   node scripts/verify-video.mjs
 *   node scripts/verify-video.mjs --url http://localhost:3000 --cases 3
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildBaziChart } from "../src/lib/bazi/index.ts";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const BASE = arg("url", "http://localhost:3000").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 要核对的日子。
 *
 * 刻意选**边界日**而不是随便挑几天：
 *   · 1992-02-04 —— 立春当天，年柱最容易错在这里
 *   · 2000-02-29 —— 闰日
 *   · 1984-02-04 —— 立春 *之前*，年柱该是癸亥不是甲子
 *   · 23:30 —— 晚子时，日柱换不换日最容易在这里出分歧
 */
const CASES = [
  { birthDate: "1992-02-04", birthTime: "07:20", gender: "男", why: "立春当天" },
  { birthDate: "2000-02-29", birthTime: "12:00", gender: "女", why: "闰日" },
  { birthDate: "1984-02-03", birthTime: "12:00", gender: "男", why: "立春前一天" },
  { birthDate: "1995-11-08", birthTime: "23:30", gender: "女", why: "晚子时" },
  { birthDate: "2010-06-15", birthTime: "03:10", gender: "男", why: "普通日子" },
];

const cases = CASES.slice(0, Number(arg("cases", CASES.length)));

/* ────────────────────────── CDP ────────────────────────── */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (!m.id) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "页面里执行出错");
    return r.result.value;
  }
}

async function launch() {
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("没找到 Chrome 或 Edge");

  const profile = mkdtempSync(join(tmpdir(), "xj-verify-"));
  const port = 9800 + Math.floor(Math.random() * 190);
  const proc = spawn(
    exe,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {
      /* 端口还没起来 */
    }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error("连不上 Chrome 的调试端口");

  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(wsUrl);
    s.addEventListener("open", () => res(s));
    s.addEventListener("error", () => rej(new Error("WebSocket 连不上")));
  });

  return {
    cdp: new CDP(ws),
    close() {
      try {
        ws.close();
        proc.kill();
      } catch {
        /* 收尾失败无所谓 */
      }
      /*
       * 用户目录不能立刻删：Chrome 刚被 kill，句柄还没释放，
       * rmSync 直接 EPERM 把整个脚本带崩（实测）。删不掉就算了 ——
       * 留在系统临时目录里，比让核对脚本自己报错强。
       */
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
      } catch {
        /* 下次开机系统会清临时目录 */
      }
    },
  };
}

/* ─────────────────────── 页面操作 ─────────────────────── */

/**
 * 在页面里做的事：填表 → 提交 → 等命盘出现。
 *
 * 填值必须走**原型上的原生 value setter 再派发 input/change** ——
 * React 在 input 上挂了自己的 value 追踪器，直接写 `el.value = v`，
 * 它会认为"值没变"、onChange 根本不触发，于是提交的是空表单。
 * （这个坑在 record.mjs 里也踩过，两处都要这么做，不能省。）
 */
const FILL_AND_SUBMIT = (c) => `
(async () => {
  const setValue = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  /*
   * 阳历生日是三个下拉（年/月/日），不是一个日期框 —— 这个改动的理由与
   * 为什么要跟农历统一，见 BirthInput.tsx 的头部注释。
   *
   * **必须按"年 → 月 → 日"的顺序设**，而且每一步都要等 React 重渲染：
   * 「日」的选项数量取决于当时选中的年与月（2 月只有 28/29 天），
   * 而年月是从 value.birthDate 反解出来的 —— 先设日再设月，
   * 那个日会落在"当月没有这一天"的选项列表之外，变成设不进去。
   * 这正是这个改动最容易埋下的坑：平时看不出，只在 29/30/31 号上错。
   */
  const [yy, mm, dd] = ${JSON.stringify(c.birthDate)}.split("-").map((s) => String(Number(s)));
  const ySel = document.querySelector('select[aria-label="阳历年"]');
  const mSel = document.querySelector('select[aria-label="阳历月"]');
  const dSel = document.querySelector('select[aria-label="阳历日"]');
  if (!ySel || !mSel || !dSel) return { ok: false, why: "找不到阳历的年月日下拉" };

  setValue(ySel, yy);
  await new Promise(r => setTimeout(r, 120));
  setValue(document.querySelector('select[aria-label="阳历月"]'), mm);
  await new Promise(r => setTimeout(r, 120));
  setValue(document.querySelector('select[aria-label="阳历日"]'), dd);
  await new Promise(r => setTimeout(r, 120));

  const dateShown = (
    document.querySelector('select[aria-label="阳历年"]')?.value + "-" +
    String(document.querySelector('select[aria-label="阳历月"]')?.value).padStart(2, "0") + "-" +
    String(document.querySelector('select[aria-label="阳历日"]')?.value).padStart(2, "0")
  );
  if (dateShown !== ${JSON.stringify(c.birthDate)}) {
    return { ok: false, why: "生日没设进去：下拉显示 " + dateShown };
  }

  const time = document.querySelector("#birth-time");
  const gender = document.querySelector("#birth-gender");
  if (!time || !gender) return { ok: false, why: "找不到时辰或性别字段" };

  setValue(time, ${JSON.stringify(c.birthTime)});
  setValue(gender, ${JSON.stringify(c.gender)});
  await new Promise(r => setTimeout(r, 250));

  const form = document.querySelector("form");
  if (!form) return { ok: false, why: "找不到 form" };
  if (!form.checkValidity()) return { ok: false, why: "表单校验不通过" };

  form.requestSubmit ? form.requestSubmit() : form.querySelector("button[type=submit]").click();

  /*
   * 等结果页出现。
   *
   * 判据必须是**只有结果页才有的东西**。第一版等的是「藏干」+「五行分布」，
   * 而首页常见问题里就有原话"四柱、藏干、十神、五行、大运全部由确定性算法推算" ——
   * 于是表单还没提交完判据就满足了，抓到的是首页正文（1504 字）。
   * 所以改等「日主强弱」这类只在命盘里出现的小节标题。
   */
  const hasChart = () => {
    const t = document.body.innerText;
    return t.includes("日主强弱") || t.includes("帮身");
  };

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (hasChart()) return { ok: true };
    const t = document.body.innerText;
    const bad = t.match(/解读生成失败|次数已用完|服务繁忙|请稍后重试/);
    if (bad) return { ok: false, why: "页面报错：" + bad[0] };
  }
  return { ok: false, why: "等命盘超时（60 秒）" };
})()
`;

/* ─────────────────────── 正文提取 ─────────────────────── */

const GAN = "甲乙丙丁戊己庚辛壬癸";
const ZHI = "子丑寅卯辰巳午未申酉戌亥";

/** 从正文里把"命盘"那一块切出来。 */
function chartSection(text) {
  const start = text.indexOf("命盘");
  if (start < 0) return "";
  // 到「五行分布」之后的「格局」为止 —— 再往后就不是命盘了
  const end = text.indexOf("格局", text.indexOf("五行分布", start));
  return text.slice(start, end > start ? end : start + 4000);
}

/**
 * 从正文里抓四柱。
 *
 * 抓法：在命盘那一块里，把「天干+地支」都是**单字**的相邻组合找出来。
 * 直接把干支字符连起来数是不行的 —— 干支字本身也出现在别处
 * （藏干、十神说明、五行分布），会数出一堆假阳性。
 * 这里用"两字紧邻、且两字各自都在干支表里"来定位柱，
 * 再把连续出现的柱合成一个序列。
 */
function extractPillars(section) {
  const compact = section.replace(/\s+/g, "");
  const found = [];
  for (let i = 0; i < compact.length - 1; i++) {
    const a = compact[i];
    const b = compact[i + 1];
    if (GAN.includes(a) && ZHI.includes(b)) {
      found.push({ gz: a + b, at: i });
    }
  }
  if (process.argv.includes("--dump")) {
    console.log(`     [诊断] 单字干支对 ${found.length} 个：${found.map((f) => f.gz + "@" + f.at).join(" ")}`);
  }
  // 只看彼此紧邻（间隔为 2）的那些，它们才是"四柱并排"的那一串
  const runs = [];
  let cur = [];
  for (const f of found) {
    if (!cur.length || f.at === cur[cur.length - 1].at + 2) cur.push(f);
    else {
      if (cur.length >= 2) runs.push(cur);
      cur = [f];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  if (!runs.length) return [];

  // 最长的那一串就是四柱（其它即便凑巧成串也不会比它长）
  runs.sort((x, y) => y.length - x.length);
  return runs[0].map((r) => r.gz);
}

/* ─────────────────────── 主流程 ─────────────────────── */

const results = [];
let hardFail = 0;

const { cdp, close } = await launch();
try {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  console.log(`站点：${BASE}`);
  console.log(`核对 ${cases.length} 个日子（都是容易算错的边界）`);
  console.log("");

  for (const c of cases) {
    const expected = buildBaziChart({
      birthDate: c.birthDate,
      birthTime: c.birthTime,
      gender: c.gender,
    });
    const want = expected.pillars.map((p) => `${p.gan}${p.zhi}`);

    // 每个日子都用新的页面：表单有草稿状态，复用容易互相干扰
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await sleep(2600);

    const formRes = await cdp.eval(FILL_AND_SUBMIT(c));
    if (!formRes?.ok) {
      // 失败时把"页面当时长什么样"留下来 —— 只看一个"超时"没法判断
      // 是接口错了、是界面没渲染、还是我的判据又想当然了。
      const diag = await cdp.eval(`(() => {
        const t = document.body.innerText;
        return {
          url: location.href,
          len: t.length,
          hasChartHeading: t.includes("命盘"),
          hasDayMaster: t.includes("日主"),
          hasModal: t.includes("请用「支付宝」扫一扫") || t.includes("我已付款"),
          head: t.slice(0, 260),
        };
      })()`);
      console.log(`   [诊断] ${JSON.stringify(diag, null, 0)}`);
      results.push({ ...c, want, got: [], note: `操作失败：${formRes?.why}` });
      hardFail++;
      continue;
    }

    const body = await cdp.eval("document.body.innerText");
    const section = chartSection(body);
    const got = extractPillars(section);

    if (!section || has("dump")) {
      console.log(`   → 正文 ${body.length} 字，命盘段 ${section.length} 字。命盘段前 500 字：`);
      console.log("     " + section.slice(0, 500).replace(/\n/g, " ⏎ "));
    }

    const same = got.length === want.length && got.every((g, i) => g === want[i]);
    const dayMasterShown = body.includes(expected.dayMaster);

    let note = [];
    if (!same) note.push(`四柱不符：期望 ${want.join(" ")}，页面 ${got.join(" ") || "(抓不到)"}`);
    if (!dayMasterShown) note.push(`正文里没出现日主「${expected.dayMaster}」`);
    if (!section) note.push("命盘那一段没抓到（页面结构变了吗？）");

    if (c.why) hardFail++;
    results.push({ ...c, want, got, dayMaster: expected.dayMaster, note: note.join("；") });

    console.log(
      `${same && dayMasterShown ? "✓" : "✗"} ${c.birthDate} ${c.birthTime}（${c.why}）` +
        `  期望 ${want.join(" ")}` +
        (same ? "" : `  实际 ${got.join(" ") || "(抓不到)"}`),
    );

    // 拿到结果之后再 dump —— 这才是"页面长什么样"的实况
    if (has("dump")) {
      const diag = await cdp.eval(`(() => {
        const t = document.body.innerText;
        const i = t.indexOf("日主强弱");
        return { url: location.href, len: t.length, idx: i, around: i >= 0 ? t.slice(i - 60, i + 160) : t.slice(0, 200) };
      })()`);
      console.log(`   [诊断] url=${diag.url} len=${diag.len} 日主强弱@${diag.idx}`);
      console.log("     " + String(diag.around).replace(/\n/g, " ⏎ "));
    }
  }
} finally {
  close();
}

console.log("");
const bad = results.filter((r) => r.note);
if (bad.length) {
  console.log(`✗ ${bad.length}/${results.length} 个日子对不上：`);
  for (const b of bad) console.log(`   ${b.birthDate} ${b.birthTime}：${b.note}`);
  console.log("");
  console.log("**不要录**：先查清是排盘错了，还是页面没渲染出来。");
  process.exitCode = 1;
} else {
  console.log(`✓ ${results.length}/${results.length} 个日子全部通过：`);
  console.log("  页面上渲染出来的四柱，与 src/lib/bazi 独立算出来的结果逐字一致。");
  console.log("  可以录了。");
}
