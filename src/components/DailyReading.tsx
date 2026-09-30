"use client";

import { motion } from "framer-motion";
import { movingLineIndex, type DailyReading as Reading } from "@/lib/daily";

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

/** 五行正色，与命盘用的是同一套；用于把"幸运颜色"落成看得见的色块。 */
const COLOR_MAP: Record<string, string> = {
  青: "#7fb08e", 碧: "#7fb08e", 绿: "#6f9d7d", 翠: "#6f9d7d",
  赤: "#c9745a", 红: "#c9745a", 朱: "#c9745a", 丹: "#c9745a",
  黄: "#c2a061", 金: "#d4a84b", 橙: "#c98a4b",
  白: "#dcdcdc", 银: "#c3c9d4", 灰: "#8a8a95",
  黑: "#4a4a58", 玄: "#4a4a58", 墨: "#4a4a58",
  紫: "#9b7bb5", 蓝: "#6a86a0", 靛: "#5a6f96",
};

function colorOf(name?: string): string | null {
  if (!name) return null;
  for (const ch of name) {
    if (COLOR_MAP[ch]) return COLOR_MAP[ch];
  }
  return null;
}

const DIRECTIONS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

function Compass({ direction }: { direction?: string }) {
  const idx = direction ? DIRECTIONS.indexOf(direction.replace(/[偏方]/g, "")) : -1;
  const angle = idx >= 0 ? idx * 45 : 0;

  return (
    <div className="relative">
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="23" fill="none" stroke="rgba(212,168,75,.22)" strokeWidth="1" />
        {DIRECTIONS.map((_, i) => {
          const rad = ((i * 45 - 90) * Math.PI) / 180;
          const active = i === idx;
          const r1 = active ? 15 : 19;
          return (
            <line
              key={i}
              x1={26 + Math.cos(rad) * r1}
              y1={26 + Math.sin(rad) * r1}
              x2={26 + Math.cos(rad) * 22}
              y2={26 + Math.sin(rad) * 22}
              stroke={active ? "#e8cf8d" : "rgba(245,240,232,.22)"}
              strokeWidth={active ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {idx >= 0 && (
          <g transform={`rotate(${angle} 26 26)`}>
            <path d="M26 9l3.4 14.5h-6.8z" fill="#e8cf8d" />
            <path d="M26 43l-3.4-14.5h6.8z" fill="rgba(232,207,141,.28)" />
          </g>
        )}
        <circle cx="26" cy="26" r="2.6" fill="#0a0a12" stroke="rgba(232,207,141,.6)" strokeWidth="1" />
      </svg>
    </div>
  );
}

export default function DailyReading({ reading }: { reading: Reading }) {
  const { hexagram, good, bad, lucky } = reading;
  const movingIdx = movingLineIndex(hexagram);
  const swatch = colorOf(lucky.color);

  return (
    <section className="mystic-card rounded-xl p-6 sm:p-8" aria-label="今日卦象">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-7">
        <h3 className="text-lg text-gold" style={SERIF}>
          今日卦象
        </h3>
        <p className="text-paper-100/45 text-xs tracking-wider">
          {hexagram.ganzhi}日 · 农历{hexagram.lunarDate}
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-8 sm:gap-10">
        {/* 六爻，上→下 */}
        <div className="flex gap-6 items-start justify-center sm:justify-start">
          <div className="flex flex-col gap-2.5 pt-1" aria-hidden="true">
            {hexagram.lines.map((yang, i) => {
              const on = i === movingIdx;
              const cls = on ? "bg-gold-400" : "bg-gold-300/55";
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scaleX: 0.5 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 + i * 0.07 }}
                  className="flex gap-2 h-2 w-24"
                >
                  {yang ? (
                    <span className={`flex-1 rounded-sm ${cls}`} />
                  ) : (
                    <>
                      <span className={`flex-1 rounded-sm ${cls}`} />
                      <span className={`flex-1 rounded-sm ${cls}`} />
                    </>
                  )}
                </motion.div>
              );
            })}
          </div>

          <div className="sm:pt-1">
            <p className="text-2xl text-gold mb-3" style={SERIF}>
              {hexagram.name}
            </p>
            <p className="text-xs text-paper-100/50 leading-relaxed">
              上{hexagram.upper.name}（{hexagram.upper.image}）
              <br />
              下{hexagram.lower.name}（{hexagram.lower.image}）
            </p>
            <p className="text-[11px] text-gold-400/70 mt-3">动爻 · 第 {hexagram.movingLine} 爻</p>
          </div>
        </div>

        {/* 宜 / 忌 对照 */}
        <div className="grid grid-cols-2 gap-4 sm:gap-6">
          <div>
            <h4 className="text-xs tracking-[0.25em] text-jade-400 mb-3.5">宜</h4>
            <ul className="space-y-2.5">
              {good.map((item) => (
                <li key={item} className="text-sm text-paper-100/70 leading-snug flex items-start gap-2">
                  <span className="mt-2 h-1 w-1 rounded-full bg-jade-400/70 shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs tracking-[0.25em] text-vermillion-300/80 mb-3.5">忌</h4>
            <ul className="space-y-2.5">
              {bad.map((item) => (
                <li key={item} className="text-sm text-paper-100/55 leading-snug flex items-start gap-2">
                  <span className="mt-2 h-1 w-1 rounded-full bg-vermillion-400/60 shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 幸运指南 */}
      {(lucky.color || lucky.number || lucky.direction) && (
        <div className="mt-8 pt-6 border-t border-gold-300/10 flex flex-wrap items-center gap-x-10 gap-y-5">
          {lucky.color && (
            <div className="flex items-center gap-3">
              <span className="text-xs tracking-[0.2em] text-paper-100/45">幸运色</span>
              {swatch && (
                <span
                  className="h-5 w-5 rounded-full border border-paper-100/15 shrink-0"
                  style={{ background: swatch }}
                  aria-hidden="true"
                />
              )}
              <span className="text-sm text-paper-100/75">{lucky.color}</span>
            </div>
          )}

          {lucky.number && (
            <div className="flex items-center gap-3">
              <span className="text-xs tracking-[0.2em] text-paper-100/45">幸运数字</span>
              <span className="glyph-seal" style={{ width: 28, height: 28, fontSize: 13 }}>
                {lucky.number}
              </span>
            </div>
          )}

          {lucky.direction && (
            <div className="flex items-center gap-3">
              <span className="text-xs tracking-[0.2em] text-paper-100/45">幸运方位</span>
              <Compass direction={lucky.direction} />
              <span className="text-sm text-paper-100/75">{lucky.direction}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
