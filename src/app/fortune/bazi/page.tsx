"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";
import { TIME_OPTIONS, GENDER_OPTIONS } from "@/lib/choices";

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
    options: TIME_OPTIONS,
  },
  {
    name: "gender",
    label: "性别",
    type: "select" as const,
    required: true,
    options: GENDER_OPTIONS,
  },
  {
    name: "question",
    label: "想了解的方向（可选）",
    type: "select" as const,
    options: [
      { value: "综合", label: "全面分析" },
      { value: "事业", label: "事业发展" },
      { value: "财运", label: "财富运势" },
      { value: "感情", label: "感情婚姻" },
      { value: "健康", label: "健康运势" },
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
          description="子平八字，紫微斗数。填写出生信息，AI 为您排盘分析终身命局。"
          fields={FIELDS}
        />
      </main>
      <Footer />
    </div>
  );
}
