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
 *   2. 两套都不能用 `<input type="date">` 糊过去：阳历那套要用它，农历没法用
 *      （那不是公历）；而只给阳历用、农历用下拉，同一个「出生日期」就有了两副相貌 ——
 *      所以**两套一律三个下拉**，样式与手感统一；
 *   3. 出生地是**省 → 市 → 区县**三级联动，而且只为一个用途 —— 算真太阳时。
 *
 * 关于闰月：判断某年有无闰月、某月有几天，都要问 lunar-typescript，
 * 而那个库必须留在服务端（否则会被打进浏览器包）。所以这里只列「正月…腊月」十二项，
 * 闰月靠勾选表达，合法性由服务端校验后回一句具体原因。
 *
 * 关于公历的月长：那个是小学算术（闰年 29 天、4/6/9/11 月 30 天），不必问库，
 * 本文件里 `solarDayCount` 自己算。**只列当月真的存在的日子** ——
 * 2 月里摆一个「30 日」让人选中再报错，是把校验责任推给用户。
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

/**
 * 公历年份的下限。
 *
 * 定在 1920，有两个理由：
 *   1. 三列并排时每列只有约 114px（430px 手机减内边距再除以三），
 *      选项文字长一点就会被截断 —— 手机上原生下拉的截断是硬截断，不省略号。
 *      年份表短一些，也让这一个下拉不至于长得离谱；
 *   2. 1900 年只有 1 月够得着（月/日按"当月真的存在"来列），列出来却选不了，
 *      是界面在骗人。
 * 1920 年出生的人今天已逾百岁，再往前不必替他们操心。
 */
const SOLAR_MIN_YEAR = 1920;
const SOLAR_MAX_YEAR = 2100;
const SOLAR_YEARS = Array.from(
  { length: SOLAR_MAX_YEAR - SOLAR_MIN_YEAR + 1 },
  (_, i) => SOLAR_MIN_YEAR + i
);

