import type { SearchRow } from "$lib/types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatMessageDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    `${pad2(date.getFullYear() % 100)}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

export function formatDisplayName(row: Pick<SearchRow, "sender_first_name" | "sender_last_name">): string {
  const first = String(row.sender_first_name ?? "").trim();
  const last = String(row.sender_last_name ?? "").trim();
  return `${first} ${last}`.trim() || "-";
}

export function formatSender(row: SearchRow): string {
  const name = formatDisplayName(row);
  return row.sender_username ? `@${row.sender_username}` : name === "-" ? "@-" : name;
}

export function messageTypeLabel(type: string | null | undefined): string {
  const value = (type ?? "").trim();
  if (!value) return "消息";
  return value.replace(/^Message(Media)?/, "").replace(/^Message/, "") || "消息";
}

export function toIsoString(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}