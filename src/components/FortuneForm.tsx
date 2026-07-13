"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface Field {
  name: string;
  label: string;
  type: "text" | "date" | "time" | "select" | "textarea";
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

interface Props {
  mode: string;
  title: string;
  icon: string;
  description: string;
  fields: Field[];
  price: string;
}

export default function FortuneForm({ mode, title, icon, description, fields, price }: Props) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPaid, setHasPaid] = useState(false);

  const handleChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!hasPaid && mode !== "daily") {
      const confirmed = window.confirm(
        `玄机命理解读\n\n${title}\n价格：¥${price}\n\n确认支付？（演示模式直接确认即可）`
      );
      if (!confirmed) return;
      setHasPaid(true);
    }

    setLoading(true);
    try {
      const res = await fetch("/api/fortune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...formData }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.content);
      } else {
        setError(data.error || "测算失败");
      }
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <span className="text-5xl block mb-4">{icon}</span>
        <h1
          className="text-3xl md:text-4xl text-gold mb-3"
          style={{ fontFamily: "'Noto Serif SC', serif" }}
        >
          {title}
        </h1>
        <p className="text-paper-100/50 text-sm leading-relaxed max-w-md mx-auto">
          {description}
        </p>
        {mode !== "daily" && (
          <div className="price-tag mt-4 justify-center">
            <span className="symbol">¥</span>
            <span className="amount">{price}</span>
            <span className="text-xs text-paper-100/40">/次</span>
          </div>
        )}
        {mode === "daily" && (
          <span className="inline-block mt-4 text-xs text-jade-400 border border-jade-500/30 rounded px-3 py-1">
            每日免费体验
          </span>
        )}
      </motion.div>

      {!result && (
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onSubmit={handleSubmit}
          className="mystic-card rounded-lg p-8 space-y-6"
        >
          {fields.map((field) => (
            <div key={field.name}>
              <label className="block text-paper-100/60 text-sm mb-2 tracking-wider">
                {field.label}
                {field.required && <span className="text-vermillion-400 ml-1">*</span>}
              </label>
              {field.type === "select" ? (
                <select
                  value={formData[field.name] || ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  required={field.required}
                  className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 focus:border-gold-300/50 focus:outline-none transition-colors"
                >
                  <option value="">请选择</option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  value={formData[field.name] || ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 placeholder:text-paper-100/20 focus:border-gold-300/50 focus:outline-none transition-colors resize-none"
                />
              ) : (
                <input
                  type={field.type}
                  value={formData[field.name] || ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 placeholder:text-paper-100/20 focus:border-gold-300/50 focus:outline-none transition-colors"
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={loading}
            className={mode === "daily" ? "btn-primary w-full" : "btn-vermillion w-full"}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <span className="mystic-loader !w-5 !h-5" />
                天机推演中...
              </span>
            ) : mode === "daily" ? (
              "免费获取今日运势"
            ) : (
              `¥${price} 立即测算`
            )}
          </button>
        </motion.form>
      )}

      {loading && (
        <div className="mystic-card rounded-lg p-12 text-center">
          <div className="mystic-loader mx-auto mb-6" />
          <p
            className="text-gold-300 text-lg"
            style={{ fontFamily: "'Noto Serif SC', serif" }}
          >
            天机推演中...
          </p>
          <p className="text-paper-100/30 text-sm mt-2">AI 正在为您排盘解读，请稍候</p>
        </div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mystic-card rounded-lg p-8 text-center border-vermillion-400/30"
        >
          <p className="text-vermillion-400 mb-4">{error}</p>
          <button onClick={() => { setError(null); setResult(null); }} className="btn-mystic">
            重新测算
          </button>
        </motion.div>
      )}

      {result && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-6"
        >
          <div className="mystic-card rounded-lg p-8 border-gold-glow">
            <div
              className="fortune-text text-paper-100/80 text-sm leading-loose whitespace-pre-wrap"
              dangerouslySetInnerHTML={{
                __html: result
                  ?.replace(/\*\*(.*?)\*\*/g, '<strong class="text-gold-300">$1</strong>')
                  .replace(/【(.*?)】/g, '<strong class="text-gold-300 block mt-4 mb-2 text-base">【$1】</strong>')
                  .replace(/\n\n/g, "<br/><br/>")
                  .replace(/\n/g, "<br/>") || "",
              }}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { setResult(null); setFormData({}); setHasPaid(false); }} className="btn-mystic">
              重新测算
            </button>
            <button
              onClick={() => {
                const text = result || "";
                navigator.clipboard.writeText(text);
                alert("已复制到剪贴板，分享给好友吧！");
              }}
              className="btn-primary"
            >
              复制结果 · 分享好友
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
