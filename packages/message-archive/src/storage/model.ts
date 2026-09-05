export type TimeMode = "include" | "exclude" | "off";

/** 一次归档抓取后落库的聊天元数据。 */
export interface ChatRecord {
  readonly chatId: string;
  readonly title?: string;
  readonly username?: string;
  readonly type?: string;
  readonly description?: string;
  readonly membersCount?: number;
}

/** 增量锚点：该群最新已归档消息。 */
export interface LastMessageInfo {
  readonly messageId: number;
  readonly date: string;
}

/** 写入后端的一条消息行（字段与 messages 表一一对应）。 */
export interface MessageRow {
  readonly messageId: number;
  readonly chatId: string;
  readonly groupedId?: string;
  readonly chatTitle?: string;
  readonly senderId?: string;
  readonly senderUsername?: string;
  readonly senderFirstName?: string;
  readonly senderLastName?: string;
  readonly date: string;
  readonly text: string;
  readonly messageType: string;
  readonly replyToMsgId?: number;
  readonly forwardFromId?: string;
  readonly forwardFromName?: string;
  readonly hasMedia: boolean;
  readonly mediaType?: string;
  readonly mediaPath?: string;
}

/** 写入后端的一条媒体记录行。 */
export interface MediaRow {
  readonly messageId: number;
  readonly chatId: string;
  readonly mediaType: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSize?: number;
  readonly mimeType?: string;
}

export interface BatchResult {
  readonly messages: number;
  readonly media: number;
}

/** 已落库的媒体文件完整记录（媒体文件路由用）。 */
export interface StoredMediaFile {
  readonly id: string;
  readonly messageId: number;
  readonly chatId: string;
  readonly mediaType: string;
  readonly fileName?: string;
  readonly filePath?: string;
  readonly fileSize?: number;
  readonly mimeType?: string;
}

/** 同相册内的一条可预览消息（来自 messages 表）。 */
export interface AlbumRow {
  readonly rowId: string;
  readonly messageId: number;
  readonly chatId: string;
  readonly groupedId: string;
  readonly date: string;
  readonly hasMedia: boolean;
  readonly mediaType?: string;
  readonly messageType?: string;
  readonly mimeType?: string;
}

/** 检索返回的完整消息行（附媒体文件与相册行）。 */
export interface MessageRecord {
  readonly rowId: string;
  readonly messageId: number;
  readonly chatId: string;
  readonly groupedId?: string;
  readonly chatTitle?: string;
  readonly date: string;
  readonly senderId?: string;
  readonly senderUsername?: string;
  readonly senderFirstName?: string;
  readonly senderLastName?: string;
  readonly hasMedia: boolean;
  readonly mediaType?: string;
  readonly messageType?: string;
  readonly mimeType?: string;
  readonly text: string;
  readonly mediaFiles: readonly StoredMediaFile[];
  readonly albumRows: readonly AlbumRow[];
}

