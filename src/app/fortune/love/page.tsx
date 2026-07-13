"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";

const FIELDS = [
  {
    name: "person1",
    label: "你的出生信息",
    type: "text" as const,
    required: true,
    placeholder: "例如：1995年6月15日 午时 女",
  },
  {
    name: "person2",
    label: "TA 的出生信息",
    type: "text" as const,
    required: true,
    placeholder: "例如：1993年10月20日 申时 男",
  },
  {
    name: "relationship",
    label: "你们的关系",
    type: "select" as const,
    options: [
      { value: "暧昧中", label: "💗 暧昧中" },
      { value: "恋爱中", label: "💕 恋爱中" },
      { value: "已婚", label: "💍 已婚" },
      { value: "暗恋", label: "🌙 暗恋" },
      { value: "想知道", label: "❓ 想知道是否合适" },
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
          icon="💑"
          description="月老牵线，命盘合婚。AI 为您解读两人缘分深浅、性格匹配、未来走向。"
          fields={FIELDS}
          price="36.9"
        />
      </main>
      <Footer />
    </div>
  );
}
