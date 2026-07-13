"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";

const FIELDS = [
  {
    name: "birthDate",
    label: "出生日期",
    type: "date" as const,
    required: true,
    placeholder: "请选择出生日期",
  },
  {
    name: "birthTime",
    label: "出生时辰",
    type: "select" as const,
    required: true,
    options: [
      { value: "子时 23:00-01:00", label: "子时 (23:00-01:00)" },
      { value: "丑时 01:00-03:00", label: "丑时 (01:00-03:00)" },
      { value: "寅时 03:00-05:00", label: "寅时 (03:00-05:00)" },
      { value: "卯时 05:00-07:00", label: "卯时 (05:00-07:00)" },
      { value: "辰时 07:00-09:00", label: "辰时 (07:00-09:00)" },
      { value: "巳时 09:00-11:00", label: "巳时 (09:00-11:00)" },
      { value: "午时 11:00-13:00", label: "午时 (11:00-13:00)" },
      { value: "未时 13:00-15:00", label: "未时 (13:00-15:00)" },
      { value: "申时 15:00-17:00", label: "申时 (15:00-17:00)" },
      { value: "酉时 17:00-19:00", label: "酉时 (17:00-19:00)" },
      { value: "戌时 19:00-21:00", label: "戌时 (19:00-21:00)" },
      { value: "亥时 21:00-23:00", label: "亥时 (21:00-23:00)" },
    ],
  },
  {
    name: "gender",
    label: "性别",
    type: "select" as const,
    required: true,
    options: [
      { value: "男", label: "男" },
      { value: "女", label: "女" },
    ],
  },
  {
    name: "question",
    label: "想了解的方向（可选）",
    type: "select" as const,
    options: [
      { value: "综合", label: "🎯 全面分析" },
      { value: "事业", label: "💼 事业发展" },
      { value: "财运", label: "💰 财富运势" },
      { value: "感情", label: "💕 感情婚姻" },
      { value: "健康", label: "🌿 健康运势" },
    ],
  },
];

export default function BaziPage() {
  return (
    <div className="min-h-screen relative">
      <Particles />
      <Header />
      <div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <FortuneForm
          mode="bazi"
          title="八字命理"
          icon="📅"
          description="子平八字，紫微斗数。填写出生信息，AI 为您排盘分析终身命局。"
          fields={FIELDS}
          price="18.8"
        />
      </main>
      <Footer />
    </div>
  );
}