export interface ArchiveQuery {
  readonly keyword?: string;
  readonly excludeKeyword?: string;
  readonly chatId?: string;
  readonly chatTitle?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly timeMode?: TimeMode;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ArchiveSearchResult {
  /** 条目视图：相册成员折叠成单个相册条目，分页按条目推进。 */
  readonly items: readonly ContextEntry[];
  readonly total: number;
  /** 过滤条件命中的消息总数（相册按成员条数计，首页统计用）。 */
  readonly totalMessages: number;
  readonly limit: number;
  readonly offset: number;
}

export interface MessageContextEntry {
  readonly kind: "message";
  readonly record: MessageRecord;
}

export interface AlbumContextEntry {
  readonly kind: "album";
  readonly rows: readonly MessageRecord[];
  readonly captionText: string;
  readonly rowId: string;
  readonly focusRowId?: string;
}

export type ContextEntry = MessageContextEntry | AlbumContextEntry;

/** 锚点条目及两侧上下文；beforeN/afterN 为该侧条目总数（不含锚点）。 */
export interface ArchiveContextResult {
  readonly anchor: ContextEntry | undefined;
  readonly before: readonly ContextEntry[];
  readonly after: readonly ContextEntry[];
  readonly beforeN: number;
  readonly afterN: number;
}

export function captionOf(rows: readonly MessageRecord[]): string {
  return rows.find((row) => row.text.trim().length > 0)?.text ?? "";
}

export function uniqueGroupKeys(rows: readonly Record<string, unknown>[]): (readonly [string, string])[] {
  const seen = new Set<string>();
  const keys: (readonly [string, string])[] = [];
  for (const row of rows) {
    const value = row.grouped_id;
    if (value === undefined || value === null || value === "") continue;
    const grouped = String(value);
    const key = groupKey(String(row.chat_id), grouped);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push([String(row.chat_id), grouped]);
  }
  return keys;
}

export function albumEntryOf(rows: readonly MessageRecord[], focusRowId?: string): ContextEntry {
  if (rows.length < 2) return { kind: "message", record: rows[0]! };
  return {
    kind: "album",
    rows,
    captionText: captionOf(rows),
    rowId: rows[0]!.rowId,
    ...(focusRowId !== undefined ? { focusRowId } : {})
  };
}

export function buildContextEntries(
  baselines: readonly MessageRecord[],
  groupRows: ReadonlyMap<string, readonly MessageRecord[]>
): ContextEntry[] {
  return baselines.map((row) => {
    if (row.groupedId === undefined) return { kind: "message", record: row };
    const rows = groupRows.get(groupKey(row.chatId, row.groupedId));
    if (rows === undefined || rows.length < 2) return { kind: "message", record: row };
    return { kind: "album", rows, captionText: captionOf(rows), rowId: row.rowId };
  });
}

/** 会话清单行：chats 元数据 + 消息表的按会话聚合。 */
export interface ChatLedgerRow {
  readonly chatId: string;
  readonly title: string;
  readonly username?: string;
  readonly type?: string;
  readonly description?: string;
  readonly membersCount?: number;
  readonly count: number;
  readonly lastDate?: string;
  readonly lastText?: string;
}

export interface ArchiveStoreOptions {
  readonly backend?: string;
  readonly file?: string;
  readonly url?: string;
  readonly schema?: string;
}

/** 屏蔽词快照：词表（已归一化小写）与内存缓存版本号。 */
export interface BlockwordState {
  readonly words: readonly string[];
  readonly version: number;
}

export type BlockwordAddResult = "added" | "exists" | "invalid";

export interface ArchiveStore {
  init(): Promise<void>;
  close(): Promise<void>;
  saveChat(chat: ChatRecord): Promise<boolean>;
  startSyncSession(chatId: string, startDate: string, endDate: string): Promise<number>;
  completeSyncSession(sessionId: number, messagesCount: number, mediaCount: number): Promise<void>;
  getLastMessageInfo(chatId: string): Promise<LastMessageInfo | undefined>;
  getChatUsername(chatId: string): Promise<string | undefined>;
  messageIdsExist(chatId: string, messageIds: readonly number[]): Promise<ReadonlySet<number>>;
  saveBatch(messages: readonly MessageRow[], media: readonly MediaRow[]): Promise<BatchResult>;
  searchStructured(query: ArchiveQuery): Promise<ArchiveSearchResult>;
  listChatLedger(limit: number): Promise<ChatLedgerRow[]>;
  getMessageContext(
    rowId: string,
    beforeN: number,
    afterN: number,
    beforeOffset?: number,
    afterOffset?: number
  ): Promise<ArchiveContextResult>;
  getMessageByRowId(rowId: string): Promise<MessageRecord | undefined>;
  getMediaFileById(id: string): Promise<StoredMediaFile | undefined>;
  /** 屏蔽词内存缓存快照，读路径不触表。 */
  listBlockwords(): Promise<BlockwordState>;
  /** 写透缓存：先落库再更新内存缓存，并同步三条消息的 blocked 标志。 */
  addBlockword(word: string): Promise<BlockwordAddResult>;
  /** 写透缓存；删除后全量重算 blocked 标志。 */
  removeBlockword(word: string): Promise<boolean>;
}

export function normalizeLimit(value: number | undefined): number {
  return clampInteger(value, 1, 200, 50);
}

export function normalizeOffset(value: number | undefined): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function normalizeContextLimit(value: number | undefined): number {
  return clampInteger(value, 0, 999, 10);
}

export function normalizeTimeMode(value: TimeMode | undefined): TimeMode {
  const mode = value ?? "include";
  if (mode !== "include" && mode !== "exclude" && mode !== "off") {
    throw new Error(`invalid time mode: ${String(value)}`);
  }
  return mode;
}

export function splitTerms(value: string | undefined): string[] {
  return (value ?? "").trim().split(/\s+/).filter(Boolean);
}

/** 解析时间输入为 UTC ISO 字符串；空值返回 undefined，非法输入抛错。 */
export function normalizeDate(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new Error(`invalid date: ${value}`);
  return new Date(time).toISOString();
}

export function normalizeText(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  return text || undefined;
}

export const BLOCKWORD_MAX_LENGTH = 64;

/** 屏蔽词归一化：裁剪、小写；空词或超长返回 undefined。 */
export function normalizeBlockword(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (!text || text.length > BLOCKWORD_MAX_LENGTH) return undefined;
  return text;
}

export function normalizeRowId(value: string): string {
  const result = value.trim();
  if (!/^\d+$/.test(result)) throw new Error(`invalid message row id: ${value}`);
  return result;
}

export function mediaKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function groupKey(chatId: string, groupedId: string): string {
  return `${chatId}:${groupedId}`;
}

export function paramPlaceholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}

export function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const timestamp = Number(text);
    return new Date(timestamp < 1e12 ? timestamp * 1_000 : timestamp).toISOString();
  }
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new Error(`invalid date value: ${text}`);
  return new Date(time).toISOString();
}

function clampInteger(value: number | undefined, lower: number, upper: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(upper, Math.max(lower, number));
}