"use client";

import { motion } from "framer-motion";
import type { OracleReading, OracleGrade } from "@/lib/oracle";

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

/** 签等配色：上签偏青金，平签取中性，下签才动朱色 —— 不让"下下签"看着像报错。 */
const GRADE_TONE: Record<OracleGrade, { text: string; border: string; bg: string }> = {
  上上: { text: "#e8cf8d", border: "rgba(232,207,141,.55)", bg: "rgba(201,150,58,.12)" },
  上吉: { text: "#e8cf8d", border: "rgba(232,207,141,.45)", bg: "rgba(201,150,58,.09)" },
  中吉: { text: "#d4a84b", border: "rgba(212,168,75,.38)", bg: "rgba(201,150,58,.06)" },
  中平: { text: "#c3c9d4", border: "rgba(195,201,212,.28)", bg: "rgba(195,201,212,.05)" },
  中下: { text: "#c9945a", border: "rgba(201,148,90,.32)", bg: "rgba(201,148,90,.06)" },
  下下: { text: "#c9745a", border: "rgba(201,116,90,.36)", bg: "rgba(201,116,90,.07)" },
};

function Section({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <h4 className="text-xs tracking-[0.25em] text-gold/70 mb-2">{label}</h4>
      <p className="text-sm text-paper-100/70 leading-loose">{text}</p>
    </div>
  );
}

export default function OracleSlip({ reading }: { reading: OracleReading }) {
  const { draw, verse, allusion, explanation, message } = reading;
  const tone = GRADE_TONE[draw.grade];

  return (
    <section className="mystic-card rounded-xl p-6 sm:p-8" aria-label="灵签">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-8">
        <h3 className="text-lg text-gold" style={SERIF}>
          灵签
        </h3>
        <p className="text-paper-100/45 text-xs tracking-wider">所问之事，以此签为答</p>
      </header>

      <div className="flex flex-col sm:flex-row items-center sm:items-start justify-center gap-8 sm:gap-12">
        {/* 签条：竖排的签等与签号 */}
        <motion.div
          initial={{ y: -18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="shrink-0 rounded-md px-5 py-7 flex items-center"
          style={{ writingMode: "vertical-rl", border: `1px solid ${tone.border}`, background: tone.bg }}
        >
          <span className="text-3xl leading-none" style={{ ...SERIF, color: tone.text }}>
            {draw.grade}签
          </span>
          <span className="text-xs text-paper-100/45 ml-4">第 {draw.number} 签 · {draw.note}</span>
        </motion.div>

        {/* 签文：竖排，自右向左 */}
        <div className="flex flex-row-reverse justify-center gap-3 sm:gap-5">
          {verse.map((line, i) => (
            <motion.p
              key={i}
              initial={{ y: -14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.2 + i * 0.1 }}
              className="text-lg sm:text-xl text-paper-100/85 tracking-[0.32em]"
              style={{ ...SERIF, writingMode: "vertical-rl" }}
            >
              {line}
            </motion.p>
          ))}
        </div>
      </div>

      <div className="mt-9 pt-7 border-t border-gold-300/10 space-y-6">
        <Section label="典故" text={allusion} />
        <Section label="解曰" text={explanation} />
        <Section label="大师开示" text={message} />
      </div>

      <p className="mt-7 text-[11px] text-paper-100/30 leading-relaxed">
        签文由 AI 依签等拟写，非出自某部传统签谱。命理之说，信则有不信则无，仅供参考娱乐。
      </p>
    </section>
  );
}
