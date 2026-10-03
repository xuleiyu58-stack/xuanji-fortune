"use client";

import { useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { CONTACT_EMAIL } from "@/lib/contact";

/**
 * 全局错误边界。
 *
 * 没有它的时候，客户端树里任何一次抛错都会让用户看到 Next 的默认报错屏 ——
 * 一个与本站在视觉上毫无关系的界面，而且多半是英文的。
 *
 * 这里做两件事：给出一句人话，以及给出下一步（重试 / 回首页 / 联系我们）。
 * 刻意**不显示 error.message**：它可能包含内部细节（接口路径、堆栈片段），
 * 对用户没有帮助，对外却是多余的信息。真正的排查信息交给 digest 与服务器日志。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 客户端控制台留一份，便于用户反馈时截图；服务端日志另有记录
    console.error("页面渲染出错:", error);
  }, [error]);

  return (
    <div className="min-h-screen relative">
      <Header />
      <div className="ink-bg" />

      <main className="relative z-10 pt-32 pb-20 px-6">
        <div className="max-w-lg mx-auto text-center">
          <div className="seal mx-auto mb-6">岔</div>
          <h1
            className="text-3xl md:text-4xl text-gold mb-4"
            style={{ fontFamily: "'Noto Serif SC', serif" }}
          >
            这一步走岔了
          </h1>
          <p className="text-paper-100/70 text-sm leading-relaxed mb-2">
            页面加载时出了点问题。你填过的内容没有提交，也不会被计费。
          </p>
          <p className="text-paper-100/55 text-xs leading-relaxed mb-8">
            刷新通常就好了。若反复出现，请把下面这行编号发给我们，方便定位。
          </p>

          {error.digest && (
            <p className="text-paper-100/55 text-xs font-mono mb-8 select-all">
              {error.digest}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={reset} className="btn-primary">
              重试
            </button>
            <a href="/" className="btn-mystic">
              回到首页
            </a>
          </div>

          <p className="text-paper-100/45 text-xs mt-8 select-all">
            联系 {CONTACT_EMAIL}
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
