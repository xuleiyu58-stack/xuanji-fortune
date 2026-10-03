"use client";

import { useEffect, useMemo, useState } from "react";
import { GENDER_OPTIONS } from "@/lib/choices";
import { isApproximate } from "@/lib/bazi/approximated";
// 只取类型 —— 类型导入会被完全擦除，不会把数据带进包里
import type { RegionProvince } from "@/lib/bazi/regions";

/** 按需加载的区划模块。60KB 的数据不该跟着首屏一起发出去。 */
type RegionsModule = typeof import("@/lib/bazi/regions");

/**
 * 出生信息表单。
 *
 * 三处复杂度是别的表单没有的：
 *   1. **阳历/农历两套输入**，切换后字段结构完全不同；
 *   2. 农历不能复用 `<input type="date">`（那不是公历），得年月日三个下拉；
 *   3. 出生地是**省 → 市 → 区县**三级联动，而且只为一个用途 —— 算真太阳时。
 *
 * 关于闰月：判断某年有无闰月、某月有几天，都要问 lunar-typescript，
 * 而那个库必须留在服务端（否则会被打进浏览器包）。所以这里只列「正月…腊月」十二项，
 * 闰月靠勾选表达，合法性由服务端校验后回一句具体原因。
 *
 * 关于区县：它的经度用的是所属**市**的 —— 同一地级市内各点相差通常不足 1°（4 分钟），
 * 而时辰边界是两小时。列出来是为了让人认得出自己的家，不是为了更高精度。
 * 但用户不需要知道这个，所以界面上不解释，只在头部注释里说明。
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
const HINT_CLS = "text-paper-100/55 text-xs mt-2 leading-relaxed";

export interface BirthInputProps {
  value: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

export default function BirthInput({ value, onChange }: BirthInputProps) {
  const calendar = value.calendar === "lunar" ? "lunar" : "solar";
  const province = value.province || "";
  const city = value.city || "";

  // 农历的年月日分开存，合成后再写回 birthDate ——
  // 用户改「年」时不该连带清掉他选好的「月」。
  const [ly, setLy] = useState("1990");
  const [lm, setLm] = useState("1");
  const [ld, setLd] = useState("1");

  useEffect(() => {
    if (calendar !== "lunar") return;
    const d = `${ly}-${lm}-${ld}`;
    if (value.birthDate !== d) onChange("birthDate", d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar, ly, lm, ld]);

  // 区划数据按需加载：它是 60KB 的静态表，跟着首屏发出去了却不一定会被用到。
  // 拉不到也不崩 —— 省份框会停在「加载中」，其余表单一概照常用。
  const [regionsMod, setRegionsMod] = useState<RegionsModule | null>(null);
  useEffect(() => {
    let alive = true;
    import("@/lib/bazi/regions")
      .then((m) => { if (alive) setRegionsMod(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const provinces: readonly string[] = regionsMod?.REGIONS.map((p) => p.n) ?? [];
  const cities = useMemo(
    () => (regionsMod ? regionsMod.citiesIn(regionsMod.REGIONS, province) : []),
    [regionsMod, province]
  );
  const counties = useMemo(
    () => (regionsMod ? regionsMod.countiesIn(regionsMod.REGIONS, province, city) : []),
    [regionsMod, province, city]
  );

  // 省一变，下辖的市与区县就都不成立了，清掉免得留下一个对不上的组合
  const handleProvince = (next: string) => {
    onChange("province", next);
    onChange("city", "");
    onChange("county", "");
  };
  const handleCity = (next: string) => {
    onChange("city", next);
    onChange("county", "");
  };

  const time = value.birthTime || "";
  const isLateZi = /^23:/.test(time);
  const approximate = isApproximate(city);

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
        <p className={HINT_CLS}>
          {calendar === "lunar"
            ? "填农历生日。若当年有闰月且你生在闰月里，请一并勾选「闰月」。"
            : "填身份证上的出生日期。不确定农历生日就选阳历。"}
        </p>
      </div>

      {/* 出生日期 */}
      {calendar === "solar" ? (
        <div>
          <label className={LABEL_CLS} htmlFor="birth-date">
            出生日期<span className="text-vermillion-400 ml-1">*</span>
          </label>
          <input
            id="birth-date"
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
          <p className={HINT_CLS}>
            农历约每三年有一个闰月，位置不固定（如 2023 年闰二月、2025 年闰六月）。
            只在你确认自己生在闰月里时才勾选。
          </p>
        </div>
      )}

      {/* 出生时刻 */}
      <div>
        <label className={LABEL_CLS} htmlFor="birth-time">
          出生时刻<span className="text-vermillion-400 ml-1">*</span>
        </label>
        <input
          id="birth-time"
          type="time"
          required
          value={time}
          onChange={(e) => onChange("birthTime", e.target.value)}
          className={SELECT_CLS}
        />
        <p className={HINT_CLS}>
          填到分钟。时辰的边界是两小时，差一个时辰就是差四分之一的盘 ——
          所以宁可填个大概的时刻，也不要凭印象挑一个时辰。
        </p>
        {isLateZi && (
          <p className="text-gold-400/70 text-xs mt-2 leading-relaxed">
            23 点后属「晚子时」。本站取子平通行口径：<span className="text-paper-100/70">日柱仍按当天算</span>，
            时柱按次日的日干起。若你习惯另一种算法（过了 23 点即换日），把时刻填成 00:30 再排一次即可对照。
          </p>
        )}
      </div>

      {/* 出生地 —— 只用于真太阳时 */}
      <div>
        <label className={LABEL_CLS}>出生地（可选）</label>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={province}
            onChange={(e) => handleProvince(e.target.value)}
            disabled={!regionsMod}
            className={`${SELECT_CLS} disabled:opacity-40`}
            aria-label="省"
          >
            <option value="">{regionsMod ? "省份" : "加载中…"}</option>
            {provinces.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <select
            value={city}
            onChange={(e) => handleCity(e.target.value)}
            disabled={!province}
            className={`${SELECT_CLS} disabled:opacity-40`}
            aria-label="市"
          >
            <option value="">{province ? "城市" : "先选省份"}</option>
            {cities.map((c) => (
              <option key={c.n} value={c.n}>{c.n}</option>
            ))}
          </select>
          <select
            value={value.county || ""}
            onChange={(e) => onChange("county", e.target.value)}
            disabled={!city}
            className={`${SELECT_CLS} disabled:opacity-40`}
            aria-label="区县"
          >
            <option value="">{city ? "区县" : "先选城市"}</option>
            {counties.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <p className={HINT_CLS}>
          {city
            ? "会按当地经度把钟表时间换算成真太阳时，再定时柱 —— 西部城市与北京时间最多能差两个时辰。"
            : "填了才会做真太阳时校正。中国的钟表统一用 120°E 的时间，乌鲁木齐实际比它慢两个多小时。"}
        </p>
        {approximate && (
          <p className="text-paper-100/55 text-xs mt-1.5 leading-relaxed">
            该地的精确经度未收录，用的是所在省的中位数估值，误差约几分钟 —— 远小于一个时辰，不影响判柱。
          </p>
        )}
      </div>

      {/* 性别与关注方向 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={LABEL_CLS} htmlFor="birth-gender">
            性别<span className="text-vermillion-400 ml-1">*</span>
          </label>
          <select
            id="birth-gender"
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
          <p className={HINT_CLS}>决定大运的顺排与逆排。</p>
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
          <p className={HINT_CLS}>选了会让解读在那个方向上写得更细。</p>
        </div>
      </div>
    </div>
  );
}
