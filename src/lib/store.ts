"use client";

export interface Reading {
  id: string;
  mode: string;
  title: string;
  icon: string;
  result: string;
  input: Record<string, string>;
  createdAt: string;
}

const KEYS = {
  QUOTA: "xuanji_free_quota",
  HISTORY: "xuanji_history",
  MEMBER: "xuanji_member",
  LAST_RESET: "xuanji_last_reset",
};

export function getFreeQuota(): number {
  if (typeof window === "undefined") return 0;

  const today = new Date().toDateString();
  const lastReset = localStorage.getItem(KEYS.LAST_RESET);

  if (lastReset !== today) {
    localStorage.setItem(KEYS.LAST_RESET, today);
    localStorage.setItem(KEYS.QUOTA, "3");
    return 3;
  }

  const quota = localStorage.getItem(KEYS.QUOTA);
  if (quota === null) {
    localStorage.setItem(KEYS.QUOTA, "3");
    return 3;
  }

  return parseInt(quota, 10);
}

export function consumeFreeQuota(): boolean {
  const quota = getFreeQuota();
  if (quota <= 0) return false;
  localStorage.setItem(KEYS.QUOTA, String(quota - 1));
  return true;
}

export function isMember(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEYS.MEMBER) === "true";
}

export function setMember(value: boolean) {
  localStorage.setItem(KEYS.MEMBER, String(value));
}

export function setMemberExpiry(daysFromNow: number) {
  const expiry = Date.now() + daysFromNow * 86400000;
  localStorage.setItem("xuanji_member_expiry", String(expiry));
}

export function isMemberExpired(): boolean {
  const expiry = localStorage.getItem("xuanji_member_expiry");
  if (!expiry) return false;
  return Date.now() > parseInt(expiry, 10);
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
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history.slice(0, 50)));
  return entry;
}

export function deleteReading(id: string) {
  const history = getHistory().filter((r) => r.id !== id);
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
}

export function clearHistory() {
  localStorage.removeItem(KEYS.HISTORY);
}

export function getReferralCode(): string {
  if (typeof window === "undefined") return "";
  let code = localStorage.getItem("xuanji_ref_code");
  if (!code) {
    code = "XJ" + Date.now().toString(36).toUpperCase().slice(-6);
    localStorage.setItem("xuanji_ref_code", code);
  }
  return code;
}

export function getReferralCount(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem("xuanji_ref_count") || "0", 10);
}

export function addReferral() {
  const count = getReferralCount() + 1;
  localStorage.setItem("xuanji_ref_count", String(count));
  if (count % 3 === 0) {
    const currentExpiry = parseInt(
      localStorage.getItem("xuanji_member_expiry") || "0",
      10
    );
    const newExpiry = Math.max(currentExpiry, Date.now()) + 86400000;
    localStorage.setItem("xuanji_member_expiry", String(newExpiry));
    localStorage.setItem(KEYS.MEMBER, "true");
    return true;
  }
  return false;
}
