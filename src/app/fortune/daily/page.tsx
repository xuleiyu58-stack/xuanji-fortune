"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";

const FIELDS = [
  {
    name: "feeling",
    label: "今日心情",
    type: "select" as const,
    options: [
      { value: "平静", label: "😌 平静如水" },
      { value: "期待", label: "✨ 满怀期待" },
      { value: "焦虑", label: "😰 略感焦虑" },
      { value: "开心", label: "😊 心情愉悦" },
      { value: "迷茫", label: "🤔 有些迷茫" },
    ],
  },
  {
    name: "focus",
    label: "今日关注",
    type: "select" as const,
    options: [
      { value: "事业", label: "💼 事业工作" },
      { value: "感情", label: "💕 感情人际" },
      { value: "财运", label: "💰 财富财运" },
      { value: "健康", label: "🌿 身心健康" },
      { value: "综合", label: "🎯 综合运势" },
    ],
  },
];

export default function DailyPage() {
  return (
    <div className="min-h-screen relative">
      <Particles />
      <Header />
      <div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <FortuneForm
          mode="daily"
          title="今日运势"
          icon="🎯"
          description="每日一签，AI 解读今日吉凶宜忌。免费体验，开启你的玄学之旅。"
          fields={FIELDS}
          price="0"
        />
      </main>
      <Footer />
    </div>
  );
}
