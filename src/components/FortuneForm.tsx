"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import PaymentModal from "./PaymentModal";
import QuotaBanner from "./QuotaBanner";
import { consumeFreeQuota, isMember, saveReading, getFreeQuota } from "@/lib/store";

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
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [hasPaid, setHasPaid] = useState(false);
  const [member, setMember] = useState(false);
  const [quota, setQuota] = useState(3);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setMember(isMember()); setQuota(getFreeQuota()); }, []);

  const handleChange = (name: string, value: string) => { setFormData((prev) => ({ ...prev, [name]: value })); };

  const callFortuneAPI = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fortune", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, ...formData }) });
      const data = await res.json();
      if (data.success) {
        setResult(data.content);
        saveReading({ mode, title, icon, result: data.content, input: formData });
        setMember(isMember());
        setQuota(getFreeQuota());
      } else { setError(data.error || "测算失败"); }
    } catch { setError("网络连接失败，请稍后重试"); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "daily") { if (!consumeFreeQuota()) { setPaymentOpen(true); return; } await callFortuneAPI(); return; }
    if (member) { await callFortuneAPI(); return; }
    if (!hasPaid) { setPaymentOpen(true); return; }
    await callFortuneAPI();
  };

  const handlePaymentConfirm = async () => { setHasPaid(true); setPaymentOpen(false); setMember(isMember()); await callFortuneAPI(); };

  const handleCopyResult = () => {
    const text = result || "";
    const shareText = `🔮 我在「玄机」算了一卦，太准了！\n\n${text.slice(0, 200)}...\n\n👉 ${window.location.origin}?ref=${window.localStorage.getItem("xuanji_ref_code") || ""}\n\n免费体验 AI 算命，知己命，掌人生！`;
    navigator.clipboard.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="max-w-3xl mx-auto">
      {mode === "daily" && !result && <div className="mb-6"><QuotaBanner /></div>}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <span className="text-5xl block mb-4">{icon}</span>
        <h1 className="text-3xl md:text-4xl text-gold mb-3" style={{ fontFamily: "'Noto Serif SC', serif" }}>{title}</h1>
        <p className="text-paper-100/50 text-sm leading-relaxed max-w-md mx-auto">{description}</p>
        {mode !== "daily" && (<div className="price-tag mt-4 justify-center"><span className="symbol">¥</span><span className="amount">{price}</span><span className="text-xs text-paper-100/40">/次</span>{member && <span className="text-xs text-gold-400 bg-gold-400/10 rounded px-2 py-0.5 ml-2">会员免费</span>}</div>)}
        {mode === "daily" && <span className="inline-block mt-4 text-xs text-jade-400 border border-jade-500/30 rounded px-3 py-1">每日3次免费体验</span>}
      </motion.div>
      <PaymentModal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={mode === "daily" ? "今日免费次数已用完" : title} price={mode === "daily" ? "28.8" : price} onConfirm={handlePaymentConfirm} />
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
          <button type="submit" disabled={loading} className={mode === "daily" && quota > 0 ? "btn-primary w-full" : mode === "daily" ? "btn-vermillion w-full" : "btn-vermillion w-full"}>
            {loading ? (<span className="flex items-center justify-center gap-3"><span className="mystic-loader !w-5 !h-5" />天机推演中...</span>) : mode === "daily" && quota > 0 ? `免费获取今日运势（剩余 ${quota} 次）` : mode === "daily" ? `¥28.8 开通会员无限次` : member ? "会员免费测算" : `¥${price} 立即测算`}
          </button>
          {mode !== "daily" && !member && (<p className="text-center text-paper-100/20 text-xs">开通会员 ¥28.8/月，全模式无限次使用 · <button type="button" onClick={() => setPaymentOpen(true)} className="text-gold-400/60 hover:text-gold-300 underline transition-colors">立即开通</button></p>)}
        </motion.form>
      )}
      {loading && (<div className="mystic-card rounded-lg p-12 text-center"><div className="mystic-loader mx-auto mb-6" /><p className="text-gold-300 text-lg" style={{ fontFamily: "'Noto Serif SC', serif" }}>天机推演中...</p><p className="text-paper-100/30 text-sm mt-2">AI 正在为您排盘解读，请稍候</p></div>)}
      {error && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mystic-card rounded-lg p-8 text-center border-vermillion-400/30"><p className="text-vermillion-400 mb-4">{error}</p><button onClick={() => { setError(null); setResult(null); }} className="btn-mystic">重新测算</button></motion.div>)}
      {result && !loading && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="space-y-6">
          <div className="mystic-card rounded-lg p-8 border-gold-glow"><div className="fortune-text text-paper-100/80 text-sm leading-loose whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: result?.replace(/\*\*(.*?)\*\*/g, '<strong class="text-gold-300">$1</strong>').replace(/【(.*?)】/g, '<strong class="text-gold-300 block mt-4 mb-2 text-base">【$1】</strong>').replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>") || "" }} /></div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => { setResult(null); setFormData({}); setHasPaid(false); setQuota(getFreeQuota()); }} className="btn-mystic">重新测算</button>
            <button onClick={handleCopyResult} className={`btn-primary ${copied ? "!bg-jade-500" : ""}`}>{copied ? "✓ 已复制分享文案" : "复制结果 · 分享好友"}</button>
          </div>
          <p className="text-center text-paper-100/20 text-xs">分享给 3 位好友，赠送 1 天会员体验</p>
        </motion.div>
      )}
    </div>
  );
}
