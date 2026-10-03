"use client";

const KEYS = {
  HISTORY: "xuanji_history",
  HISTORY_SEEN: "xuanji_history_seen",
};

/**
 * 会员状态**不在这里**。
 *
 * 原先有 isMember / setMember / setMemberExpiry 三个函数，读写 localStorage
 * 里的一个布尔值 —— 于是控制台敲一行 localStorage.setItem('xuanji_member','true')
 * 就能变成终身会员。权益的真相现在只在服务端签发的那张签名凭证里，
 * 前端要读就调 /api/entitlement（见 lib/entitlements.ts）。
 *
 * 本地存储只剩「排盘历史」这一件事，那是纯客户端数据，不上云也不涉及权限。
 */

export interface Reading {
  id: string;
  mode: string;
  title: string;
  result: string;
  input: Record<string, string>;
  createdAt: string;
  /**
   * 当次排好的命盘。
   *
   * 存它是为了「历史回看」不再需要向服务器要一次盘 —— 排盘是纯计算、
   * 不花钱，但一次多余的往返仍是多余的。旧记录没有这个字段，
   * 那时回退到 /api/chart 重排一次（见 viewing.ts 与 FortuneForm）。
   *
   * 类型用 unknown 而不是 BaziChart：这个模块要能被 node --test 直接跑，
   * 引入 lib/bazi 会连带把 lunar-typescript 拖进来。
   */
  chart?: unknown;
}

export function getHistory(): Reading[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEYS.HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveReading(reading: Omit<Reading, "id" | "createdAt">) {
  const history = getHistory();
  const entry: Reading = {
    ...reading,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
  };
  history.unshift(entry);
  try {
    localStorage.setItem(KEYS.HISTORY, JSON.stringify(history.slice(0, 50)));
  } catch {
    // 配额写满时不该让整次解读失败 —— 用户要的是解读结果，历史丢了是次要的
    console.warn("排盘历史写入失败（本地存储可能已满）");
  }
  return entry;
}

export function deleteReading(id: string) {
  const history = getHistory().filter((r) => r.id !== id);
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
}

export function clearHistory() {
  localStorage.removeItem(KEYS.HISTORY);
  localStorage.removeItem(KEYS.HISTORY_SEEN);
}

/**
 * 有没有「看过之后才产生的」新记录。
 *
 * 页头那个红点此前判的是 `getHistory().length > 0` —— 也就是**只要有一条记录
 * 就永远亮着**。于是它从"有新东西"变成了一个永不熄灭的装饰，
 * 用户看久了只会觉得它坏了。红点的语义必须是"有新的没看"。
 *
 * 判据用**条目 id** 而不是时间戳：同一毫秒内连存两条时 createdAt 完全相同，
 * 时间戳比较分不出来（先存的那条被标记已看 → 后存的那条也被当成看过），
 * 用户就永远看不到红点。id 里有随机后缀，不会撞。
 */
export function hasUnseenHistory(): boolean {
  if (typeof window === "undefined") return false;
  const history = getHistory();
  if (history.length === 0) return false;

  const seenId = localStorage.getItem(KEYS.HISTORY_SEEN);
  if (!seenId) return true; // 从没看过，那就都是新的

  // 最新一条就是标记过的那条 → 没有新的。
  // 用"被标记的那条还在不在列表里"来判断，而不是比时间：
  // 这样即便用户删掉了被标记的那条，也不会把剩下的全误判成"新的"。
  return history[0].id !== seenId;
}

/** 打开历史时调用：把"已看到最新一条"记下来，红点随之熄灭。 */
export function markHistorySeen() {
  if (typeof window === "undefined") return;
  const history = getHistory();
  if (history.length === 0) return;
  // 记的是**最新那条的 id**，而不是"现在" —— 用现在的话，
  // 用户在打开抽屉那一秒之后产生的记录会被误标为已看。
  localStorage.setItem(KEYS.HISTORY_SEEN, history[0].id);
}

/**
 * 登录后把这次解读也存一份到账户（上云）。
 *
 * 刻意是**旁路、失败静默**：本地那份已经存好了，上云只是多一份跨设备可用的副本。
 * 为一次上云失败去打断用户读解读，是本末倒置。
 *
 * 也因此不 await、不报错 —— 调用方（FortuneForm）不需要为它处理任何分支。
 */
export function saveReadingToCloud(reading: Omit<Reading, "id" | "createdAt">): void {
  void (async () => {
    try {
      const { accountsEnabled, authHeaders } = await import("@/lib/auth-client");
      if (!accountsEnabled()) return;
      const headers = await authHeaders();
      if (!headers.Authorization) return; // 未登录，只留本地那份

      await fetch("/api/account/readings", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(reading),
      });
    } catch {
      // 上云失败不影响本地记录，静默即可
    }
  })();
}

/**
 * 拉取账户里的记录（上云的那一份）。
 *
 * 未配置账号服务或未登录时返回空数组 —— 调用方不需要区分，
 * 因为界面的行为是一样的：只显示本地那份。
 */
export async function fetchCloudReadings(): Promise<Reading[]> {
  try {
    const { accountsEnabled, authHeaders } = await import("@/lib/auth-client");
    if (!accountsEnabled()) return [];
    const headers = await authHeaders();
    if (!headers.Authorization) return [];

    const res = await fetch("/api/account/readings", { headers });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.readings) ? (data.readings as Reading[]) : [];
  } catch {
    return [];
  }
}

/**
 * 合并本地与云端记录。
 *
 * 同一条解读在两边各有一份（登录后新产生的解读两处都存），所以必须去重。
 * 去重的依据是 mode + title + 正文前 200 字：id 在两处是各自生成的
 * （本地是时间戳 base36，云端是 uuid），拿 id 比等于没比。
 *
 * 时间倒序排列；正文取较长的那份，避免较短的截断版覆盖完整版。
 */
export function mergeReadings(local: Reading[], cloud: Reading[]): Reading[] {
  const key = (r: Reading) => `${r.mode}|${r.title}|${(r.result ?? "").slice(0, 200)}`;
  const byKey = new Map<string, Reading>();

  for (const r of [...local, ...cloud]) {
    const k = key(r);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, r);
      continue;
    }
    // 保留正文更完整的那条
    if ((r.result?.length ?? 0) > (prev.result?.length ?? 0)) byKey.set(k, r);
  }

  return [...byKey.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// 邀请裂变已移除。
// 原实现是本机计数器：自己点三次就给自己发会员，且不校验被邀请人是谁 ——
// 那是一个兑不了的承诺，比没有更伤用户。等有了服务端账号体系再重新设计。
// 一并删掉的还有 page.tsx 里读取 ?ref= 的副作用与界面上的邀请按钮。
