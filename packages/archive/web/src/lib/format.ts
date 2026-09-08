import type { MessageEntity, MessageRecord } from "$lib/model";

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

/** Telegram 数值 Peer 的可读类型标签；缺台账类型时按 ID 形态推断。 */
export function kindLabel(type: string | undefined, chatId?: string): string {
  if (type === "channel") return "频道";
  if (type === "group") return "群组";
  if (type === "user") return "用户";
  if (chatId !== undefined) {
    if (/^-100\d+$/.test(chatId)) return "频道";
    if (/^-\d+$/.test(chatId)) return "群组";
    if (/^\d+$/.test(chatId)) return "用户";
  }
  return "会话";
}

/** 去掉 Telegram 前缀（-100/-）的短 ID，供降级展示。 */
export function shortPeer(id: string): string {
  return id.replace(/^-100/, "").replace(/^-/, "");
}

/** 会话展示名：标题缺省或退化为数值 ID 时按类型给出占位名。 */
export function chatLabel(chat: { chatId: string; title?: string; type?: string }): string {
  const title = chat.title?.trim() ?? "";
  if (title !== "" && !/^-?\d+$/.test(title)) return title;
  return `未命名${kindLabel(chat.type, chat.chatId)}`;
}

export function senderName(record: MessageRecord): string {
  const display = [record.senderFirstName, record.senderLastName].filter(Boolean).join(" ");
  if (display) return display;
  // 频道/群组以自身身份发布：发送者即会话本身，直接用会话名。
  if (record.senderId === record.chatId && record.chatTitle) return record.chatTitle;
  if (record.senderUsername) return `@${record.senderUsername}`;
  if (record.senderId) return `${kindLabel(undefined, record.senderId)} ${shortPeer(record.senderId)}`;
  return "未知";
}

export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/;

function parseLocal(value: string): Date | null {
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 本地日期时间字符串 → 紧凑 M/D；跨年补年份。 */
export function fmtLocalDate(value: string): string {
  const match = LOCAL_DATE_RE.exec(value);
  const date = parseLocal(value);
  if (!match || date === null) return value;
  const now = new Date();
  if (date.getFullYear() !== now.getFullYear()) return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
  return `${Number(match[2])}/${Number(match[3])}`;
}

/** 本地日期时间字符串 → 紧凑区间标签：from – to，单边用"从/至"。 */
export function fmtLocalRange(from: string, to: string): string {
  if (from && to) return `${fmtLocalDate(from)} – ${fmtLocalDate(to)}`;
  if (from) return `从 ${fmtLocalDate(from)} 起`;
  if (to) return `至 ${fmtLocalDate(to)} 止`;
  return "";
}

export interface TextSegment {
  readonly text: string;
  readonly hit: boolean;
  /** URL 子串：单独成段，供链接样式渲染（可见字符串不变）。 */
  readonly url?: string;
}

const URL_RE = /https?:\/\/[^\s)）]+/g;

/** 链接区间：TextUrl 实体优先（对齐原生偏移），无实体时按文本中的 URL 子串兜底（旧行）。 */
export function urlRangesOf(
  text: string,
  entities?: readonly MessageEntity[]
): readonly { start: number; end: number; url: string }[] {
  const fromEntities = (entities ?? [])
    .filter((entity) => entity.className === "MessageEntityTextUrl" && entity.url !== undefined && entity.length > 0)
    .map((entity) => ({
      start: Math.min(entity.offset, text.length),
      end: Math.min(entity.offset + entity.length, text.length),
      url: entity.url!
    }));
  if (fromEntities.length > 0) return fromEntities;
  const ranges: { start: number; end: number; url: string }[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    const url = match[0].replace(/[，。；：！？、]+$/, "");
    if (url) ranges.push({ start: index, end: index + match[0].length, url });
  }
  return ranges;
}

export interface TelegramMessageRef {
  /** 私有频道/群组链接 t.me/c/<code>/<id> 的频道码。 */
  readonly code?: string;
  /** 公开链接 t.me/<username>/<id> 的频道用户名。 */
  readonly username?: string;
  readonly messageId: number;
}

const TME_MESSAGE_RE = /(?:t\.me|telegram\.me)\/(?:c\/(\d+)|([A-Za-z0-9_]{3,32}))\/(\d{1,18})/;

/** 从 Telegram 消息链接中解析出「聊天引用 + 消息 ID」：两类链接各取其相应定位字段。 */
export function telegramMessageRefOf(url: string): TelegramMessageRef | undefined {
  const match = url.match(TME_MESSAGE_RE);
  if (!match) return undefined;
  const code = match[1];
  const username = match[2];
  return {
    code: code ?? undefined,
    username: username ?? undefined,
    messageId: Number(match[3])
  };
}

/** 富文本分段：关键词高亮与链接区间合并输出，链接优先于高亮。 */
export function richSegments(
  text: string,
  highlights: readonly string[],
  links: readonly { start: number; end: number; url: string }[]
): TextSegment[] {
  const needles = highlights.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
  const ranges = links
    .filter((link) => link.end > link.start)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const parts: TextSegment[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  let rangeIndex = 0;
  while (cursor < text.length) {
    while (rangeIndex < ranges.length && ranges[rangeIndex]!.start < cursor) rangeIndex += 1;
    const nextLink = ranges[rangeIndex];
    let nextHit: { index: number; end: number } | undefined;
    for (const needle of needles) {
      const index = lower.indexOf(needle, cursor);
      if (index >= 0 && (nextHit === undefined || index < nextHit.index)) {
        nextHit = { index, end: index + needle.length };
      }
    }
    if (nextLink !== undefined && (nextHit === undefined || nextLink.start < nextHit.index)) {
      if (nextLink.start > cursor) parts.push({ text: text.slice(cursor, nextLink.start), hit: false });
      parts.push({ text: text.slice(nextLink.start, nextLink.end), hit: false, url: nextLink.url });
      cursor = nextLink.end;
      continue;
    }
    if (nextHit !== undefined) {
      if (nextHit.index > cursor) parts.push({ text: text.slice(cursor, nextHit.index), hit: false });
      parts.push({ text: text.slice(nextHit.index, nextHit.end), hit: true });
      cursor = nextHit.end;
      continue;
    }
    parts.push({ text: text.slice(cursor), hit: false });
    break;
  }
  return parts;
}