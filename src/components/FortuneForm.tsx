"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import PaymentModal from "./PaymentModal";
import { isMember, saveReading } from "@/lib/store";
import { MODES, MEMBER_PLANS, formatPrice, type Mode } from "@/lib/pricing";
import Glyph, { CHART_TRIGRAM } from "./Glyph";
import BaziChart from "./BaziChart";
import { renderFortuneHtml } from "@/lib/sanitize";
// 只取类型：lunar-typescript 必须留在服务端，不能被打进浏览器包
import type { BaziChart as BaziChartData } from "@/lib/bazi";

interface Field {
  name: string;
  label: string;
  type: "text" | "date" | "time" | "select" | "textarea";
  placeholder?: string;
  required?: boolean;
  options?: readonly { value: string; label: string }[];
}

interface Props {
  mode: string;
  title: string;
  description: string;
  fields: Field[];
}

export default function FortuneForm({ mode, title, description, fields }: Props) {
  const modeInfo = MODES[mode as Mode];
  const price = formatPrice(modeInfo.price);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [member, setMember] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setMember(isMember()); }, []);

  const handleChange = (name: string, value: string) => { setFormData((prev) => ({ ...prev, [name]: value })); };

  const callFortuneAPI = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fortune", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, ...formData }) });
      const data = await res.json();
      // 盘随响应回来 —— 即便解读失败，盘也该照常呈现（排盘不依赖模型）
      if (data.chart) setChart(data.chart);
      if (data.success) {
        setResult(data.content);
        // 不存图标 —— 记录里的卦象由 mode 直接推出，冗余存储只会两处漂移
        saveReading({ mode, title, result: data.content, input: formData });
        setMember(isMember());
      } else { setError(data.error || "测算失败"); }
    } catch { setError("网络连接失败，请稍后重试"); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (member) { await callFortuneAPI(); return; }
    if (!hasPaid) { setPaymentOpen(true); return; }
    await callFortuneAPI();
  };

  const handlePaymentConfirm = async () => { setHasPaid(true); setPaymentOpen(false); setMember(isMember()); await callFortuneAPI(); };

  const handleCopyResult = () => {
    const text = result || "";
    const shareText = `🔮 我在「玄机」排了八字，太准了！\n\n${text.slice(0, 200)}...\n\n👉 ${window.location.origin}\n\nAI 排盘解读，知己命，掌人生！`;
    navigator.clipboard.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <div className="flex justify-center mb-5 text-gold-400/80"><Glyph trigram={CHART_TRIGRAM} size={54} /></div>
        <h1 className="text-3xl md:text-4xl text-gold mb-3" style={{ fontFamily: "'Noto Serif SC', serif" }}>{title}</h1>
        <p className="text-paper-100/50 text-sm leading-relaxed max-w-md mx-auto">{description}</p>
        <div className="price-tag mt-4 justify-center"><span className="symbol">¥</span><span className="amount">{price}</span><span className="text-xs text-paper-100/40">/次</span>{member && <span className="text-xs text-gold-400 bg-gold-400/10 rounded px-2 py-0.5 ml-2">会员免费</span>}</div>
      </motion.div>
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={title} price={formatPrice(MEMBER_PLANS[0].price)} onConfirm={handlePaymentConfirm} />
      {!result && (
        <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} onSubmit={handleSubmit} className="mystic-card rounded-lg p-8 space-y-6">
          {fields.map((field) => (
            <div key={field.name}>
              <label className="block text-paper-100/60 text-sm mb-2 tracking-wider">{field.label}{field.required && <span className="text-vermillion-400 ml-1">*</span>}</label>
              {field.type === "select" ? (
                <select value={formData[field.name] || ""} onChange={(e) => handleChange(field.name, e.target.value)} required={field.required} className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 focus:border-gold-300/50 focus:outline-none transition-colors"><option value="">请选择</option>{field.options?.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}</select>
              ) : field.type === "textarea" ? (
                <textarea value={formData[field.name] || ""} onChange={(e) => handleChange(field.name, e.target.value)} placeholder={field.placeholder} rows={3} className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 placeholder:text-paper-100/20 focus:border-gold-300/50 focus:outline-none transition-colors resize-none" />
              ) : (
                <input type={field.type} value={formData[field.name] || ""} onChange={(e) => handleChange(field.name, e.target.value)} placeholder={field.placeholder} required={field.required} className="w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 placeholder:text-paper-100/20 focus:border-gold-300/50 focus:outline-none transition-colors" />
              )}
            </div>
          ))}
          {/* 主操作恒为金色。红色留给真正的负向状态，不做"催你下一步"的颜色 */}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? (<span className="flex items-center justify-center gap-3"><span className="mystic-loader !w-5 !h-5" />天机推演中...</span>) : member ? "会员免费测算" : `¥${price} 立即排盘解读`}
          </button>
          {!member && (<p className="text-center text-paper-100/45 text-xs">开通会员 ¥{formatPrice(MEMBER_PLANS[0].price)}/月，无限次排盘解读 ·<button type="button" onClick={() => setPaymentOpen(true)} className="text-gold-400/60 hover:text-gold-300 underline transition-colors">立即开通</button></p>)}
        </motion.form>
      )}
      {loading && (<div className="mystic-card rounded-lg p-12 text-center"><div className="mystic-loader mx-auto mb-6" /><p className="text-gold-300 text-lg" style={{ fontFamily: "'Noto Serif SC', serif" }}>天机推演中...</p><p className="text-paper-100/30 text-sm mt-2">AI 正在为您排盘解读，请稍候</p></div>)}
      {result && !loading && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="space-y-6">
          {/* 先给盘，再给解。盘是排出来的，看得到；解是推出来的，读得懂。 */}
          {chart && <BaziChart chart={chart} />}
          <div className="mystic-card rounded-lg p-8 border-gold-glow">
            <h3 className="text-lg text-gold mb-5" style={{ fontFamily: "'Noto Serif SC', serif" }}>大师解读</h3>
            <div className="fortune-text text-paper-100/80 text-sm leading-loose whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderFortuneHtml(result) }} />
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { setResult(null); setChart(null); setFormData({}); setHasPaid(false); }} className="btn-mystic">重新测算</button>
            <button onClick={handleCopyResult} className={`btn-primary ${copied ? "!bg-jade-500" : ""}`}>{copied ? "✓ 已复制分享文案" : "复制结果 · 分享好友"}</button>
          </div>
        </motion.div>
      )}
      {/* 解读失败但盘排好了：把盘给出去，比什么都不给强 */}
      {error && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 mt-6">
          <div className="mystic-card rounded-lg p-8 text-center border-vermillion-400/30">
            <p className="text-vermillion-400 mb-4">{error}</p>
            <button onClick={() => { setError(null); setResult(null); }} className="btn-mystic">重新测算</button>
          </div>
          {chart && <BaziChart chart={chart} />}
        </motion.div>
      )}
    </div>
  );
}
