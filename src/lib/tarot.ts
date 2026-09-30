/**
 * 塔罗抽牌。
 *
 * 抽牌是随机的，不该交给模型"选" —— 让它选，它会挑好解的牌，
 * 同一问题每次还会给出高度相似的牌阵。这里由代码抽，AI 只负责解读。
 *
 * 零项目内 import，随机源以参数注入，测试可完全确定。
 */

export type Suit = "权杖" | "圣杯" | "宝剑" | "星币";
export type Arcana = "major" | "minor";

export const POSITIONS = ["过去", "现在", "未来"] as const;
export type Position = (typeof POSITIONS)[number];

export interface DrawnCard {
  position: Position;
  name: string;
  nameEn: string;
  arcana: Arcana;
  suit?: Suit;
  /** 大阿卡纳为罗马数字，小阿卡纳为点数 */
  numeral: string;
  upright: boolean;
  keyword: string;
}

export interface TarotDraw {
  cards: DrawnCard[];
}

const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"];

interface CardDef {
  name: string;
  nameEn: string;
  upright: string;
  reversed: string;
}

/** 大阿卡纳 22 张。关键词手写 —— 它们各自独立，无法用规律推导。 */
const MAJOR: CardDef[] = [
  { name: "愚者", nameEn: "The Fool", upright: "启程·天真·冒险", reversed: "鲁莽·犹豫·踏空" },
  { name: "魔术师", nameEn: "The Magician", upright: "创造·掌控·资源在手", reversed: "空谈·操弄·眼高手低" },
  { name: "女祭司", nameEn: "The High Priestess", upright: "直觉·潜意识·静观", reversed: "忽视直觉·隐瞒·浮于表面" },
  { name: "皇后", nameEn: "The Empress", upright: "丰盛·滋养·孕育", reversed: "过度依赖·停滞·枯竭" },
  { name: "皇帝", nameEn: "The Emperor", upright: "秩序·权威·稳固", reversed: "专断·僵化·失去掌控" },
  { name: "教皇", nameEn: "The Hierophant", upright: "传统·指引·师承", reversed: "墨守成规·教条·叛逆" },
  { name: "恋人", nameEn: "The Lovers", upright: "结合·抉择·共鸣", reversed: "错配·动摇·价值冲突" },
  { name: "战车", nameEn: "The Chariot", upright: "意志·推进·凯旋", reversed: "失控·方向不明·内耗" },
  { name: "力量", nameEn: "Strength", upright: "柔克刚·耐性·自信", reversed: "自我怀疑·躁进·力竭" },
  { name: "隐者", nameEn: "The Hermit", upright: "内省·独处·寻道", reversed: "孤立·逃避·固步自封" },
  { name: "命运之轮", nameEn: "Wheel of Fortune", upright: "转机·周期·时来", reversed: "逆势·停滞·旧循环" },
  { name: "正义", nameEn: "Justice", upright: "公允·因果·权衡", reversed: "偏颇·逃避责任·失衡" },
  { name: "倒吊人", nameEn: "The Hanged Man", upright: "换位·等待·舍即是得", reversed: "无谓牺牲·拖延·钻牛角尖" },
  { name: "死神", nameEn: "Death", upright: "终结·蜕变·断舍离", reversed: "抗拒改变·悬而未决" },
  { name: "节制", nameEn: "Temperance", upright: "调和·中道·耐心", reversed: "失衡·急躁·过犹不及" },
  { name: "恶魔", nameEn: "The Devil", upright: "束缚·执念·欲望", reversed: "挣脱·觉察·解绑" },
  { name: "塔", nameEn: "The Tower", upright: "骤变·崩塌·破而后立", reversed: "延后的危机·勉强维持" },
  { name: "星星", nameEn: "The Star", upright: "希望·疗愈·指引", reversed: "失望·信心动摇" },
  { name: "月亮", nameEn: "The Moon", upright: "迷雾·不安·幻象", reversed: "拨云见日·真相浮现" },
  { name: "太阳", nameEn: "The Sun", upright: "明朗·成就·生机", reversed: "短暂的阴霾·过度乐观" },
  { name: "审判", nameEn: "Judgement", upright: "觉醒·清算·重生", reversed: "自我否定·犹豫不决" },
  { name: "世界", nameEn: "The World", upright: "圆满·完成·整合", reversed: "收尾未竟·差临门一脚" },
];

