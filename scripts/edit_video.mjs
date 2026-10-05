/**
 * 把真实录屏剪成能直接发的成片。
 *
 * 分工的依据：我的短板是**看不见"动"**（没有播放器），长板是**画得准、
 * 改得快、能反复重来**。所以这条流水线不假装替代剪辑软件，它做的是
 * 剪辑软件做起来最费手的那些事：
 *
 *   · 用 Chrome 把真页面的真动效录下来（不是逐帧假造）
 *   · 抽帧拼成胶片，让我**能看见**自己在剪什么
 *   · 按时间轴压上片头、字幕、落版 —— 这些位置的每一处都能用数字指定
 *
 * 配乐、真人出镜、情绪节奏仍然交给剪映：那些是需要耳朵和审美的活，
 * 我在这里老实承认做不了。
 *
 *   node scripts/edit_video.mjs
 *   node scripts/edit_video.mjs --plan scripts/rec/plan.json
 *
 * ——— 两个必须记住的坑 ———
 *
 * 1) ffmpeg 的 `drawtext` 里，字体路径**不能出现 `C:`**：冒号是选项分隔符，
 *    解析器会把 `fontfile=C` 当成一个选项、后面全乱。所以字体一律先拷到
 *    工作目录，用相对路径 `f.ttc`。
 *
 * 2) 字幕**不要贴在画面最下沿**。抖音/小红书底部会盖一层账号名、文案、
 *    进度条，放最下面的字会被压掉。留出底部约 30% 的安全区。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK = path.join(ROOT, "video", "edit");
const FFMPEG = process.env.FFMPEG_PATH;

if (!FFMPEG) {
  console.error("需要 FFMPEG_PATH 环境变量。");
  process.exitCode = 1;
}

const W = 1080;
const H = 1920;
const FPS = 30;

/** 品牌色。与网站、与 make_video.py 同源。 */
const GOLD = "0xD4AF5A";
const PAPER = "0xF2EFE6";

/**
 * 各条文案在**字号 64** 时的像素宽度（微软雅黑粗体，用 Pillow 量出来的）。
 *
 * 为什么要这张表：字号靠拍必然溢出 —— 成片第一版就是这样，
 * 「四柱、藏干、十神，全部由程序按节气推算」在字号 64 时宽 1216px，
 * 而画面可用宽度只有 960px，左右各被切掉一百多像素。
 * 有了实测宽度，字号就能算出来而不是猜出来。
 *
 * 宽度与字号近似线性（同一种字体、同一种渲染），所以缩放按比例即可。
 * 新增文案要么在这里补一行，要么宁可用保守字号。
 */
const TEXT_W64 = {
  "填出生日期、时辰、性别": 704,
  "四柱、藏干、十神，全部由程序按节气推算": 1216,
  "不是从模板里挑一句，是照你的盘算的": 1088,
  "日主强弱、喜用忌神、五行分布": 896,
  "四柱、藏干、十神，都由程序按节气推算": 1088,
  "不是从模板里挑一句，是按你的盘算的": 1024,
  "玄 机": 147,
  "程序排盘 · AI 解读": 538,
  "四柱是算出来的，不是编的": 768,
  "生辰已隐去，四柱可自行核对": 832,
  "xuanji-fortune-sage.vercel.app": 989,
  "命理之说，信则有不信则无，仅供娱乐": 1088,
};

/** 画面宽度与左右安全边。 */
const SAFE_X = 60;

/**
 * 把字号缩到**装得下**为止。
 *
 * 已知实测宽度就按比例缩；未知的新文案退回一个保守值（48）——
 * 宁可小一点，也不要溢出被切掉。
 */
function fitSize(text, want, usable = W - SAFE_X * 2) {
  const w64 = TEXT_W64[text];
  if (!w64) return Math.min(want, 48);
  const maxFit = Math.floor((64 * usable) / w64);
  return Math.max(28, Math.min(want, maxFit));
}



