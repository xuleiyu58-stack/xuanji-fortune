"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";

const FIELDS = [
  {
    name: "question",
    label: "你想要塔罗解答的问题",
    type: "textarea" as const,
    required: true,
    placeholder: "在心中默想一个问题，然后写下来...\n例如：我该接受这份新工作吗？我们之间还有可能吗？",
  },
  {
    name: "category",
    label: "问题类型",
    type: "select" as const,
    options: [
      { value: "事业", label: "💼 事业工作" },
      { value: "感情", label: "💕 感情人际" },
      { value: "选择", label: "🎯 人生选择" },
      { value: "成长", label: "🌱 个人成长" },
      { value: "其他", label: "🔮 其他" },
    ],
  },
];

export default function TarotPage() {
  return (
    <div className="min-h-screen relative">
      <Particles />
      <Header />
      <div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <FortuneForm
          mode="tarot"
          title="AI 塔罗"
          icon="🃏"
          description="三张牌阵，AI 解牌。融合东西方占卜智慧，用塔罗的古老智慧解答现代困惑。"
          fields={FIELDS}
          price="8.8"
        />
      </main>
      <Footer />
    </div>
  );
}
