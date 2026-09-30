"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";
import { TIME_OPTIONS, GENDER_OPTIONS } from "@/lib/choices";

// 合婚要排两张盘，而排盘需要准确的日期、时辰、性别。
// 原先两人各一个自由文本框（"1995年6月15日 午时 女"），靠解析这种输入太脆 ——
// 一旦有人写成"95年六月十五"，盘就排错了，而且是静默排错。改为结构化字段。
const FIELDS = [
  { name: "person1Date", label: "你的出生日期", type: "date" as const, required: true },
  { name: "person1Time", label: "你的出生时辰", type: "select" as const, required: true, options: TIME_OPTIONS },
  { name: "person1Gender", label: "你的性别", type: "select" as const, required: true, options: GENDER_OPTIONS },
  { name: "person2Date", label: "TA 的出生日期", type: "date" as const, required: true },
  { name: "person2Time", label: "TA 的出生时辰", type: "select" as const, required: true, options: TIME_OPTIONS },
  { name: "person2Gender", label: "TA 的性别", type: "select" as const, required: true, options: GENDER_OPTIONS },
  {
    name: "relationship",
    label: "你们的关系",
    type: "select" as const,
    options: [
      { value: "暧昧中", label: "暧昧中" },
      { value: "恋爱中", label: "恋爱中" },
      { value: "已婚", label: "已婚" },
      { value: "暗恋", label: "暗恋" },
      { value: "想知道", label: "想知道是否合适" },
    ],
  },
  {
    name: "question",
    label: "最关心的问题（可选）",
    type: "textarea" as const,
    placeholder: "写下你们之间最想了解的问题...",
  },
];

export default function LovePage() {
  return (
    <div className="min-h-screen relative">
      <Particles />
      <Header />
      <div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <FortuneForm
          mode="love"
          title="姻缘配对"
          description="月老牵线，命盘合婚。AI 为您解读两人缘分深浅、性格匹配、未来走向。"
          fields={FIELDS}
        />
      </main>
      <Footer />
    </div>
  );
}
