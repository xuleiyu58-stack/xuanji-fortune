"use client";

import type { BaziChart as Chart, WuXing } from "@/lib/bazi";

/**
 * 命盘。
 *
 * 八字的价值一半在盘、一半在解。盘是排出来的死数据，就该用表格和条形老老实实呈现；
 * 五行用色是传统的（木青火赤土黄金白水黑），这里做了去饱和处理以便落在墨色底上。
 */
export const ELEMENT_COLOR: Record<WuXing, string> = {
  木: "#7fb08e",
  火: "#c9745a",
  土: "#c2a061",
  金: "#c3c9d4",
  水: "#7aa0c0",
};

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

export default function BaziChart({ chart }: { chart: Chart }) {
  const nowYear = new Date().getFullYear();

  return (
    <section className="mystic-card rounded-xl p-6 sm:p-8" aria-label="八字命盘">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-7">
        <h3 className="text-lg text-gold" style={SERIF}>
          命盘
        </h3>
        <p className="text-paper-100/45 text-xs tracking-wider">
          {chart.solarDate} · 农历{chart.lunarDate} · 属{chart.zodiac}
        </p>
      </header>

      {/* 日主 —— 八字里的「我」，先于一切细节说清楚 */}
      <p className="text-sm text-paper-100/60 mb-7">
        日主
        <span className="mx-1.5 text-xl align-baseline" style={{ ...SERIF, color: ELEMENT_COLOR[chart.dayMasterElement] }}>
          {chart.dayMaster}
        </span>
        <span style={{ color: ELEMENT_COLOR[chart.dayMasterElement] }}>{chart.dayMasterElement}</span>
        <span className="mx-2 text-paper-100/25">·</span>
        五行偏
        <span className="mx-1" style={{ color: ELEMENT_COLOR[chart.strongest] }}>
          {chart.strongest}
        </span>
        {chart.missing.length > 0 && (
          <>
            <span className="mx-2 text-paper-100/25">·</span>
            全局缺
            <span className="ml-1 text-paper-100/70">{chart.missing.join("、")}</span>
          </>
        )}
      </p>

      {/* 四柱 */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-8">
        {chart.pillars.map((p) => (
          <div
            key={p.label}
            className={`rounded-lg border px-2 py-4 text-center transition-colors ${
              p.isDayMaster
                ? "border-gold-500/45 bg-gold-500/[0.07]"
                : "border-gold-300/10 bg-mystic-800/40"
            }`}
          >
            <div className="text-[11px] tracking-[0.2em] text-paper-100/40 mb-4">{p.label}</div>
            <div
              className="text-3xl sm:text-4xl leading-none"
              style={{ ...SERIF, color: ELEMENT_COLOR[p.ganElement] }}
            >
              {p.gan}
            </div>
            <div
              className="text-3xl sm:text-4xl leading-none mt-3"
              style={{ ...SERIF, color: ELEMENT_COLOR[p.zhiElement] }}
            >
              {p.zhi}
            </div>
            <div className="text-[11px] text-paper-100/55 mt-4">{p.shiShen}</div>
            <div className="text-[10px] text-paper-100/30 mt-1.5">{p.naYin}</div>
          </div>
        ))}
      </div>

      {/* 五行 */}
      <div className="mb-8">
        <h4 className="text-xs tracking-[0.2em] text-paper-100/45 mb-4">五行分布</h4>
        <div className="space-y-2.5">
          {chart.elements.map((e) => (
            <div key={e.element} className="flex items-center gap-3">
              <span className="w-4 text-sm shrink-0" style={{ ...SERIF, color: ELEMENT_COLOR[e.element] }}>
                {e.element}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-paper-100/[0.07] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${e.percent}%`, background: ELEMENT_COLOR[e.element] }}
                />
              </div>
              <span className="w-10 text-right text-xs text-paper-100/45 tabular-nums shrink-0">
                {e.percent}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 大运 */}
      <div>
        <h4 className="text-xs tracking-[0.2em] text-paper-100/45 mb-4">
          大运 <span className="text-paper-100/30 tracking-normal ml-1">{chart.startAgeText}</span>
        </h4>
        <div className="-mx-1 px-1 flex gap-2 overflow-x-auto pb-2">
          {chart.daYun.map((step) => {
            const isCurrent = nowYear >= step.startYear && nowYear <= step.endYear;
            return (
              <div
                key={step.ganZhi}
                className={`shrink-0 rounded-lg border px-3 py-2.5 text-center min-w-[4.5rem] ${
                  isCurrent ? "border-gold-500/50 bg-gold-500/[0.08]" : "border-gold-300/10"
                }`}
              >
                <div
                  className={`text-base ${isCurrent ? "text-gold-300" : "text-paper-100/65"}`}
                  style={SERIF}
                >
                  {step.ganZhi}
                </div>
                <div className="text-[10px] text-paper-100/35 mt-1 tabular-nums">{step.startAge} 岁</div>
                <div className="text-[10px] text-paper-100/25 tabular-nums">{step.startYear}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