/** 花色主题与点数主题相乘得出小阿卡纳的含义 —— 这是通行做法，比硬编 56 条更可维护。 */
const SUIT_THEME: Record<Suit, string> = {
  权杖: "行动与热情",
  圣杯: "情感与关系",
  宝剑: "思维与冲突",
  星币: "物质与实务",
};

const RANK_THEME: Record<string, string> = {
  A: "的开端",
  "2": "的权衡",
  "3": "的成长",
  "4": "的稳固",
  "5": "的摩擦",
  "6": "的调和",
  "7": "的考验",
  "8": "的推进",
  "9": "的临界",
  "10": "的极致",
  侍从: "的初学",
  骑士: "的冲劲",
  王后: "的内化",
  国王: "的掌控",
};

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "侍从", "骑士", "王后", "国王"] as const;
const SUITS: Suit[] = ["权杖", "圣杯", "宝剑", "星币"];

function minorDef(suit: Suit, rank: string): CardDef {
  const theme = `${SUIT_THEME[suit]}${RANK_THEME[rank]}`;
  return {
    name: `${suit}${rank}`,
    nameEn: `${rank} of ${suit === "权杖" ? "Wands" : suit === "圣杯" ? "Cups" : suit === "宝剑" ? "Swords" : "Pentacles"}`,
    upright: theme,
    reversed: `${theme}（受阻）`,
  };
}

export const DECK_SIZE = MAJOR.length + SUITS.length * RANKS.length; // 22 + 56 = 78

/** 洗牌并抽三张，不重复。`rand` 注入以便测试确定化。 */
export function drawTarot(rand: () => number = Math.random): TarotDraw {
  const indices = new Set<number>();
  // 78 张里抽 3 张，冲突概率低；仍用循环兜底，避免畸形的 rand 导致死循环
  let guard = 0;
  while (indices.size < POSITIONS.length && guard < 1000) {
    indices.add(Math.floor(rand() * DECK_SIZE));
    guard++;
  }

  const cards: DrawnCard[] = Array.from(indices).slice(0, POSITIONS.length).map((idx, i) => {
    const upright = rand() < 0.5;

    if (idx < MAJOR.length) {
      const def = MAJOR[idx];
      return {
        position: POSITIONS[i],
        name: def.name,
        nameEn: def.nameEn,
        arcana: "major" as const,
        numeral: ROMAN[idx],
        upright,
        keyword: upright ? def.upright : def.reversed,
      };
    }

    const minorIdx = idx - MAJOR.length;
    const suit = SUITS[Math.floor(minorIdx / RANKS.length)];
    const rank = RANKS[minorIdx % RANKS.length];
    const def = minorDef(suit, rank);
    return {
      position: POSITIONS[i],
      name: def.name,
      nameEn: def.nameEn,
      arcana: "minor" as const,
      suit,
      numeral: rank,
      upright,
      keyword: upright ? def.upright : def.reversed,
    };
  });

  return { cards };
}

/** 压成一段文字喂给模型 —— 牌是抽好的，它只解读。 */
export function tarotToPrompt(draw: TarotDraw): string {
  const lines = draw.cards.map(
    (c) => `${c.position}之牌：${c.name}（${c.nameEn}）${c.upright ? "正位" : "逆位"} —— ${c.keyword}`
  );
  return ["已抽定的三张牌如下，请直接解读，不要另行抽牌：", ...lines].join("\n");
}
