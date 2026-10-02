"use client";

import { useState } from "react";
import { inlineHtml } from "@/lib/sanitize";

/**
 * 追问。
 *
 * 三处刻意的设计：
 *   1. **消耗的是同一个每日额度** —— 追问是真实的一次 AI 调用，界面必须讲明，
 *      否则用户会以为它是免费的加餐，问到一半被拦下才觉得被骗；
 *   2. 只带**首轮解读的节选**当上下文（服务端还会再截断一次）。全文喂回去既贵，
 *      也会让模型倾向于复述而不是回答；
 *   3. 盘由服务端重排，这里只把出生信息原样带回 —— 不把盘在前端绕一圈。
 */

const SERIF = { fontFamily: "'Noto Serif SC', serif" } as const;

export interface FollowUpProps {
  /** 出生信息（就是表单里的那份），服务端据此重排盘 */
  birth: Record<string, string>;
  /** 首轮解读原文，作为上下文节选传回去 */
  previous: string;
}

interface QA {
  q: string;
  a?: string;
  error?: string;
}

export default function FollowUp({ birth, previous }: FollowUpProps) {
  const [question, setQuestion] = useState("");
  const [items, setItems] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;

    setQuestion("");
    setBusy(true);
    setItems((prev) => [...prev, { q }]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...birth, ask: q, previous }),
      });
      const data = await res.json();
      setItems((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (data.success) last.a = String(data.content ?? "");
        else last.error = String(data.error || "回答失败，请稍后再试");
        return next;
      });
    } catch {
      setItems((prev) => {
        const next = [...prev];
        next[next.length - 1].error = "网络连接失败，请稍后重试";
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gold-300/12 bg-mystic-800/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h4 className="text-base text-gold-400/85" style={SERIF}>
          还想再问
        </h4>
        <span className="text-paper-100/35 text-xs">每次追问计入当日的免费次数</span>
      </div>
      <p className="text-paper-100/40 text-xs leading-relaxed mb-4">
        针对这份盘继续问。回答会带上盘面依据，方便你对着盘核验。
      </p>

      {items.length > 0 && (
        <div className="space-y-4 mb-5">
          {items.map((item, i) => (
            <div key={`${item.q}-${i}`} className="space-y-2">
              <p className="text-paper-100/70 text-sm">
                <span className="text-gold-400/60 mr-2">问</span>
                {item.q}
              </p>
              {item.a !== undefined && (
                <div
                  className="text-paper-100/70 text-sm leading-loose rounded border border-gold-300/10 bg-mystic-900/40 px-3 py-2.5"
                  dangerouslySetInnerHTML={{ __html: inlineHtml(item.a) }}
                />
              )}
              {item.error && (
                <p className="text-vermillion-400 text-xs">{item.error}</p>
              )}
              {item.a === undefined && !item.error && (
                <p className="text-paper-100/35 text-xs">正在推演…</p>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          placeholder="例如：我这十年该往哪个方向使劲？"
          className="flex-1 bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 placeholder:text-paper-100/25 focus:border-gold-300/50 focus:outline-none transition-colors text-sm"
        />
        <button
          type="submit"
          disabled={busy || question.trim().length < 2}
          className="btn-mystic !py-3 disabled:opacity-40 shrink-0"
        >
          {busy ? "推演中…" : "问"}
        </button>
      </form>
    </div>
  );
}
