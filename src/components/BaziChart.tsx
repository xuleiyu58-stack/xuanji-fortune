"use client";

import { useState } from "react";
// 类型是纯类型导入，会被完全擦除；常量则**刻意**从叶子模块取，不走 @/lib/bazi 入口 ——
// 入口会牵出 places.ts，而 places.ts 静态引用了 60KB 的区划数据，
// 一旦走入口，那份数据就随首屏包一起发出去了。
import type { BaziChart as Chart } from "@/lib/bazi";
import type { WuXing } from "@/lib/bazi/constants";
import type { ShenShaTone } from "@/lib/bazi/shensha";
import { SHEN_SHA_CAVEAT } from "@/lib/bazi/shensha";
import { PALACE_MEANING } from "@/lib/bazi/constants";
import { YONG_SHEN_METHOD } from "@/lib/bazi/strength";

/**
 * 命盘。
 *
 * 八字的价值一半在盘、一半在解。盘是排出来的死数据，就该用表格和条形老老实实呈现。
 *
 * **「易懂」是本组件的首要约束**：命理最难的不是算，是让人看懂。
 * 所以每一个术语（身强、格局、十神、空亡、神煞…）后面都必须紧跟一句不带行话的说明，
 * 而且说明要**显示出来**，不能藏在 tooltip 里 —— 手机上根本没有 hover。
 * 呈现顺序也有讲究：先给结论（我是谁、强弱如何），再给依据（四柱、五行），
 * 最后给细节（神煞、合冲）。反过来读，用户在第一屏就迷失了。
 *
 * 五行用色是传统的（木青火赤土黄金白水黑），做了去饱和处理以便落在墨色底上。
 */
export const ELEMENT_COLOR: Record<WuXing, string> = {
  木: "#7fb08e",
  火: "#c9745a",
  土: "#c2a061",
  金: "#c3c9d4",
  水: "#7aa0c0",
};

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

/** 术语后面紧跟的一句人话。刻意做成行内可见，不做 tooltip。 */
function Hint({ children }: { children: React.ReactNode }) {
  return <span className="text-paper-100/55 text-xs leading-relaxed">{children}</span>;
}

