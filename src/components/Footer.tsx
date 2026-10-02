export default function Footer() {
  return (
    <footer className="border-t border-gold-300/10 py-8 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xl" style={{ fontFamily: "'Ma Shan Zheng', cursive" }}>
            玄机
          </span>
          <span className="text-paper-100/40 text-xs tracking-wider">| AI 命理解读</span>
        </div>
        <p className="text-paper-100/30 text-xs tracking-wider">
          本网站内容仅供娱乐参考，命运掌握在自己手中
        </p>
        {/* 这里原有三个 href="#" 的死链（关于我们 / 免责声明 / 联系客服），
            点了只是跳回页顶。等真正写出法律页再挂回来，不要用空锚点占位。 */}
      </div>
    </footer>
  );
}
