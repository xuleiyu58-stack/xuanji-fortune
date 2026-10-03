import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

/**
 * 404。
 *
 * 默认的 not-found 也是 Next 的界面，与本站无关。这里给的是**一条出路**：
 * 全站只有一个真正的功能页，所以直接把人送回去，而不是放一堆没用的导航。
 */
export default function NotFound() {
  return (
    <div className="min-h-screen relative">
      <Header />
      <div className="ink-bg" />

      <main className="relative z-10 pt-32 pb-20 px-6">
        <div className="max-w-lg mx-auto text-center">
          <div className="seal mx-auto mb-6">迷</div>
          <h1
            className="text-3xl md:text-4xl text-gold mb-4"
            style={{ fontFamily: "'Noto Serif SC', serif" }}
          >
            此处无卦
          </h1>
          <p className="text-paper-100/70 text-sm leading-relaxed mb-8">
            这个地址没有对应的页面。可能是链接过期了，或者输错了一个字。
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/" className="btn-primary">
              去排盘
            </Link>
            <Link href="/member" className="btn-mystic">
              开通会员
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