function Section({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 last:mb-0 ${className}`}>
      <h4 className="text-xs tracking-[0.2em] text-paper-100/55 mb-1">{title}</h4>
      {hint && <p className="text-paper-100/55 text-xs mb-4 leading-relaxed">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

/** 一个五行字，带色。 */
function El({ children, element, size = "1em" }: { children: React.ReactNode; element: WuXing; size?: string }) {
  return (
    <span style={{ ...SERIF, color: ELEMENT_COLOR[element], fontSize: size }}>{children}</span>
  );
}

const TONE_STYLE: Record<ShenShaTone, { label: string; cls: string }> = {
  吉: { label: "吉", cls: "border-jade-500/35 text-jade-400" },
  凶: { label: "凶", cls: "border-vermillion-400/30 text-vermillion-400" },
  中性: { label: "中", cls: "border-gold-300/25 text-paper-100/60" },
};

export default function BaziChart({ chart }: { chart: Chart }) {
  const nowYear = new Date().getFullYear();
  const [openDaYun, setOpenDaYun] = useState<number | null>(
    chart.daYun.findIndex((d) => nowYear >= d.startYear && nowYear <= d.endYear)
  );

  const { strength, pattern } = chart;
  const helpPct = Math.round(strength.ratio * 100);

  return (
    <section className="mystic-card rounded-xl p-6 sm:p-8" aria-label="八字命盘">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 className="text-lg text-gold" style={SERIF}>命盘</h3>
        <p className="text-paper-100/55 text-xs tracking-wider">
          {chart.solarDate} · 农历{chart.lunarDate} · 属{chart.zodiac}
        </p>
      </header>

      {/* 时间是怎么定的，必须摆明 —— 时柱错了整张盘就错了，用户有权知道我们用了哪个时刻 */}
      <div className="rounded-lg border border-gold-300/12 bg-mystic-800/40 px-4 py-3 mb-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-paper-100/55">出生时间</span>
          <span className="text-paper-100/80 tabular-nums">{chart.clockTime}</span>
          <span className="text-paper-100/55">
            （{chart.calendar === "lunar" ? "农历输入，已换算为公历" : "阳历"}）
          </span>
          {chart.trueSolarTime ? (
            <>
              <span className="text-paper-100/55">→</span>
              <span className="text-gold-300 tabular-nums">真太阳时 {chart.trueSolarTime}</span>
              <span className="text-paper-100/55">
                按{chart.birthPlace}的经度换算，差 {chart.solarOffsetMinutes} 分钟
                {chart.birthPlaceApproximate && "（该地经度为省内估值）"}
                {chart.standardTimeZone && `（${chart.standardTimeZone}，1949 年前中国分五个时区）`}
              </span>
            </>
          ) : (
            <span className="text-paper-100/55">· 未填出生地，按钟表时间排</span>
          )}
        </div>
        {chart.trueSolarCrossedDay && (
          <p className="text-vermillion-400/80 text-xs mt-2 leading-relaxed">
            真太阳时校正后跨了午夜，四柱按{" "}
            <span className="text-vermillion-400">{chart.chartDateText}</span> 排定 ——
            与上报的生日差一天，日柱因此不同。想对照钟表时间的排法，把出生地留空再排一次即可。
          </p>
        )}
      </div>

      {/* ── 一句话结论：先让人知道自己是谁 ────────────────── */}
      <div className="rounded-lg border border-gold-500/25 bg-gold-500/[0.04] p-5 mb-8">
        <p className="text-sm text-paper-100/70 mb-3">
          你是
          <span className="mx-1.5 text-2xl align-baseline" style={{ ...SERIF, color: ELEMENT_COLOR[chart.dayMasterElement] }}>
            {chart.dayMaster}
          </span>
          <El element={chart.dayMasterElement}>{chart.dayMasterElement}</El>
          <span className="mx-1.5 text-paper-100/55">·</span>
          <span className="text-gold-300">{strength.verdict}</span>
          {pattern && (
            <>
              <span className="mx-1.5 text-paper-100/55">·</span>
              <span className="text-gold-300">{pattern.name}</span>
            </>
          )}
        </p>
        <p className="text-paper-100/60 text-sm leading-loose mb-4">{strength.summary}</p>

        {/* 计分账目摊开给人看 —— 命理最怕的就是"大师说了算" */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-paper-100/50">
              帮身 <span className="text-gold-300 tabular-nums">{helpPct}%</span>
            </span>
            <span className="text-paper-100/55">
              耗身 <span className="tabular-nums">{100 - helpPct}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-paper-100/[0.08] overflow-hidden flex">
            <div className="h-full bg-gold-400/70" style={{ width: `${helpPct}%` }} />
          </div>
          <p className="text-paper-100/55 text-xs mt-2 leading-relaxed">
            帮身＝生我（印）与同我（比劫）之力；耗身＝我生（食伤）、我克（财）、克我（官杀）之力。
            月令的分量按两倍计 —— 出生那个月是全局气机最重的地方。
          </p>
        </div>
      </div>

      {/* ── 用神喜忌 ───────────────────────────────────── */}
      <Section
        title="喜用与忌讳"
        hint="身强就要泄、要克；身弱就要生、要扶。这一行决定了后面所有吉凶判断的方向。"
      >
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "用神", element: strength.yongShen, note: "最需要的那一行" },
            { label: "喜神", element: strength.xiShen, note: "生用神者，同吉" },
            { label: "忌神", element: strength.jiShen, note: "克用神者，宜避" },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-gold-300/12 bg-mystic-800/40 px-3 py-4 text-center">
              <div className="text-[11px] tracking-[0.2em] text-paper-100/55 mb-3">{item.label}</div>
              <El element={item.element} size="1.75rem">{item.element}</El>
              <div className="text-paper-100/55 text-[11px] mt-3 leading-snug">{item.note}</div>
            </div>
          ))}
        </div>
        {/* 取用神是八字里分歧最大的一步，口径必须摆明，不能让人以为是定论 */}
        <p className="text-paper-100/55 text-xs mt-4 leading-relaxed">{YONG_SHEN_METHOD}</p>
      </Section>

      {/* ── 十神力量 ───────────────────────────────────── */}
      <Section
        title="十神力量"
        hint="身强身弱回答「我够不够强」，这一节回答「我的力气花在哪」。哪一组最旺，只说明那股力量在命里占的位置最重 —— 它无关于吉凶。"
      >
        <div className="space-y-2.5">
          {strength.groupPower.map((g, i) => (
            <div key={g.group} className="flex items-center gap-3">
              <span className={`w-28 shrink-0 text-xs ${i === 0 ? "text-gold-300" : "text-paper-100/55"}`}>
                {g.label}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-paper-100/[0.07] overflow-hidden">
                <div
                  className={`h-full rounded-full ${i === 0 ? "bg-gold-400/70" : "bg-paper-100/25"}`}
                  style={{ width: `${Math.max(g.percent, 2)}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs text-paper-100/55 tabular-nums shrink-0">
                {g.percent}%
              </span>
            </div>
          ))}
        </div>
        <p className="text-paper-100/55 text-xs mt-4 leading-relaxed">
          计算方法与上面的强弱判定同源：天干计 0.8，地支藏干按本气 1 / 中气 0.5 / 余气 0.25，月支整体乘 2。
        </p>
      </Section>

      {/* ── 四柱 ───────────────────────────────────────── */}
      <Section
        title="四柱"
        hint="年柱看祖上与早年，月柱看父母与青年，日柱是自己与配偶，时柱看子女与晚年。每柱上下各一字：上为天干，下为地支。"
      >
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {chart.pillars.map((p) => (
            <div
              key={p.label}
              className={`rounded-lg border px-2 py-4 text-center ${
                p.isDayMaster ? "border-gold-500/45 bg-gold-500/[0.07]" : "border-gold-300/10 bg-mystic-800/40"
              }`}
            >
              <div className="text-[11px] tracking-[0.2em] text-paper-100/55">{p.label}</div>
              {/* 宫位：同一柱既是一段时间，也是一个亲属/关系的位置。
                  十神说「什么力量」，宫位说「这股力量落在谁身上、哪一段人生」。 */}
              <div className="text-[10px] text-paper-100/55 mb-3">
                {PALACE_MEANING[p.label]?.title ?? ""}
              </div>
              {/* 十神紧贴天干**上方** —— 它描述的就是这个天干字。
                  放在地支下面会让人以为它说的是地支。 */}
              <div className="text-[11px] text-paper-100/60 mb-1.5">{p.shiShen}</div>
              <div className="text-3xl sm:text-4xl leading-none" style={{ ...SERIF, color: ELEMENT_COLOR[p.ganElement] }}>
                {p.gan}
              </div>
              <div className="text-3xl sm:text-4xl leading-none mt-3" style={{ ...SERIF, color: ELEMENT_COLOR[p.zhiElement] }}>
                {p.zhi}
              </div>

              {/* 藏干与支中十神 —— 地支才是根，只看天干看不全。
                  支中十神写在各自的藏干旁边，而不是单列一行，免得又跟天干混起来。 */}
              <div className="mt-3 pt-3 border-t border-gold-300/10">
                <div className="text-[10px] text-paper-100/55 mb-1.5">藏干</div>
                <div className="space-y-1">
                  {p.hidden.map((h) => (
                    <div key={h.gan} className="text-[11px] leading-tight">
                      <El element={h.element}>{h.gan}</El>
                      <span className="text-paper-100/55 ml-1">{h.shiShen}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 pt-2 border-t border-gold-300/10 space-y-1">
                <div className="text-[10px] text-paper-100/55">{p.naYin}</div>
                <div className="text-[10px] text-paper-100/55">{p.diShi ?? "—"}</div>
                {p.xunKong && <div className="text-[10px] text-paper-100/55">空亡 {p.xunKong}</div>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-paper-100/55 text-xs mt-3 leading-relaxed">
          藏干＝地支里藏着的天干，往往是一个人的根底；旁边那行十神是藏干对日主的关系。
          十二长生（长生／沐浴／临官／帝旺…）说明这一柱对日主是助力还是消耗，临官与帝旺最有力。
          柱名下面那行是<b className="text-paper-100/50 font-normal">宫位</b>——
          同一柱既是一段时间，也是一个关系位置：
          {chart.pillars.map((p, i) => (
            <span key={p.label}>
              {i > 0 ? "；" : " "}
              {p.label}主{PALACE_MEANING[p.label]?.plain ?? ""}
            </span>
          ))}
          。
        </p>
      </Section>

      {/* ── 五行 ───────────────────────────────────────── */}
      <Section
        title="五行分布"
        hint="天干各计 1 分，地支藏干按本气 1 / 中气 0.5 / 余气 0.25 计权。占比悬殊处，就是命局失衡的地方。"
      >
        <div className="space-y-2.5">
          {chart.elements.map((e) => (
            <div key={e.element} className="flex items-center gap-3">
              <El element={e.element} size="0.875rem">{e.element}</El>
              <div className="flex-1 h-1.5 rounded-full bg-paper-100/[0.07] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${e.percent}%`, background: ELEMENT_COLOR[e.element] }}
                />
              </div>
              <span className="w-20 text-right text-xs text-paper-100/55 tabular-nums shrink-0">
                {e.value} · {e.percent}%
              </span>
            </div>
          ))}
        </div>
        {chart.missing.length > 0 && (
          <p className="text-paper-100/50 text-xs mt-3">
            全局不见
            <span className="mx-1 text-paper-100/80">{chart.missing.join("、")}</span>
            ——「缺」不等于「需要补」，要结合上面的用神看。
          </p>
        )}
      </Section>

      {/* ── 格局 ───────────────────────────────────────── */}
      {pattern && (
        <Section title="格局" hint="月令是全局气机的主气，格局就从月支上取，用来判断一个人适合走什么路。">
          <div className="rounded-lg border border-gold-300/12 bg-mystic-800/40 p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-gold-300 text-base" style={SERIF}>{pattern.name}</span>
              {pattern.transparent && (
                <span className="text-[10px] text-gold-400/70 border border-gold-400/25 rounded px-1.5 py-0.5">透干</span>
              )}
            </div>
            <p className="text-paper-100/60 text-sm leading-loose mb-2">{pattern.plain}</p>
            <Hint>{pattern.note}</Hint>
          </div>
        </Section>
      )}

      {/* ── 神煞 ───────────────────────────────────────── */}
      {chart.shenSha.length > 0 && (
        <Section title="神煞" hint={SHEN_SHA_CAVEAT}>
          <div className="space-y-2">
            {chart.shenSha.map((s, i) => (
              <div key={`${s.name}-${s.position}-${i}`} className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 text-[10px] border rounded px-1.5 py-0.5 ${TONE_STYLE[s.tone].cls}`}>
                  {TONE_STYLE[s.tone].label}
                </span>
                <div className="min-w-0">
                  <span className="text-paper-100/75 text-sm">{s.name}</span>
                  <span className="text-paper-100/55 text-xs ml-2">{s.position}{s.hitOn}</span>
                  <p className="text-paper-100/50 text-xs leading-relaxed mt-1">{s.plain}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── 合冲 ───────────────────────────────────────── */}
      {(chart.relations.he.length > 0 ||
        chart.relations.chong.length > 0 ||
        chart.relations.xing.length > 0 ||
        chart.relations.hai.length > 0 ||
        chart.relations.triple.length > 0 ||
        chart.relations.ganHe.length > 0) && (
        <Section
          title="干支关系"
          hint="合是牵绊与联结，冲是对撞与变动，刑是纠缠与磨损，害是暗损与隔阂。四类都不是好坏的标签，而是说明命局里有哪些力量在互相拉扯。一对支可能同时带几种（如巳申既合又刑），那不是重复，是真实并存的两股力。"
        >
          <div className="flex flex-wrap gap-2">
            {chart.relations.ganHe.map((r, i) => (
              <span key={`gh${i}`} className="text-xs border border-gold-300/20 rounded px-2.5 py-1 text-paper-100/65">
                {r.pair.join("")}合化{r.element}
              </span>
            ))}
            {chart.relations.he.map((r, i) => (
              <span key={`h${i}`} className="text-xs border border-jade-500/25 rounded px-2.5 py-1 text-paper-100/65">
                {r.pair.join("")}六合{r.element ? `化${r.element}` : ""}
              </span>
            ))}
            {chart.relations.triple.map((t, i) => (
              <span key={`t${i}`} className="text-xs border border-jade-500/25 rounded px-2.5 py-1 text-paper-100/65">
                {t.branches.join("")}{t.complete ? "三合" : "半合"}{t.element}局
              </span>
            ))}
            {chart.relations.chong.map((r, i) => (
              <span key={`c${i}`} className="text-xs border border-vermillion-400/30 rounded px-2.5 py-1 text-paper-100/65">
                {r.pair.join("")}相冲
              </span>
            ))}
            {chart.relations.xing.map((r, i) => (
              <span key={`x${i}`} className="text-xs border border-vermillion-400/22 rounded px-2.5 py-1 text-paper-100/65">
                {r.pair[0]}{r.pair[1]}{r.kind === "自刑" ? "自刑" : "相刑"}
              </span>
            ))}
            {chart.relations.hai.map((r, i) => (
              <span key={`hh${i}`} className="text-xs border border-paper-100/20 rounded px-2.5 py-1 text-paper-100/55">
                {r.pair.join("")}相害
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── 胎元命宫身宫 ───────────────────────────────── */}
      <Section
        title="胎元 · 命宫 · 身宫"
        hint="传统上用来补看命局的三个点：胎元看先天禀赋，命宫看一生的底色，身宫看后天所处的位置。"
      >
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: "胎元", value: chart.taiYuan },
            { label: "命宫", value: chart.mingGong },
            { label: "身宫", value: chart.shenGong },
          ].map((x) => (
            <div key={x.label} className="rounded-lg border border-gold-300/12 bg-mystic-800/40 py-3">
              <div className="text-[11px] tracking-[0.2em] text-paper-100/55 mb-2">{x.label}</div>
              <div className="text-lg text-paper-100/80" style={SERIF}>{x.value}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 大运 ───────────────────────────────────────── */}
      <Section
        title="大运"
        hint={`每十年换一步运。${chart.startAgeText}。点开一步可以看那一运里的十个流年。`}
      >
        <div className="-mx-1 px-1 flex gap-2 overflow-x-auto pb-2 mb-3">
          {chart.daYun.map((step, i) => {
            const isCurrent = nowYear >= step.startYear && nowYear <= step.endYear;
            const isOpen = openDaYun === i;
            return (
              <button
                key={`${step.ganZhi}-${step.startYear}`}
                onClick={() => setOpenDaYun(isOpen ? null : i)}
                className={`shrink-0 rounded-lg border px-3 py-2.5 text-center min-w-[4.5rem] transition-colors ${
                  isCurrent
                    ? "border-gold-500/50 bg-gold-500/[0.08]"
                    : isOpen
                      ? "border-gold-300/30"
                      : "border-gold-300/10 hover:border-gold-300/25"
                }`}
              >
                <div className={`text-base ${isCurrent ? "text-gold-300" : "text-paper-100/65"}`} style={SERIF}>
                  {step.ganZhi}
                </div>
                <div className="text-[10px] text-paper-100/55 mt-1 tabular-nums">{step.startAge} 岁</div>
                <div className="text-[10px] text-paper-100/55 tabular-nums">{step.startYear}</div>
              </button>
            );
          })}
        </div>

        {openDaYun !== null && chart.daYun[openDaYun] && (
          <div className="rounded-lg border border-gold-300/12 bg-mystic-800/40 p-4">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-paper-100/70 text-sm">
                {chart.daYun[openDaYun].startYear}–{chart.daYun[openDaYun].endYear}
                <span className="text-paper-100/55 ml-2 text-xs">
                  {chart.daYun[openDaYun].startAge} 岁起
                </span>
              </span>
              <span className="text-paper-100/55 text-xs">流年</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {chart.daYun[openDaYun].liuNian.map((n) => {
                const isThisYear = n.year === nowYear;
                return (
                  <div
                    key={n.year}
                    className={`rounded border px-2 py-2 text-center ${
                      isThisYear ? "border-gold-500/45 bg-gold-500/[0.07]" : "border-gold-300/10"
                    }`}
                  >
                    <div className={`text-sm ${isThisYear ? "text-gold-300" : "text-paper-100/70"}`} style={SERIF}>
                      {n.ganZhi}
                    </div>
                    <div className="text-[10px] text-paper-100/55 tabular-nums mt-0.5">{n.year}</div>
                    <div className="text-[10px] text-paper-100/55 tabular-nums">{n.age} 岁</div>
                  </div>
                );
              })}
            </div>

            {/* 流月：只给当年那一个流年带上，理由见 LiuNianStep 的注释 */}
            {(() => {
              const thisYear = chart.daYun[openDaYun].liuNian.find((n) => n.year === nowYear);
              if (!thisYear?.liuYue?.length) return null;
              return (
                <div className="mt-4 pt-4 border-t border-gold-300/10">
                  <div className="text-paper-100/55 text-xs mb-2">{nowYear} 年的十二流月</div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {thisYear.liuYue.map((m) => (
                      <div key={m.month} className="rounded border border-gold-300/10 px-1.5 py-1.5 text-center">
                        <div className="text-[11px] text-paper-100/65" style={SERIF}>{m.ganZhi}</div>
                        <div className="text-[10px] text-paper-100/55">{m.month}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 小运：与流年并列的十年。流年看外象，小运看内因，两者合看更细 */}
            {chart.daYun[openDaYun].xiaoYun.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gold-300/10">
                <div className="text-paper-100/55 text-xs mb-2">
                  小运
                  <span className="text-paper-100/55 ml-2">
                    与流年并行的另一条线，看内在的起心动念
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {chart.daYun[openDaYun].xiaoYun.map((x) => (
                    <div key={x.year} className="rounded border border-gold-300/10 px-2 py-1.5 text-center">
                      <div className="text-[13px] text-paper-100/65" style={SERIF}>{x.ganZhi}</div>
                      <div className="text-[10px] text-paper-100/55 tabular-nums">{x.age} 岁</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </section>
  );
}
