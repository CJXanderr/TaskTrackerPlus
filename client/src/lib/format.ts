// Formatting helpers shared by the views.

export function taskKey(identifier: string, number: number): string {
  return `${identifier}-${number}`;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Due dates ("YYYY-MM-DD", local calendar day) ----------------------------

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export const DUE_SOON_DAYS = 3;

export type DueState = "none" | "overdue" | "today" | "soon" | "later";

export function dueState(due: string): DueState {
  if (!due) return "none";
  const delta = dayNumber(due) - dayNumber(todayKey());
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta <= DUE_SOON_DAYS) return "soon";
  return "later";
}

export function dueLabel(due: string): string {
  if (!due) return "";
  const delta = dayNumber(due) - dayNumber(todayKey());
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function compareDue(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Files -------------------------------------------------------------------

export function fileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

// --- Misc --------------------------------------------------------------------

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function deriveIdentifier(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 4);
  return words
    .map((w) => w[0])
    .join("")
    .slice(0, 4);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