function main() {
  mkdirSync(WORK, { recursive: true });

  // 字体：必须相对路径（见文件头第 1 条）。ffmpeg 的工作目录设成 .tmp。
  const fontDir = path.join(ROOT, ".tmp");
  mkdirSync(fontDir, { recursive: true });
  const font = path.join(fontDir, "f.ttc");
  if (!existsSync(font)) copyFileSync("C:/Windows/Fonts/msyhbd.ttc", font);

  const planPath = path.join(ROOT, "scripts", "rec", "plan.json");
  const cfg = existsSync(planPath) ? JSON.parse(readFileSync(planPath, "utf8")) : DEFAULT_PLAN;
  console.log(`片名：${cfg.title}`);
  console.log(`段数：${cfg.shots.length}`);
  cfg.shots.forEach((s, i) => console.log(`  ${i + 1}. ${s.kind.padEnd(9)} ${s.label ?? ""}`));

  const parts = [];
  cfg.shots.forEach((shot, i) => {
    const out = path.join(WORK, `part-${String(i).padStart(2, "0")}.mp4`);
    if (existsSync(out)) rmSync(out);
    renderShot(shot, out, fontDir);
    parts.push(out);
    console.log(`  已渲染 ${path.basename(out)}`);
  });

  // 拼接。各段参数已统一（同尺寸、同帧率、同像素格式、都有音轨），
  // 所以可以直接 concat 而不用重编码滤镜图。
  const listFile = path.join(WORK, "list.txt");
  writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"), "utf8");

  const finalOut = path.join(ROOT, "video", cfg.output);
  run([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    finalOut,
  ]);

  const kb = Math.round(statSync(finalOut).size / 1024);
  console.log(`\n成片：${finalOut}  ${kb} KB`);
}

function renderShot(shot, out, fontDir) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];

  if (shot.kind === "card") {
    // 纯色卡：片头/落版。没有任何输入素材，直接合成。
    args.push("-f", "lavfi", "-i", `color=c=0x0b0e17:s=${W}x${H}:d=${shot.dur}:r=${FPS}`);
  } else {
    // src 在剧本里写的是相对仓库根的路径，但 ffmpeg 的工作目录被设成了
    // 字体所在目录（就为了躲开路径里的 `C:`），所以这里必须转成绝对路径。
    args.push("-ss", String(shot.from ?? 0), "-t", String(shot.dur), "-i", path.resolve(ROOT, shot.src));
  }

  // 静音音轨：各段轨道数一致，concat 才不用重建。
  args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");

  const chain = [];
  if (shot.kind === "card") {
    chain.push(...cardLayers(shot));
  } else {
    chain.push(...clipLayers(shot));
  }
  chain.push(`scale=${W}:${H}:flags=lanczos`, `fps=${FPS}`, "format=yuv420p");

  args.push(
    "-vf",
    chain.join(","),
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-t",
    String(shot.dur),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "19",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    out,
  );

  // 工作目录设成字体所在目录：路径里就没有盘符冒号了。
  run(args, fontDir);
}

/** 纯色卡的图层：淡入淡出 + 文字。 */
function cardLayers(shot) {
  const layers = [];
  const fadeIn = Math.min(0.6, shot.dur / 4);
  const fadeOut = Math.min(0.6, shot.dur / 4);
  layers.push(`fade=t=in:st=0:d=${fadeIn}`);
  layers.push(`fade=t=out:st=${(shot.dur - fadeOut).toFixed(2)}:d=${fadeOut}`);

  const lines = shot.lines ?? [];
  lines.forEach((ln, i) => {
    layers.push(drawText(ln.text, ln.size ?? 58, ln.color ?? PAPER, ln.y ?? 760 + i * 110, 0.04));
  });
  return layers;
}

/**
 * 录屏段的图层：底部压一层渐隐黑带 + 字幕。
 *
 * 黑带不是为了好看，是为了**字幕在任何画面上都读得清** ——
 * 录屏内容有深有浅，不铺底的话字幕会在浅色区域糊掉。
 */