/** 公历某年某月有几天。month 从 1 起算。 */
function solarDayCount(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** 把 `YYYY-MM-DD` 拆成三段；缺项给空串，好让下拉停在占位项上。 */
function splitYmd(ymd: string): [string, string, string] {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((ymd || "").trim());
  if (!m) return ["", "", ""];
  return [m[1], String(Number(m[2])), String(Number(m[3]))];
}

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
  /** 时辰不详：勾了那个复选框就等于宣告"只排三柱" */
  const timeUnknown = value.timeUnknown === "true";
  const approximate = isApproximate(city);

  // 阳历的年月日：从 birthDate 反解，不另存状态（理由见下面那段的注释）
  const [solarY, solarM, solarD] = splitYmd(value.birthDate || "");
  const solarDays = solarDayCount(Number(solarY) || SOLAR_MIN_YEAR, Number(solarM) || 1);
  /**
   * 写回阳历日期。
   *
   * 日要 clamp 到当月的天数：从 1 月 31 日改到 2 月，若不收，会写出 `1990-02-31` ——
   * 服务端 `buildBaziChart` 的正则只校验形状、不校验月份的日数，
   * 于是它会流进排盘库。**在源头截住，而不是指望下游每一处都记得校验。**
   *
   * 这里**不判"年月是否已选"**：表单初始化就给了完整日期（见 FortuneForm 的
   * `birthDate: "1990-01-01"`），三个下拉任何时候都拼得出一个合法日期。
   * 早先加过一个 `if (!y || !m) return;`，在 birthDate 为空时正好把每一次改动
   * 都吞掉 —— 状态没变、下拉被弹回原位，表现为"这几个框根本改不动"。
   */
  const emitSolar = (y: string, m: string, d: string) => {
    const yy = Number(y) || SOLAR_MIN_YEAR;
    const mm = Math.min(Math.max(Number(m) || 1, 1), 12);
    const last = solarDayCount(yy, mm);
    const dd = Math.min(Math.max(Number(d) || 1, 1), last);
    onChange("birthDate", `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  };

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
          <label className={LABEL_CLS}>
            出生日期<span className="text-vermillion-400 ml-1">*</span>
          </label>
          {/*
            这一格**不额外存 state**：年月日直接由 value.birthDate 反解，
            选一次就写回去。自己再存一份的话，两边迟早不同步 ——
            而出生日期是整张盘唯一的输入，它一旦和界面显示的不一致，盘就是错的。
            初值由表单给出（FortuneForm 的 `birthDate: "1990-01-01"`），
            所以一进来就有一个完整合法的日期可改，不存在"选到一半"的中间态。
          */}
          <div className="grid grid-cols-3 gap-2">
            <select
              value={solarY}
              onChange={(e) => emitSolar(e.target.value, solarM, solarD)}
              className={SELECT_CLS}
              aria-label="阳历年"
            >
              {/* 选项文字不带空格：三列并排时每列只有约 114px，「1990 年」会被截成「1990」 */}
              {SOLAR_YEARS.map((y) => (
                <option key={y} value={String(y)}>{y}年</option>
              ))}
            </select>
            <select
              value={solarM}
              onChange={(e) => emitSolar(solarY, e.target.value, solarD)}
              className={SELECT_CLS}
              aria-label="阳历月"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>{m}月</option>
              ))}
            </select>
            <select
              value={solarD}
              onChange={(e) => emitSolar(solarY, solarM, e.target.value)}
              className={SELECT_CLS}
              aria-label="阳历日"
            >
              {Array.from({ length: solarDays }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>{d}日</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <label className={LABEL_CLS}>
            农历出生日期<span className="text-vermillion-400 ml-1">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <select value={ly} onChange={(e) => setLy(e.target.value)} className={SELECT_CLS} aria-label="农历年">
              {YEARS.map((y) => (
                <option key={y} value={String(y)}>{y}年</option>
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
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <label className={LABEL_CLS} htmlFor="birth-time">
            出生时刻{timeUnknown ? null : <span className="text-vermillion-400 ml-1">*</span>}
          </label>
          {/*
            「不知道」是常态，不是异常。很多人问过父母也问不出来，
            此前时辰必填，这批人就卡在这一步走了 —— 而他们本来是最愿意付钱的一批
            （愿意付费算命的人，往往正是对命运有疑问的人）。

            勾上之后**不猜时辰**，只排年、月、日三柱。刻意不提供"按子时算"
            之类的兜底：时柱一错，时柱本身、五行分布、身强身弱、格局、
            大运起运岁数全跟着错。宁可少给一柱，也不能给一柱假的。
          */}
          <label className="flex items-center gap-1.5 text-xs text-paper-100/60 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={timeUnknown}
              onChange={(e) => onChange("timeUnknown", e.target.checked ? "true" : "")}
              className="accent-gold-400 w-3.5 h-3.5"
            />
            不确定，只排年月日
          </label>
        </div>
        <input
          id="birth-time"
          type="time"
          required={!timeUnknown}
          disabled={timeUnknown}
          value={timeUnknown ? "" : time}
          onChange={(e) => onChange("birthTime", e.target.value)}
          className={`${SELECT_CLS} ${timeUnknown ? "opacity-40 cursor-not-allowed" : ""}`}
        />
        {timeUnknown ? (
          <div className="text-xs leading-relaxed mt-2 rounded border border-gold-300/15 bg-mystic-900/40 px-3 py-2">
            <p className="text-paper-100/65 mb-1">只排年、月、日三柱，时柱留空。</p>
            <p className="text-paper-100/50">
              日主强弱、五行分布、格局、大运起运岁数会以三柱推算，与完整四柱略有出入；
              时柱所主的子女缘分与晚年运势无从判断。日后问到确切时辰，重新排一次会更准。
            </p>
          </div>
        ) : (
          <p className={HINT_CLS}>
            填到分钟。时辰的边界是两小时，差一个时辰就是差四分之一的盘 ——
            所以宁可填个大概的时刻，也不要凭印象挑一个时辰。
          </p>
        )}
        {!timeUnknown && isLateZi && (
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
