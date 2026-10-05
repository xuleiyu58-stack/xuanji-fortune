"""
把排盘界面渲染成竖屏短视频（1080×1920）。

为什么用代码逐帧画，而不是找"AI 生成视频"：
  · 画面里的干支、五行占比必须和真实排盘一致。生成式模型最容易在这里出错 ——
    它会把"庚戌"写成看起来很像但不对的字，而这条视频的卖点恰恰是"程序算的，能核对"。
  · 中文字形完全可控，不会有生成式模型常见的乱码字。

为什么不用 ffmpeg 直接读 PNG 序列：
  逐帧写盘再让 ffmpeg 读，30 秒的视频要写上千个文件。改成把 numpy 数组
  按原始 RGB 喂进 ffmpeg 的 stdin，一个临时文件都不需要。

关于版式：主区是 y=430 到 y=1870，四段（出生信息 / 四柱 / 五行 / 解读）**各占满主区**。
所有"谁在场、在场多少"都由 stage_alpha() 一处决定 —— 换场的重叠与否是这个函数
能直接算出来的事，不该靠人眼逐帧看，也不该靠去数像素变了多少（淡入刚开始时
整张卡只变了几个灰阶，"变化的像素比例"就已经是满格了，那个指标分辨不出强弱）。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- 画布与配色

W, H = 1080, 1920
FPS = 30

CARD_X0, CARD_X1 = 70, W - 70          # 卡片左右边距
MAIN_TOP, MAIN_BOT = 430, 1870         # 主内容区（上下留出边距）

BG = (10, 12, 20)          # 近黑的靛蓝，和网站夜色底一致
PANEL = (18, 21, 33)       # 卡片底
PANEL_EDGE = (58, 50, 32)  # 卡片描边（暗金）
GOLD = (212, 175, 90)      # 主金色
GOLD_DIM = (150, 124, 66)
PAPER = (226, 224, 216)    # 正文米白
PAPER_DIM = (150, 150, 148)

# 五行配色：保留五行各自的辨识度，但整体压低饱和度，免得画面花
ELEMENT_COLORS = {
    "金": (222, 208, 160),
    "木": (122, 176, 126),
    "水": (116, 152, 200),
    "火": (216, 130, 98),
    "土": (196, 164, 108),
}

FONT_DIR = Path(r"C:\Windows\Fonts")
SERIF = FONT_DIR / "NotoSerifSC-VF.ttf"
SANS = FONT_DIR / "NotoSansSC-VF.ttf"


def font(size: int, serif: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(SERIF if serif else SANS), size)


# ---------------------------------------------------------------- 时间轴

T_TITLE = 0.0     # 标题淡入，之后一直在
T_FORM = 0.8      # 出生信息卡
T_FORM_END = 3.0
T_CHART = 3.2     # 四柱卡
T_PILLAR = 3.9    # 四柱逐列出场
T_HIDDEN = 6.9    # 藏干浮现（四柱字变暗）
T_ELEM = 10.4     # 五行分布
T_ELEM_END = 16.4
T_READ = 17.0     # 解读，逐字打出
T_READ2 = 23.0    # 依据段
T_READ_END = 28.6 # 解读退场
T_CTA = 29.4      # 落版
TOTAL = 34.6

# 换场的分寸：EDGE 是淡出/淡入各自占的时间，GAP 是两者之间的空档。
# 早先 GAP=0 且两段重叠，结果四柱卡还没退干净，五行卡就压上来 ——
# 上一屏的「四柱」两个字浮在「五行分布」上面。玄学内容本来就要求"看得准"，
# 画面上出现重影，观众第一反应是"这东西坏了吧"。
EDGE = 0.45
GAP = 0.15

# 每个区的纵向布局。写成常量而不是散在函数里，是因为"四段各占满主区"
# 这件事必须能一眼核对 —— 早先版本正是靠散落的字面量把解读叠到了四柱上。
FOOTER_Y = 1695   # 「四柱由程序按节气推算」那句话的位置，四段共用

FORM_TOP, FORM_H = 800, 620           # 出生信息卡
CHART_TOP, CHART_H = 520, 1040        # 四柱卡
ELEM_TOP, ELEM_H = 620, 900           # 五行卡
READ_TOP, READ_H = 500, 1100          # 解读卡
COL_W = (CARD_X1 - CARD_X0) // 4

# 四段各自"出现→退场"的时间点。stage_alpha() 用它们算在场程度。
STAGES = ("form", "chart", "elem", "read")
STAGE_WINDOWS = {
    "form": (T_FORM, T_FORM_END),
    "chart": (T_CHART, T_ELEM - EDGE - GAP),
    "elem": (T_ELEM, T_READ - EDGE - GAP),
    "read": (T_READ, T_READ_END),
}


def stage_alpha(t: float) -> dict[str, float]:
    """每一屏在这一刻的在场程度。**所有绘制都必须用这里的值**。

    集中在一处是为了让"同一时刻只能有一屏在画"成为**可计算**的性质：
    把 t 从 0 走到落版，任意时刻各段透明度之和必须 ≤ 1 —— 否则画面上就会出现
    两屏叠字（用户成片里「四柱」压着「五行分布」就是这么来的）。
    光靠肉眼看帧是看不全的，靠比像素也不可靠，只有这一个函数说了算。
    """
    out: dict[str, float] = {}
    for name in STAGES:
        start, end = STAGE_WINDOWS[name]
        out[name] = between(t, start, end, edge=EDGE)
    return out


def max_total_alpha(step: float = 0.01) -> tuple[float, float]:
    """扫描整条时间轴，返回（各段叠加的最大值, 取到最大值的时刻）。"""
    worst, worst_t = 0.0, 0.0
    t = 0.0
    while t <= T_CTA:
        total = sum(stage_alpha(t).values())
        if total > worst:
            worst, worst_t = total, t
        t += step
    return worst, worst_t


# ---------------------------------------------------------------- 时间轴工具


def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def ease_out(x: float) -> float:
    """先快后慢。用于"浮现"这类动作 —— 匀速会显得机械。"""
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def fade(t: float, start: float, dur: float) -> float:
    """在 [start, start+dur] 区间内从 0 升到 1。"""
    if dur <= 0:
        return 1.0 if t >= start else 0.0
    return ease_out((t - start) / dur)


def between(t: float, start: float, end: float, edge: float = 0.35) -> float:
    """一段"出现→保持→消失"的不透明度曲线。"""
    if end <= start:
        return 0.0
    return min(fade(t, start, edge), 1 - fade(t, end - edge, edge))


# ---------------------------------------------------------------- 绘制原语


def new_canvas() -> Image.Image:
    return Image.new("RGB", (W, H), BG)


def blend_text(
    base: Image.Image,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    color: tuple[int, int, int],
    alpha: float = 1.0,
    anchor: str = "la",
    spacing: int = 0,
) -> None:
    """把文字按给定不透明度叠上去。

    PIL 的 text() 没有透明度参数，所以画在一张透明层上再合成 ——
    直接改颜色去模拟淡入会让文字在暗底上"发灰"，很难看。
    """
    if alpha <= 0.004:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(
        xy, text, font=fnt, fill=(*color, int(255 * clamp01(alpha))), anchor=anchor, spacing=spacing
    )
    base.paste(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"), (0, 0))


def text_size(text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = fnt.getbbox(text)
    return box[2] - box[0], box[3] - box[1]


def wrap_cjk(text: str, fnt: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    """中文没有词边界，按字符宽度折行。"""
    lines: list[str] = []
    cur = ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        trial = cur + ch
        if text_size(trial, fnt)[0] > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def draw_text_block(
    base: Image.Image,
    x: int,
    y: int,
    text: str,
    fnt: ImageFont.FreeTypeFont,
    color: tuple[int, int, int],
    max_w: int,
    line_gap: int = 18,
    alpha: float = 1.0,
) -> int:
    """画一段会自动折行的文字，返回下一行的 y。"""
    lines = wrap_cjk(text, fnt, max_w)
    line_h = text_size("汉", fnt)[1] + line_gap
    for i, line in enumerate(lines):
        blend_text(base, (x, y + i * line_h), line, fnt, color, alpha, anchor="la")
    return y + len(lines) * line_h


def rounded_panel(
    base: Image.Image,
    box: tuple[int, int, int, int],
    radius: int = 28,
    fill: tuple[int, int, int] = PANEL,
    edge: tuple[int, int, int] | None = PANEL_EDGE,
    edge_w: int = 2,
    alpha: float = 1.0,
) -> None:
    """半透明的圆角卡片。整块卡片也要能淡入，所以走 RGBA 合成。"""
    if alpha <= 0.004:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = int(255 * clamp01(alpha))
    d.rounded_rectangle(
        box,
        radius=radius,
        fill=(*fill, a),
        outline=(*(edge or fill), a) if edge else None,
        width=edge_w,
    )
    base.paste(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"), (0, 0))


def bar(
    base: Image.Image,
    x: int,
    y: int,
    w: int,
    h: int,
    frac: float,
    color: tuple[int, int, int],
    alpha: float = 1.0,
) -> None:
    """横向占比条。frac 是这一帧该画多长 —— 让数字随条一起长出来。"""
    if alpha <= 0.004:
        return
    frac = clamp01(frac)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    a = int(255 * clamp01(alpha))
    d.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=(255, 255, 255, int(a * 0.10)))
    if frac > 0.001:
        d.rounded_rectangle((x, y, x + max(h, int(w * frac)), y + h), radius=h // 2, fill=(*color, a))
    base.paste(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"), (0, 0))


def hline(base: Image.Image, x0: int, x1: int, y: int, color, alpha: float = 1.0, w: int = 2) -> None:
    if alpha <= 0.004:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle((x0, y, x1, y + w - 1), fill=(*color, int(255 * clamp01(alpha))))
    base.paste(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"), (0, 0))


def vline(base: Image.Image, x: int, y0: int, y1: int, color, alpha: float = 1.0, w: int = 2) -> None:
    if alpha <= 0.004:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle((x, y0, x + w - 1, y1), fill=(*color, int(255 * clamp01(alpha))))
    base.paste(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"), (0, 0))


def ring(base: Image.Image, cx: int, cy: int, r: int, color, alpha: float, w: int = 3) -> None:
    """装饰用的圆环 —— 玄机的视觉记号。"""
    if alpha <= 0.004:
        return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        (cx - r, cy - r, cx + r, cy + r), outline=(*color, int(255 * clamp01(alpha))), width=w
    )
    base.paste(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"), (0, 0))


# ---------------------------------------------------------------- 视频内容

# 真实排盘结果（与网站首页样张同源，生辰用假的那组，四柱可核对）
PILLARS = [
    {"label": "年柱", "gong": "祖上宫", "gan": "庚", "zhi": "戌", "hidden": "戊 丁 辛"},
    {"label": "月柱", "gong": "父母宫", "gan": "辛", "zhi": "未", "hidden": "己 丁 乙"},
    {"label": "日柱", "gong": "命宫", "gan": "庚", "zhi": "辰", "hidden": "戊 乙 癸", "is_day": True},
    {"label": "时柱", "gong": "子女宫", "gan": "辛", "zhi": "巳", "hidden": "丙 戊 庚"},
]

ELEMENTS = [("金", 4.5, 44), ("水", 3.0, 29), ("木", 1.0, 10), ("火", 1.0, 10), ("土", 0.8, 7)]

VERDICT = "此造为庚金身强、正印格，全局金土厚重而木火微弱，一生关键在能否把过旺的金气疏导出去。"
VERDICT_DETAIL = (
    "八字讲究「平衡」二字。金太旺好比一把刀淬得太硬，锋利是锋利，却容易崩口。"
    "此局土金成势，最需要的是一条出口——火来炼金成器，木来疏土泄秀。"
    "偏偏火木最弱，所以命主的课题不是「不够强」，而是「力气往哪儿使」。"
)


def render_frame(t: float) -> Image.Image:
    img = new_canvas()
    a = stage_alpha(t)

    # 背景：缓慢漂移的同心圆环，让静止画面不至于死板
    cx, cy = W // 2, 880
    drift = 34 * np.sin(t / 7.0)
    ring(img, cx, int(cy + drift), 300, GOLD_DIM, 0.10, 2)
    ring(img, cx, int(cy + drift), 460, GOLD_DIM, 0.07, 2)
    ring(img, cx, int(cy + drift), 620, GOLD_DIM, 0.045, 2)

    draw_header(img, t)
    draw_form(img, t, a["form"])
    draw_chart(img, t, a["chart"])
    draw_elements(img, t, a["elem"])
    draw_reading(img, t, a["read"])
    draw_footer(img, t)
    draw_cta(img, t)
    return img


def draw_header(img: Image.Image, t: float) -> None:
    # 落版时标题要在页面中央重新出现，所以页眉先退场 —— 不然「玄机」会出现两次
    a = fade(t, T_TITLE, 0.9) * (1 - fade(t, T_CTA - 0.8, 0.7))
    if a <= 0:
        return
    blend_text(img, (W // 2, 150), "玄机", font(110), GOLD, a, anchor="ma")
    blend_text(
        img,
        (W // 2, 306),
        "程序排盘 · 智能解读",
        font(42, serif=False),
        PAPER_DIM,
        a * 0.92,
        anchor="ma",
    )


def draw_footer(img: Image.Image, t: float) -> None:
    """四段共用的一句注解。

    放在这里而不是各家卡片内部，是为了让卡片换场时它**不动** ——
    动的东西太多，观众会以为换了个页面。
    """
    a = fade(t, T_CHART, 0.8) * (1 - fade(t, T_CTA, 0.5))
    if a <= 0:
        return
    blend_text(
        img,
        (W // 2, FOOTER_Y),
        "四柱由程序按节气推算，不是写的，是算的",
        font(34, serif=False),
        PAPER_DIM,
        a * 0.9,
        anchor="ma",
    )


def draw_form(img: Image.Image, t: float, a: float) -> None:
    """出生信息卡。整条片子的钩子 —— 先给输入，再给结果。"""
    if a <= 0:
        return
    rounded_panel(img, (CARD_X0, FORM_TOP, CARD_X1, FORM_TOP + FORM_H), radius=40, alpha=a)
    blend_text(img, (150, FORM_TOP + 60), "出生信息", font(52), GOLD, a, anchor="la")
    hline(img, 150, CARD_X1 - 80, FORM_TOP + 156, PANEL_EDGE, a)

    rows = [("出生日期", "1992 年 02 月 04 日"), ("出生时辰", "07:20（辰时）"), ("性别", "男")]
    for i, (k, v) in enumerate(rows):
        y = FORM_TOP + 230 + i * 116
        blend_text(img, (150, y), k, font(38, serif=False), PAPER_DIM, a, anchor="la")
        blend_text(img, (CARD_X1 - 80, y), v, font(40, serif=False), PAPER, a, anchor="ra")


def draw_chart(img: Image.Image, t: float, a: float) -> None:
    """四柱卡。整条片子的主角。

    两个动作都发生在**同一张卡里**，卡片位置不动：
      · 四柱逐列落下；
      · 藏干浮现，同时四柱的大字变暗 —— 视线自然从"柱"转到"柱里藏的东西"。
    卡片不动是有意的：动了会让读者重新找位置，而这里要的是"盘在展开"。
    """
    if a <= 0:
        return
    rounded_panel(img, (CARD_X0, CHART_TOP, CARD_X1, CHART_TOP + CHART_H), radius=40, alpha=a)

    # 大字变暗的进度：藏干出来后，四柱本身退到背景
    dim = 1 - 0.55 * fade(t, T_HIDDEN, 0.8)

    blend_text(img, (W // 2, CHART_TOP + 52), "四柱", font(52), GOLD, a, anchor="ma")

    for i, p in enumerate(PILLARS):
        x0 = CARD_X0 + i * COL_W
        cx = x0 + COL_W // 2
        ca = fade(t, T_PILLAR + i * 0.42, 0.5)
        if ca <= 0:
            continue

        if p.get("is_day"):
            rounded_panel(
                img,
                (x0 + 10, CHART_TOP + 140, x0 + COL_W - 10, CHART_TOP + 800),
                radius=30,
                fill=(30, 26, 18),
                edge=GOLD_DIM,
                edge_w=2,
                alpha=ca * a * 0.9,
            )
        if i:
            vline(img, x0, CHART_TOP + 150, CHART_TOP + 790, PANEL_EDGE, a * 0.45)

        blend_text(
            img, (cx, CHART_TOP + 172), p["label"], font(38, serif=False), PAPER_DIM, ca * a, anchor="ma"
        )
        blend_text(
            img, (cx, CHART_TOP + 226), p["gong"], font(30, serif=False), PAPER_DIM, ca * a * 0.7, anchor="ma"
        )

        color = GOLD if p.get("is_day") else PAPER
        # 天干地支各自再晚一点，形成"逐字落下"的节奏
        blend_text(
            img,
            (cx, CHART_TOP + 296),
            p["gan"],
            font(170),
            color,
            fade(t, T_PILLAR + 0.18 + i * 0.42, 0.42) * dim * a,
            anchor="ma",
        )
        blend_text(
            img,
            (cx, CHART_TOP + 470),
            p["zhi"],
            font(170),
            color,
            fade(t, T_PILLAR + 0.34 + i * 0.42, 0.42) * dim * a,
            anchor="ma",
        )

        # 藏干：四柱落完之后才出现
        ha = fade(t, T_HIDDEN + i * 0.16, 0.5)
        if ha > 0:
            hline(img, x0 + 24, x0 + COL_W - 24, CHART_TOP + 812, PANEL_EDGE, a * 0.6)
            blend_text(
                img, (cx, CHART_TOP + 834), "藏干", font(28, serif=False), GOLD_DIM, ha * a * 0.9, anchor="ma"
            )
            blend_text(img, (cx, CHART_TOP + 890), p["hidden"], font(46), PAPER, ha * a, anchor="ma")

    blend_text(
        img,
        (W // 2, CHART_TOP + CHART_H - 62),
        "庚金日主 · 生于未月",
        font(30, serif=False),
        GOLD_DIM,
        a * 0.75,
        anchor="ma",
    )


def draw_elements(img: Image.Image, t: float, a: float) -> None:
    """五行分布。条和数字一起长出来，比直接堆一堆数字有说服力。"""
    if a <= 0:
        return
    rounded_panel(img, (CARD_X0, ELEM_TOP, CARD_X1, ELEM_TOP + ELEM_H), radius=40, alpha=a)
    blend_text(img, (W // 2, ELEM_TOP + 56), "五行分布", font(52), GOLD, a, anchor="ma")
    blend_text(
        img,
        (W // 2, ELEM_TOP + 140),
        "天干各计 1 分，地支藏干按本气 1 / 中气 0.5 / 余气 0.25 计权",
        font(28, serif=False),
        PAPER_DIM,
        a * 0.8,
        anchor="ma",
    )

    bar_x, bar_w = 200, 520
    for i, (name, val, pct) in enumerate(ELEMENTS):
        start = T_ELEM + 0.35 + i * 0.22
        row_a = fade(t, start, 0.5)
        if row_a <= 0:
            continue
        grow = ease_out(clamp01((t - start) / 0.9))
        y = ELEM_TOP + 232 + i * 132
        blend_text(img, (150, y), name, font(62), ELEMENT_COLORS[name], row_a * a, anchor="la")
        bar(img, bar_x, y + 26, bar_w, 26, pct / 44 * grow, ELEMENT_COLORS[name], row_a * a)
        blend_text(
            img,
            (CARD_X1 - 80, y + 18),
            f"{val:g} · {pct}%",
            font(40, serif=False),
            PAPER,
            row_a * a,
            anchor="ra",
        )


def draw_reading(img: Image.Image, t: float, a: float) -> None:
    """解读。逐字打出 —— 全片唯一有信息量的一段，值得慢。

    逐字而不是整段淡入：整段淡入观众来不及读；逐字出现会把视线钉在字上，
    而且这种"正在生成"的节奏本身就是产品观感的一部分。
    """
    if a <= 0:
        return
    rounded_panel(img, (CARD_X0, READ_TOP, CARD_X1, READ_TOP + READ_H), radius=40, alpha=a)
    blend_text(img, (150, READ_TOP + 56), "【命局总评】", font(52), GOLD, a, anchor="la")
    hline(img, 150, CARD_X1 - 80, READ_TOP + 152, PANEL_EDGE, a * 0.8)

    fnt = font(44, serif=False)
    reveal = clamp01((t - T_READ - 0.3) / 4.4)
    shown = VERDICT[: int(len(VERDICT) * reveal)]
    y = draw_text_block(
        img, 150, READ_TOP + 210, shown, fnt, PAPER, CARD_X1 - 230, line_gap=24, alpha=a
    )

    if t > T_READ2:
        a2 = fade(t, T_READ2, 0.7) * a
        blend_text(img, (150, y + 48), "依据", font(38, serif=False), GOLD_DIM, a2, anchor="la")
        draw_text_block(
            img,
            150,
            y + 118,
            VERDICT_DETAIL,
            font(38, serif=False),
            PAPER_DIM,
            CARD_X1 - 230,
            line_gap=22,
            alpha=a2,
        )


def draw_cta(img: Image.Image, t: float) -> None:
    """落版。

    这里**单独占一屏**：前面每一段都是"卡片在换"，唯独结尾必须是干净的 ——
    早先把它叠在解读卡片上，两层的字直接糊在一起，什么都读不出来。
    """
    a = between(t, T_CTA, TOTAL + 1.2, edge=0.7)
    if a <= 0:
        return
    # 结束时把画面压暗，让落版更清楚
    dim = Image.new("RGB", (W, H), BG)
    img.paste(Image.blend(img, dim, 0.62 * a), (0, 0))

    blend_text(img, (W // 2, 700), "玄机", font(128), GOLD, a, anchor="ma")
    blend_text(img, (W // 2, 900), "程序排盘 · 智能解读", font(44, serif=False), PAPER, a, anchor="ma")
    blend_text(
        img, (W // 2, 1000), "四柱由程序推算，可自行核对", font(38, serif=False), PAPER_DIM, a * 0.9, anchor="ma"
    )
    blend_text(
        img, (W // 2, 1160), "xuanji-fortune-sage.vercel.app", font(34, serif=False), GOLD_DIM, a, anchor="ma"
    )
    blend_text(
        img,
        (W // 2, 1760),
        "命理之说，信则有不信则无，仅供娱乐",
        font(26, serif=False),
        PAPER_DIM,
        a * 0.6,
        anchor="ma",
    )


# ---------------------------------------------------------------- 编码


def encode(out_path: Path, total: float, fps: int = FPS) -> None:
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    n_frames = int(round(total * fps))

    cmd = [
        ffmpeg,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{W}x{H}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-frames:v", str(n_frames),
        "-c:v", "libx264",
        # yuv420p 是必须的：不加的话编码器可能选 yuv444p，部分手机与平台不认
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "19",
        # +faststart 把索引挪到文件头，否则网页里要下完才能播
        "-movflags", "+faststart",
        str(out_path),
    ]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert proc.stdin is not None

    for i in range(n_frames):
        t = i / fps
        frame = render_frame(t)
        proc.stdin.write(np.asarray(frame, dtype=np.uint8).tobytes())
        if i % 150 == 0:
            print(f"  第 {i}/{n_frames} 帧  t={t:.1f}s", flush=True)

    proc.stdin.close()
    _, err = proc.communicate()
    if proc.returncode != 0:
        print(err.decode("utf-8", "replace")[-2000:], file=sys.stderr)
        raise SystemExit(f"ffmpeg 失败，退出码 {proc.returncode}")


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "out.mp4")
    total = float(sys.argv[2]) if len(sys.argv) > 2 else TOTAL

    worst, worst_t = max_total_alpha()
    print(f"换场检查：各段透明度之和最大 {worst:.3f}（在 t={worst_t:.2f}s）")
    if worst > 1.0 + 1e-6:
        raise SystemExit("有两屏同时在画，先修时间轴再渲染 —— 画面上会出现叠字。")

    print(f"渲染 {total}s × {FPS}fps = {int(total * FPS)} 帧，{W}×{H}")
    encode(out, total)
    size_mb = out.stat().st_size / 1024 / 1024
    print(f"完成: {out}  {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
