import type { MessageRecord } from "$lib/model";

/** 本地时区紧凑格式：YY/MM/DD HH:mm */
export function fmtTs(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getFullYear() % 100)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtCount(n: number): string {
  return new Intl.NumberFormat("zh-CN").format(n);
}

export function fmtBytes(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** 当日历日分隔符：同年只标月日，跨年补全年份。 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() === new Date().getFullYear()) return `${month}月${day}日`;
  return `${d.getFullYear()}年${month}月${day}日`;
}

export function senderName(record: MessageRecord): string {
  const display = [record.senderFirstName, record.senderLastName].filter(Boolean).join(" ");
  return display || record.senderUsername || record.senderId || "未知";
}

export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export interface TextSegment {
  readonly text: string;
  readonly hit: boolean;
}

/** 将文本按多个检索词切分为命中/未命中片段；命中的首个词优先。 */
export function highlightSegments(text: string, highlights: readonly string[]): TextSegment[] {
  const needles = highlights.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
  if (needles.length === 0 || text.length === 0) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next: { index: number; word: string } | undefined;
    for (const needle of needles) {
      const index = lower.indexOf(needle, cursor);
      if (index >= 0 && (next === undefined || index < next.index)) next = { index, word: needle };
    }
    if (next === undefined) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (next.index > cursor) segments.push({ text: text.slice(cursor, next.index), hit: false });
    segments.push({ text: text.slice(next.index, next.index + next.word.length), hit: true });
    cursor = next.index + next.word.length;
  }
  return segments;
}