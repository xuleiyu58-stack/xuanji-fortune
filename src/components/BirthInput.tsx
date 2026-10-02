"use client";

import { useEffect, useState } from "react";
import { GENDER_OPTIONS, TIME_OPTIONS } from "@/lib/choices";
import { PLACE_NAMES } from "@/lib/bazi";

/**
 * 出生信息表单。
 *
 * 从通用的字段循环里独立出来，是因为它有三处别人没有的复杂度：
 *   1. **阳历/农历两套输入**，切换后字段结构完全不同；
 *   2. 农历不能复用 `<input type="date">`（那不是公历），得年月日三个下拉；
 *   3. 出生地只有一个用途 —— 算真太阳时，所以它得有说明，不能不明不白地要一个城市。
 *
 * 关于闰月：判断某年有无闰月、某月有几天，都要问 lunar-typescript，
 * 而那个库必须留在服务端（否则会被打进浏览器包）。所以这里只列「正月…腊月」十二项，
 * 闰月靠勾选表达，合法性由服务端校验后回一句具体原因 —— 用户勾了那年没有的闰月，
 * 他会看到「农历 2023 年没有闰三月」，而不是一句笼统的「信息不完整」。
 */

const LUNAR_MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];

const CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function lunarDayName(d: number): string {
  if (d <= 10) return `初${CN[d - 1]}`;
  if (d < 20) return `十${CN[d - 11]}`;
  if (d === 20) return "二十";
  if (d < 30) return `廿${CN[d - 21]}`;
  return "三十";
}

const YEARS = Array.from({ length: 2100 - 1900 + 1 }, (_, i) => 1900 + i);

const SELECT_CLS =
  "w-full bg-mystic-800 border border-gold-300/20 rounded px-4 py-3 text-paper-100/80 focus:border-gold-300/50 focus:outline-none transition-colors";

const LABEL_CLS = "block text-paper-100/60 text-sm mb-2 tracking-wider";

export interface BirthInputProps {
  value: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

export default function BirthInput({ value, onChange }: BirthInputProps) {
  const calendar = value.calendar === "lunar" ? "lunar" : "solar";

  // 农历的年月日分开存，合成后再写回 birthDate ——
  // 用户改「年」时不该连带清掉他选好的「月」。
  const [ly, setLy] = useState("1990");
  const [lm, setLm] = useState("1");
  const [ld, setLd] = useState("1");

  useEffect(() => {
    if (calendar !== "lunar") return;
    const d = `${ly}-${lm}-${ld}`;
    if (value.birthDate !== d) onChange("birthDate", d);
    // onChange 由父组件用 useCallback 之外的普通函数传入，放进依赖会每次重跑；
    // 这里只关心三个农历分量与历法的变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar, ly, lm, ld]);

  const hasPlace = Boolean(value.place);

  return (
    <div className="space-y-6">
      {/* 历法 */}
      <div>
        <label className={LABEL_CLS}>历法</label>
        <div className="flex rounded-lg border border-gold-300/20 overflow-hidden">
          {([
            { key: "solar", label: "阳历（公历）" },
            { key: "lunar", label: "农历（阴历）" },
          ] as const).map((opt) => {
            const active = calendar === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  onChange("calendar", opt.key);
                  // 切到公历时清掉农历标记，免得留一个对不上的状态
                  if (opt.key === "solar") onChange("lunarLeap", "false");
                }}
                className={`flex-1 py-3 text-sm tracking-wider transition-colors ${
                  active ? "bg-gold-500/15 text-gold-300" : "text-paper-100/50 hover:text-paper-100/80"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-paper-100/35 text-xs mt-2 leading-relaxed">
          {calendar === "lunar"
            ? "填农历生日。若当年有闰月且你生在闰月里，请一并勾选「闰月」。"
            : "填身份证上的出生日期。不确定农历生日就选阳历。"}
        </p>
      </div>

      {/* 出生日期 */}
      {calendar === "solar" ? (
        <div>
          <label className={LABEL_CLS}>
            出生日期<span className="text-vermillion-400 ml-1">*</span>
          </label>
          <input
            type="date"
            required
            value={value.birthDate || ""}
            onChange={(e) => onChange("birthDate", e.target.value)}
            className={SELECT_CLS}
          />
        </div>
      ) : (
        <div>
          <label className={LABEL_CLS}>
            农历出生日期<span className="text-vermillion-400 ml-1">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <select value={ly} onChange={(e) => setLy(e.target.value)} className={SELECT_CLS} aria-label="农历年">
              {YEARS.map((y) => (
                <option key={y} value={String(y)}>{y} 年</option>
              ))}
            </select>
            <select value={lm} onChange={(e) => setLm(e.target.value)} className={SELECT_CLS} aria-label="农历月">
              {LUNAR_MONTHS.map((name, i) => (
                <option key={name} value={String(i + 1)}>{name}</option>
              ))}
            </select>
            <select value={ld} onChange={(e) => setLd(e.target.value)} className={SELECT_CLS} aria-label="农历日">
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>{lunarDayName(d)}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={value.lunarLeap === "true"}
              onChange={(e) => onChange("lunarLeap", e.target.checked ? "true" : "false")}
              className="accent-[#c9963a]"
            />
            <span className="text-paper-100/60 text-sm">这一月是闰月</span>
          </label>
          <p className="text-paper-100/35 text-xs mt-2 leading-relaxed">
            农历约每三年有一个闰月，位置不固定（如 2023 年闰二月、2025 年闰六月）。
            只在你确认自己生在闰月里时才勾选。
          </p>
        </div>
      )}

      {/* 时辰 */}
      <div>
        <label className={LABEL_CLS}>
          出生时辰<span className="text-vermillion-400 ml-1">*</span>
        </label>
        <select
          required
          value={value.birthTime || ""}
          onChange={(e) => onChange("birthTime", e.target.value)}
          className={SELECT_CLS}
        >
          <option value="">请选择</option>
          {TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-paper-100/35 text-xs mt-2 leading-relaxed">
          时辰决定时柱，差一个时辰就差四分之一的盘。不确定的时段请尽量回忆太阳的位置。
        </p>
      </div>

      {/* 出生地 —— 只用于真太阳时 */}
      <div>
        <label className={LABEL_CLS}>出生地（可选）</label>
        <select
          value={value.place || ""}
          onChange={(e) => onChange("place", e.target.value)}
          className={SELECT_CLS}
        >
          <option value="">不填（按钟表时间排盘）</option>
          {PLACE_NAMES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <p className="text-paper-100/35 text-xs mt-2 leading-relaxed">
          {hasPlace
            ? "会按当地经度把钟表时间换算成真太阳时，再定时柱 —— 西部城市与北京时间最多能差两个时辰。"
            : "填了才会做真太阳时校正。中国的钟表统一用 120°E 的时间，乌鲁木齐实际比它慢两个多小时。"}
        </p>
      </div>

      {/* 性别与关注方向 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={LABEL_CLS}>
            性别<span className="text-vermillion-400 ml-1">*</span>
          </label>
          <select
            required
            value={value.gender || ""}
            onChange={(e) => onChange("gender", e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">请选择</option>
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-paper-100/35 text-xs mt-2">决定大运的顺排与逆排。</p>
        </div>
        <div>
          <label className={LABEL_CLS}>想了解的方向（可选）</label>
          <select
            value={value.question || ""}
            onChange={(e) => onChange("question", e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">全面分析</option>
            {["事业", "财运", "感情", "健康"].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <p className="text-paper-100/35 text-xs mt-2">选了会让解读在那个方向上写得更细。</p>
        </div>
      </div>
    </div>
  );
}
