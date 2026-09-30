"use client";

import { motion } from "framer-motion";
import type { BaziChart as Chart } from "@/lib/bazi";
import type { LoveMatch as Match } from "@/lib/love";
import { ELEMENT_COLOR } from "./BaziChart";

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

/** 分数只是分档的入口，不让它看起来像精确测量。 */
const BAND_TONE: Record<string, string> = {
  上等: "#7fb08e",
  中上: "#c2a061",
  中等: "#c3c9d4",
  需经营: "#c9745a",
};

function MiniChart({ chart, side }: { chart: Chart; side: string }) {
  return (
    <div className="rounded-lg border border-gold-300/12 bg-mystic-800/40 p-4">
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-xs tracking-[0.2em] text-paper-100/45">{side}</span>
        <span className="text-xs text-paper-100/55">
          属{chart.zodiac} · 日主{chart.dayMaster}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {chart.pillars.map((p) => (
          <div key={p.label} className="text-center">
            <div className="text-[10px] text-paper-100/30 mb-1.5">{p.label.replace("柱", "")}</div>
            <div className="text-lg leading-none" style={{ ...SERIF, color: ELEMENT_COLOR[p.ganElement] }}>
              {p.gan}
            </div>
            <div className="text-lg leading-none mt-1" style={{ ...SERIF, color: ELEMENT_COLOR[p.zhiElement] }}>
              {p.zhi}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-4">
        {chart.elements.map((e) => (
          <div key={e.element} className="flex-1">
            <div className="h-0.5 rounded-full" style={{ background: ELEMENT_COLOR[e.element], opacity: e.percent === 0 ? 0.15 : 0.75 }} />
            <div className="text-[9px] text-paper-100/30 mt-1.5 text-center">{e.element}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LoveMatch({ chartA, chartB, match }: { chartA: Chart; chartB: Chart; match: Match }) {
  const tone = BAND_TONE[match.band] ?? "#c3c9d4";

  return (
    <section className="mystic-card rounded-xl p-6 sm:p-8" aria-label="合婚">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-8">
        <h3 className="text-lg text-gold" style={SERIF}>
          合婚
        </h3>
        <p className="text-paper-100/45 text-xs tracking-wider">两人命盘并列，据此论缘</p>
      </header>

      {/* 匹配度 */}
      <div className="text-center mb-9">
        <p className="text-xs tracking-[0.3em] text-paper-100/40 mb-3">匹配度</p>
        <motion.p
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-6xl leading-none tabular-nums"
          style={{ ...SERIF, color: tone }}
        >
          {match.score}
        </motion.p>
        <p className="text-sm mt-3" style={{ color: tone }}>
          {match.band}
        </p>
      </div>

      {/* 两张盘 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-9">
        <MiniChart chart={chartA} side="你" />
        <MiniChart chart={chartB} side="TA" />
      </div>

      {/* 评定依据 —— 分数怎么来的，逐条列清楚 */}
      <div>
        <h4 className="text-xs tracking-[0.2em] text-paper-100/45 mb-4">评定依据</h4>
        <div className="space-y-2.5">
          {match.factors.map((f) => (
            <div key={f.name} className="flex items-center gap-3 sm:gap-4 text-sm">
              <span className="w-16 shrink-0 text-paper-100/55">{f.name}</span>
              <span className="shrink-0 text-gold-300">{f.verdict}</span>
              <span
                className="shrink-0 tabular-nums text-xs w-10 text-right"
                style={{ color: f.delta >= 0 ? "#7fb08e" : "#c9745a" }}
              >
                {f.delta >= 0 ? "+" : ""}
                {f.delta}
              </span>
              <span className="text-paper-100/50 text-xs leading-relaxed min-w-0">{f.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-7 text-[11px] text-paper-100/30 leading-relaxed">
        匹配度由生肖、日主、五行互补三项加权得出，加减分已逐条列出，不含未公开的因子。
        命理之说，信则有不信则无，仅供参考娱乐。
      </p>
    </section>
  );
}
