"use client";

import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Particles from "@/components/Particles";
import FortuneForm from "@/components/FortuneForm";

const FIELDS = [
  {
    name: "concern",
    label: "你心中的困惑或心事",
    type: "textarea" as const,
    placeholder: "默默写下你当下的困惑...\n例如：我该坚持现在的方向，还是换一条路？",
  },
  {
    name: "aspect",
    label: "求签方向",
    type: "select" as const,
    options: [
      { value: "随缘", label: "🏮 随缘一签" },
      { value: "事业", label: "💼 事业前程" },
      { value: "感情", label: "💕 姻缘感情" },
      { value: "学业", label: "📚 学业考试" },
      { value: "家宅", label: "🏠 家宅平安" },
      { value: "财运", label: "💰 财运福报" },
    ],
  },
];

export default function OraclePage() {
  return (
    <div className="min-h-screen relative">
      <Particles />
      <Header />
      <div className="ink-bg" />
      <main className="relative z-10 pt-24 pb-16 px-6">
        <FortuneForm
          mode="oracle"
          title="灵签求签"
          icon="🏮"
          description="千年古刹，AI 解签。以典故为引，以智慧为舟，为困惑中的你指点迷津。"
          fields={FIELDS}
          price="5.8"
        />
      </main>
      <Footer />
    </div>
  );
}
