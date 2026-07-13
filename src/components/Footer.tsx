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
        <div className="flex gap-6 text-xs text-paper-100/30 tracking-wider">
          <a href="#" className="hover:text-gold-300 transition-colors">关于我们</a>
          <a href="#" className="hover:text-gold-300 transition-colors">免责声明</a>
          <a href="#" className="hover:text-gold-300 transition-colors">联系客服</a>
        </div>
      </div>
    </footer>
  );
}
