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
  readonly items: readonly MessageRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ArchiveContextResult {
  readonly anchor: MessageRecord | undefined;
  readonly before: readonly MessageRecord[];
  readonly after: readonly MessageRecord[];
  readonly beforeN: number;
  readonly afterN: number;
}

export interface ArchiveStoreOptions {
  readonly backend?: string;
  readonly file?: string;
  readonly url?: string;
  readonly schema?: string;
}

export interface ArchiveStore {
  init(): Promise<void>;
  close(): Promise<void>;
  saveChat(chat: ChatRecord): Promise<boolean>;
  startSyncSession(chatId: string, startDate: string, endDate: string): Promise<number>;
  completeSyncSession(sessionId: number, messagesCount: number, mediaCount: number): Promise<void>;
  getLastMessageInfo(chatId: string): Promise<LastMessageInfo | undefined>;
  messageIdsExist(chatId: string, messageIds: readonly number[]): Promise<ReadonlySet<number>>;
  saveBatch(messages: readonly MessageRow[], media: readonly MediaRow[]): Promise<BatchResult>;
  searchStructured(query: ArchiveQuery): Promise<ArchiveSearchResult>;
  getMessageContext(rowId: string, beforeN: number, afterN: number): Promise<ArchiveContextResult>;
  getMessageByRowId(rowId: string): Promise<MessageRecord | undefined>;
  getMediaFileById(id: string): Promise<StoredMediaFile | undefined>;
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

export function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const time = Date.parse(String(value));
  if (Number.isNaN(time)) throw new Error(`invalid date value: ${String(value)}`);
  return new Date(time).toISOString();
}

function clampInteger(value: number | undefined, lower: number, upper: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(upper, Math.max(lower, number));
}