function clipLayers(shot) {
  const layers = [];
  const caps = shot.captions ?? [];

  /*
   * 字幕条要**盖满**它那一层，而且**装得下"字幕 + 水印"两行**。
   * 早先两处都错过：先只铺 620px 高、字幕基线却在 H-470，画面里的正文
   * 从条子上方透出来；改成 520px 之后又轮到水印压到字幕上 ——
   * 高度得按"字幕基线 + 字高 + 水印 + 上下留白"倒推，不是随手给个数。
   */
  const BAND_H = 620;
  const BAND_TOP = H - BAND_H;

  if (caps.length) {
    layers.push(
      `drawbox=x=0:y=${BAND_TOP}:w=${W}:h=${BAND_H}:color=0x05070d@0.86:t=fill`,
      `drawbox=x=0:y=${BAND_TOP}:w=${W}:h=4:color=${GOLD}@0.35:t=fill`,
    );
  }

  for (const c of caps) {
    // 每条字幕各自带淡入淡出，切换时才不会"啪"地跳字
    const size = fitSize(c.text, c.size ?? 64);
    layers.push(drawText(c.text, size, c.color ?? PAPER, c.y ?? BAND_TOP + 130, 0.35, c.from, c.to));
  }

  /*
   * 右下角常驻水印：观众截图转发时，域名还在画面上。
   * 位置必须**在字幕条上方**，否则会跟字幕叠在一起（成片前两版都栽在这）。
   */
  if (shot.watermark !== false) {
    layers.push(
      drawText(shot.watermarkText ?? "xuanji-fortune-sage.vercel.app", 30, GOLD, BAND_TOP + BAND_H - 78, 0, 0, null, 0.7),
    );
  }
  return layers;
}

/**
 * 一条 drawtext。
 *
 * `alpha` 之外的第七个参数是时间窗：ffmpeg 用 `between(t,from,to)` 控制
 * 显隐，两端各留 `edge` 秒做淡入淡出。不写时间窗就是全程显示。
 */
function drawText(text, size, color, y, edge, from = null, to = null, alpha = 1) {
  const safe = String(text).replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:");
  const opts = [
    "fontfile=f.ttc",
    `text='${safe}'`,
    `fontcolor=${color}@${alpha}`,
    `fontsize=${size}`,
    "x=(w-text_w)/2",
    `y=${y}`,
  ];
  if (from !== null && to !== null) {
    opts.push(`alpha='if(between(t,${from},${to}),if(lt(t,${from}+${edge}),(t-${from})/${edge},if(gt(t,${to}-${edge}),(${to}-t)/${edge},1)),0)'`);
  }
  return `drawtext=${opts.join(":")}`;
}

function run(args, cwd = ROOT) {
  execFileSync(FFMPEG, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

/**
 * 默认剧本。
 *
 * 时间码是**照着录屏实际内容对过的**，不是估的：
 * `scripts/rec/chart-flow.actions.json` 里 1.5s 开始打字、约 7.5s 提交，
 * 提交后 3~4 秒出结果。所以 12s 之后画面已经是命盘了。
 */
const DEFAULT_PLAN = {
  title: "玄机 · 程序排盘",
  output: "xuanji-feed-01.mp4",
  shots: [
    {
      kind: "card",
      label: "片头",
      dur: 2.6,
      lines: [
        { text: "玄 机", size: 128, color: GOLD, y: 800 },
        { text: "程序排盘 · AI 解读", size: 48, color: PAPER, y: 990 },
        { text: "四柱是算出来的，不是编的", size: 44, color: GOLD, y: 1300 },
      ],
    },
    {
      kind: "clip",
      label: "真实录屏",
      src: "video/rec/01-flow.mp4",
      from: 1.2,
      dur: 14.6,
      captions: [
        { text: "填出生日期、时辰、性别", from: 0.4, to: 3.2 },
        { text: "四柱、藏干、十神，都由程序按节气推算", from: 3.6, to: 7.4 },
        { text: "不是从模板里挑一句，是按你的盘算的", from: 7.8, to: 11.6 },
        { text: "日主强弱、喜用忌神、五行分布", from: 12.0, to: 14.6 },
      ],
    },
    {
      kind: "card",
      label: "落版",
      dur: 4.0,
      lines: [
        { text: "玄 机", size: 112, color: GOLD, y: 780 },
        { text: "生辰已隐去，四柱可自行核对", size: 46, color: PAPER, y: 1010 },
        { text: "xuanji-fortune-sage.vercel.app", size: 40, color: GOLD, y: 1220 },
        { text: "命理之说，信则有不信则无，仅供娱乐", size: 30, color: PAPER, y: 1620 },
      ],
    },
  ],
};

// 必须在 DEFAULT_PLAN 之后调用：它在 main() 里当兜底值，
// 而 `const` 到定义那一行才初始化，提前调用会 TDZ 报错。
if (FFMPEG) main();
