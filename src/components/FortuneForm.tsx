"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import PaymentModal from "./PaymentModal";
import { saveReading, saveReadingToCloud } from "@/lib/store";
import { useViewingReading, clearViewingReading } from "@/lib/viewing";
import { useEntitlement, refreshEntitlement } from "@/lib/entitlements";
import { redeemActivationCode } from "@/lib/redeem-client";
import { MODES, formatPrice, type Mode } from "@/lib/pricing";
import Glyph, { CHART_TRIGRAM } from "./Glyph";
import BaziChart from "./BaziChart";
import BirthForm from "./BirthForm";
import ReadingPanel from "./ReadingPanel";
import ShareCard from "./ShareCard";
import FollowUp from "./FollowUp";
// 只取类型：lunar-typescript 必须留在服务端，不能被打进浏览器包
import type { BaziChart as BaziChartData } from "@/lib/bazi";

interface Props {
  mode: string;
  title: string;
  description: string;
}

export default function FortuneForm({ mode, title, description }: Props) {
  const modeInfo = MODES[mode as Mode];
  const price = formatPrice(modeInfo.price);
  // 历法默认阳历 —— 多数人记得的是身份证上的那个日期
  const [formData, setFormData] = useState<Record<string, string>>({
    calendar: "solar",
    lunarLeap: "false",
    /*
     * 给出生日期一个初值。
     *
     * 两个理由，第二个是硬性的：
     *   1. 农历那三个下拉本来就默认停在 1990 年正月初一，阳历这边空着，两套又不对称了；
     *   2. 阳历的年月日是**从 birthDate 反解**出来的（不另存 state）。birthDate 为空时，
     *      三个下拉会停在选项列表的首项（1901 年 1 月 1 日），而用户一改年份，
     *      写回去的值就不等于他看到的那个组合 —— 下拉会被 React 弹回原位，看着像"改不动"。
     *      给一个真实初值，年月日就始终是同一个整体，不存在"选到一半"的中间态。
     */
    birthDate: "1990-01-01",
  });
  const [result, setResult] = useState<string | null>(null);
  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /**
   * 非 null 表示"当前显示的是免费试读"。
   *
   * 只记待解锁的节数 —— 内容本身就在 `result` 里。分成两个 state 存同一份
   * 数据，迟早会出现一处更新另一处没更新的情况。
   */
  const [preview, setPreview] = useState<{ lockedSections: number } | null>(null);

  /**
   * 正在编辑的出生信息草稿。
   *
   * 与 `formData` 分开是为了「取消」：直接改 formData 的话，用户改了日期又反悔，
   * 已经显示出来的那份解读对应的输入就被污染了 —— 追问、分享、再算一次
   * 都会拿着错的生辰去走。分开存，取消就是把草稿丢掉，已提交的那份毫发无损。
   *
   * 用 `draft !== null` 本身当作"正在编辑"的开关，不再另设一个布尔量 ——
   * 两个变量表达同一个状态，迟早会出现"编辑框开着但草稿是空的"这种组合。
   */
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const editing = draft !== null;

  // 权益来自服务端，不再是 localStorage 里的一个布尔值
  const entitlement = useEntitlement();
  const member = entitlement.member;
  const hasPass = entitlement.passes.some((p) => p.mode === mode && p.remaining > 0);
  const unlocked = member || hasPass;

  // 正在回看的历史记录（从页头的历史抽屉点进来）。
  // 非 null 时这个组件不再是「填写表单」，而是「展示某一条旧记录」。
  const viewing = useViewingReading();

  const handleChange = (name: string, value: string) => { setFormData((prev) => ({ ...prev, [name]: value })); };

  /**
   * 回看时把命盘补上。
   *
   * 新记录里已经存了盘，直接显示；旧记录（盘字段还不存在时存的）没有，
   * 就找 /api/chart 重排一次 —— 那是纯计算，不花钱、不扣券。
   */
  useEffect(() => {
    if (!viewing) return;
    if (viewing.chart) {
      setChart(viewing.chart as BaziChartData);
      return;
    }
    let alive = true;
    setChart(null);
    void (async () => {
      try {
        const res = await fetch("/api/chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: viewing.mode, ...viewing.input }),
        });
        const data = await res.json().catch(() => null);
        if (alive && data?.chart) setChart(data.chart);
      } catch {
        // 补不到盘就只显示解读正文 —— 那已经够读了，不该因此报错
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewing]);

  const callFortuneAPI = async (input: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fortune", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, ...input }) });
      const data = await res.json().catch(() => null);
      // 盘随响应回来 —— 即便解读失败，盘也该照常呈现（排盘不依赖模型）
      if (data?.chart) setChart(data.chart);

      // 免费试读：没付钱，但拿到了第一节。这不是"失败"，
      // 也不该存进历史 —— 存了的话用户会以为自己拥有这份解读。
      if (data?.preview) {
        setResult(data.content);
        setPreview({ lockedSections: data.lockedSections ?? 0 });
        return;
      }

      if (data?.success) {
        setPreview(null);
        setResult(data.content);
        // 不存图标 —— 记录里的卦象由 mode 直接推出，冗余存储只会两处漂移
        const entry = { mode, title, result: data.content, input, chart: data.chart } as const;
        saveReading(entry);
        // 登录后再多存一份到账户（失败静默，不影响本地那份）
        saveReadingToCloud(entry);
        // 通知页头：多了一条没看过的记录，把红点亮起来。
        // storage 事件只在**跨标签页**时由浏览器自动触发，同页面内得自己派发。
        window.dispatchEvent(new Event("storage"));
        // 单次券被消耗后服务端会回写新凭证，本地缓存要跟着更新
        if (!member) void refreshEntitlement();
        return;
      }
      // 403 是「没激活」，不是「出错了」—— 直接把兑换入口递过去，
      // 而不是让用户看着一句错误自己去猜下一步该做什么
      if (res.status === 403) {
        setPaymentOpen(true);
        return;
      }
      setError(data?.error ?? "测算失败，请稍后重试");
    } catch { setError("网络连接失败，请稍后重试"); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 一律交给服务端判定 —— 前端这一层不再自己决定"要不要弹付款窗"。
    //
    // 改这一处是因为免费试读：此前 `if (unlocked)` 才调接口，否则直接弹窗，
    // 于是没付钱的用户**永远触发不到试读**。而"有没有额度"这件事只有服务端
    // 知道（设备、IP、全局三个维度），前端猜不准，也不该猜。
    await callFortuneAPI(formData);
  };

  /**
   * 结果页的「改生辰重测」。
   *
   * 提交的是草稿，不是 result 对应的那份输入 —— 用户改完按的就是"用新的这份算"。
   * 成功后再把草稿收起来；失败（例如被额度拒绝）时留着，用户改一改还能再试。
   */
  const submitDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setFormData(draft);
    await callFortuneAPI(draft);
  };

  /** 新的解读出来了就收起编辑面板。失败时留着 —— 草稿不能跟着错误一起丢掉。 */
  useEffect(() => {
    if (result) setDraft(null);
  }, [result]);

  const handleCopyResult = () => {
    const text = result || "";
    const shareText = `我在「玄机」排了八字，四柱由程序推算：\n\n${text.slice(0, 200)}...\n\n👉 ${window.location.origin}\n\nAI 排盘解读，知己命，掌人生！`;
    navigator.clipboard
      .writeText(shareText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      // 浏览器可能拒绝剪贴板权限（非 HTTPS、用户拒绝）。不接住就是一个
      // 静默的 unhandled rejection，按钮看起来毫无反应。
      .catch(() => setError("复制失败，请手动选中文本复制"));
  };

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <div className="flex justify-center mb-5 text-gold-400/80"><Glyph trigram={CHART_TRIGRAM} size={54} /></div>
        {/* h2 而不是 h1：首页的 h1 是「玄机」，这里抢一个 h1 会让文档出现两个主标题 */}
        <h2 className="text-3xl md:text-4xl text-gold mb-3" style={{ fontFamily: "'Noto Serif SC', serif" }}>{title}</h2>
        <p className="text-paper-100/60 text-sm leading-relaxed max-w-md mx-auto">{description}</p>
        <div className="price-tag mt-4 justify-center">
          <span className="symbol">¥</span>
          <span className="amount">{price}</span>
          <span className="text-xs text-paper-100/55">/次</span>
          {member && <span className="text-xs text-gold-400 bg-gold-400/10 rounded px-2 py-0.5 ml-2">会员免费</span>}
          {!member && hasPass && <span className="text-xs text-gold-400 bg-gold-400/10 rounded px-2 py-0.5 ml-2">已解锁 1 次</span>}
        </div>
      </motion.div>

      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={title}
        price={formatPrice(modeInfo.price)}
        onRedeem={redeemActivationCode}
        alreadyUnlocked={unlocked}
      />

      {/* 历史回看：展示某一条旧记录，而不是填写表单。
          这一支必须放在所有其它分支之前 —— 回看时用户既没提交，
          也没有 result 状态，落到下面任何一支都会显示错的东西。 */}
      {viewing && (
        <motion.div
          key={viewing.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="mystic-card rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-gold-300 text-sm" style={{ fontFamily: "'Noto Serif SC', serif" }}>
                正在回看历史记录
              </p>
              <p className="text-paper-100/55 text-xs mt-1">
                {new Date(viewing.createdAt).toLocaleString("zh-CN")}
                {viewing.input?.birthDate ? ` · ${viewing.input.birthDate}` : ""}
                {viewing.input?.birthTime ? ` ${viewing.input.birthTime}` : ""}
              </p>
            </div>
            <button onClick={clearViewingReading} className="btn-mystic !py-2 !px-5 !text-sm shrink-0">
              返回排盘
            </button>
          </div>

          {chart && <BaziChart chart={chart} />}
          <ReadingPanel content={viewing.result} />

          <p className="text-center text-paper-100/45 text-xs leading-relaxed">
            这是已保存的记录，重新查看不会消耗次数。
          </p>
        </motion.div>
      )}

      {!viewing && !result && (
        <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} onSubmit={handleSubmit} className="mystic-card rounded-lg p-8 space-y-6">
          <BirthForm
            formId="fortune-form"
            value={formData}
            onChange={handleChange}
            onSubmit={() => {}}
            loading={loading}
            unlocked={unlocked}
            member={member}
            onOpenPayment={() => setPaymentOpen(true)}
          />
          {/* 主操作恒为金色。红色留给真正的负向状态，不做"催你下一步"的颜色 */}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? (
              <span className="flex items-center justify-center gap-3"><span className="mystic-loader !w-5 !h-5" />天机推演中...</span>
            ) : unlocked ? (
              "开始解读"
            ) : (
              "免费试读"
            )}
          </button>
        </motion.form>
      )}
      {loading && (<div className="mystic-card rounded-lg p-12 text-center"><div className="mystic-loader mx-auto mb-6" /><p className="text-gold-300 text-lg" style={{ fontFamily: "'Noto Serif SC', serif" }}>天机推演中...</p><p className="text-paper-100/55 text-sm mt-2">AI 正在为您排盘解读，请稍候</p></div>)}
      {/* 改生辰重测：与首页同一个表单组件，所以字段、校验、提示全都一致。
          这一支要放在上面那支**之前** —— 两者条件互斥（draft 非 null 时上面那支
          已经不渲染了），但把编辑面板写在前面，读代码时"正在改输入"这个状态
          更靠近表单本身。 */}
      {!viewing && draft && !loading && (
        <motion.form
          key="edit-birth"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={submitDraft}
          className="mystic-card rounded-lg p-8 space-y-6"
        >
          <div>
            <p className="text-gold-300 text-sm mb-1" style={{ fontFamily: "'Noto Serif SC', serif" }}>
              修改出生信息
            </p>
            <p className="text-paper-100/55 text-xs leading-relaxed">
              改好后重新排盘，会得到一份新的解读。
            </p>
          </div>
          <BirthForm
            editing
            value={draft}
            onChange={(name, value) => setDraft((prev) => ({ ...(prev ?? {}), [name]: value }))}
            onSubmit={() => {}}
            loading={loading}
            unlocked={unlocked}
            member={member}
            onOpenPayment={() => setPaymentOpen(true)}
            onCancel={() => { setDraft(null); }}
          />
        </motion.form>
      )}

      {!viewing && result && !loading && !draft && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="space-y-6">
          {/* 先给盘，再给解。盘是排出来的，看得到；解是推出来的，读得懂。 */}
          {chart && <BaziChart chart={chart} />}

          {/* 改生辰重测。
              放在盘的正下方而不是页面底部 —— 用户盯着盘发现"时辰填错了"
              的那一刻就在这儿，让他在同一屏里改掉，而不必滚回页首。
              改的是草稿，取消就丢掉，已经显示出来的这份解读不受影响。 */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => { setDraft({ ...formData }); setResult(null); setError(null); }}
              className="text-gold-400/70 hover:text-gold-300 text-sm underline transition-colors"
            >
              改生辰重测
            </button>
          </div>

          {/* 解读分节呈现：每节带「结论 / 依据 / 展开」，依据必须显示出盘面出处 */}
          <ReadingPanel content={result} locked={preview?.lockedSections ?? 0} />

          {/* 试读之后的转化位。
              放在解读正下方而不是页面底部 —— 用户刚读完第一节、
              正想知道"后面还有什么"的那一刻，是唯一该出现价格的位置。 */}
          {preview && (
            <div className="mystic-card rounded-lg p-6 text-center border-gold-glow">
              <p className="text-paper-100/75 text-sm leading-relaxed mb-1">
                以上是命局总评。日主强弱、性格禀赋、事业财运、感情婚姻、大运走势
                等 {preview.lockedSections} 节，需要激活后查看。
              </p>
              <p className="text-paper-100/50 text-xs mb-5">
                已有激活码？直接兑换即可，不必重新排盘。
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={() => setPaymentOpen(true)} className="btn-primary">
                  ¥{price} 解锁完整解读
                </button>
                <button
                  onClick={() => { setResult(null); setPreview(null); setChart(null); setError(null); }}
                  className="btn-mystic"
                >
                  换个八字
                </button>
              </div>
            </div>
          )}

          {/* 追问与分享只在完整解读时出现 ——
              试读状态下追问要花券，分享出去的是一份残文，都不合适 */}
          {!preview && (
            <>
              {/* 追问走的是同一道服务端闸门，所以放在解读之后 —— 先读完再决定要不要花 */}
              <FollowUp birth={formData} previous={result} unlocked={unlocked} onNeedUnlock={() => setPaymentOpen(true)} />
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button onClick={() => { setResult(null); setChart(null); setFormData({}); setError(null); }} className="btn-mystic">重新测算</button>
                {chart && <ShareCard chart={chart} />}
                <button onClick={handleCopyResult} className={`btn-mystic ${copied ? "!bg-jade-500" : ""}`}>{copied ? "✓ 已复制分享文案" : "复制文字"}</button>
              </div>
            </>
          )}
        </motion.div>
      )}
      {/* 解读失败但盘排好了：把盘给出去，比什么都不给强。
          有草稿时这一支不渲染 —— 那是"编辑到一半失败了"，
          此时该让用户接着改，而不是把编辑面板换成一块错误面板。 */}
      {!viewing && error && !loading && !draft && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 mt-6">
          <div className="mystic-card rounded-lg p-8 text-center border-vermillion-400/30">
            <p className="text-vermillion-400 mb-4">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={() => { setError(null); setDraft({ ...formData }); }} className="btn-mystic">
                改生辰重测
              </button>
              <button
                onClick={() => { setError(null); setResult(null); setChart(null); setFormData({}); }}
                className="btn-mystic"
              >
                重新测算
              </button>
            </div>
          </div>
          {chart && <BaziChart chart={chart} />}
        </motion.div>
      )}
    </div>
  );
}
