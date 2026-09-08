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

/** 消息实体（对齐 Telegram 原生 entities）：offset/length 为 UTF-16 码元，链接实体带 url。 */
export interface MessageEntity {
  readonly className: string;
  readonly offset: number;
  readonly length: number;
  readonly url?: string;
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
  readonly entities?: readonly MessageEntity[];
  readonly messageType: string;
  readonly replyToMessageId?: number;
  readonly forwardFromId?: string;
  readonly forwardFromName?: string;
  readonly hasMedia: boolean;
  readonly mediaType?: string;
  readonly mediaFilePath?: string;
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
  readonly recordId: string;
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
  readonly recordId: string;
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
  readonly replyToMessageId?: number;
  /** 被回复消息的文本摘录（同会话内按消息 ID 定位，blocked = 0）。 */
  readonly replyToText?: string;
  readonly forwardFromId?: string;
  readonly forwardFromName?: string;
  /** 原始消息实体（对齐 Telegram 原生 entities，链接渲染用）。 */
  readonly entities?: readonly MessageEntity[];
  readonly text: string;
  readonly mediaFiles: readonly StoredMediaFile[];
  readonly albumRows: readonly AlbumRow[];
}

export interface ArchiveQuery {
  readonly keyword?: string;
  readonly excludeKeyword?: string;
  /** 多会话检索：与其余条件 AND，会话之间 OR。 */
  readonly chatIds?: readonly string[];
  readonly chatTitle?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly timeMode?: TimeMode;
  /** 多用户检索：与其余条件 AND，用户之间 OR。 */
  readonly senderIds?: readonly string[];
  readonly forwardFromId?: string;
  readonly forwardFromName?: string;
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
  readonly recordId: string;
  readonly focusRecordId?: string;
}

export type ContextEntry = MessageContextEntry | AlbumContextEntry;

/** 检索用户信息：按发送者聚合后的展示字段。 */
export interface SenderInfo {
  readonly senderId: string;
  readonly username?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface SenderQuery {
  readonly q?: string;
  readonly chatId?: string;
  readonly limit?: number;
}

export interface SenderSearchResult {
  readonly items: readonly SenderInfo[];
  readonly total: number;
}

/** 用户聚合概要中的单会话条目。 */
export interface SenderSummaryChat {
  readonly chatId: string;
  readonly chatTitle?: string;
  readonly count: number;
  readonly lastDate?: string;
  readonly lastText?: string;
}

/** 用户聚合概要：总计 + 按会话拆分（含每会话最新文本）。 */
export interface SenderSummary {
  readonly sender: SenderInfo;
  readonly total: number;
  readonly firstDate?: string;
  readonly lastDate?: string;
  readonly chats: readonly SenderSummaryChat[];
}

/** 回复链：锚点的回复对象与回复者；parent/children 均为上下文条目。 */
export interface ReplyChainResult {
  readonly parent?: ContextEntry;
  readonly children: readonly ContextEntry[];
  readonly replyToMessageId?: number;
}

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

export function albumEntryOf(rows: readonly MessageRecord[], focusRecordId?: string): ContextEntry {
  if (rows.length < 2) return { kind: "message", record: rows[0]! };
  return {
    kind: "album",
    rows,
    captionText: captionOf(rows),
    recordId: rows[0]!.recordId,
    ...(focusRecordId !== undefined ? { focusRecordId } : {})
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
    return { kind: "album", rows, captionText: captionOf(rows), recordId: row.recordId };
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
  readonly url?: string;
  readonly schema?: string;
}

/** 屏蔽词快照：词表（已归一化小写）与内存缓存版本号。 */
export interface BlockwordState {
  readonly words: readonly string[];
  readonly version: number;
}

export type BlockwordAddResult = "added" | "exists" | "invalid";

/** 被屏蔽用户：以 sender_id 精确匹配消息行，附展示信息供管理界面使用。 */
export interface BlockedUserInfo {
  readonly userId: string;
  readonly name?: string;
  readonly username?: string;
}

export interface BlockedUserInput {
  readonly userId: string;
  readonly name?: string;
  readonly username?: string;
}

/** 屏蔽用户快照：名单与内存缓存版本号。 */
export interface BlockedUserState {
  readonly users: readonly BlockedUserInfo[];
  readonly version: number;
}

export type BlockedUserAddResult = "added" | "exists" | "invalid";

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
    recordId: string,
    beforeN: number,
    afterN: number,
    beforeOffset?: number,
    afterOffset?: number
  ): Promise<ArchiveContextResult>;
  getMessageByRecordId(recordId: string): Promise<MessageRecord | undefined>;
  /** 用户维度检索：按发送者聚合（blocked = 0），支持名字/用户名/ID 匹配。 */
  searchSenders(query: SenderQuery): Promise<SenderSearchResult>;
  /** 用户聚合概要：不存在该用户（不看屏蔽）返回 undefined，路由映射 404。 */
  getSenderSummary(senderId: string, chatId?: string): Promise<SenderSummary | undefined>;
  /** 回复链：锚点不存在（含被屏蔽）返回 undefined，路由映射 404。 */
  getReplyChain(recordId: string): Promise<ReplyChainResult | undefined>;
  getMediaFileById(id: string): Promise<StoredMediaFile | undefined>;
  /** 屏蔽词内存缓存快照，读路径不触表。 */
  listBlockwords(): Promise<BlockwordState>;
  /** 写透缓存：先落库再更新内存缓存，并同步三条消息的 blocked 标志。 */
  addBlockword(word: string): Promise<BlockwordAddResult>;
  /** 写透缓存；删除后仅重算命中被删词的行。 */
  removeBlockword(word: string): Promise<boolean>;
  /** 屏蔽用户内存缓存快照，读路径不触表。 */
  listBlockedUsers(): Promise<BlockedUserState>;
  /** 写透缓存：先落库再更新内存缓存，并同步 sender 命中行的 blocked 标志。 */
  addBlockedUser(input: BlockedUserInput): Promise<BlockedUserAddResult>;
  /** 写透缓存；删除后仅重算发送者为被删用户的行。 */
  removeBlockedUser(userId: string): Promise<boolean>;
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

export const BLOCKED_USER_MAX_LENGTH = 64;

/** 屏蔽用户 ID 归一化：裁剪；空串或超长返回 undefined。 */
export function normalizeUserId(value: string): string | undefined {
  const text = value.trim();
  if (!text || text.length > BLOCKED_USER_MAX_LENGTH) return undefined;
  return text;
}

export function normalizeRecordId(value: string): string {
  const result = value.trim();
  if (!/^\d+$/.test(result)) throw new Error(`invalid message record id: ${value}`);
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

/** 实体列：JSON 串 ↔ 实体数组（空数组与空值同样视为无实体）。 */
export function entitiesJson(entities: readonly MessageEntity[] | undefined): string | null {
  return entities !== undefined && entities.length > 0 ? JSON.stringify(entities) : null;
}

export function parseEntities(value: unknown): readonly MessageEntity[] | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    const entities = parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        className: String(item.className ?? ""),
        offset: Number(item.offset ?? 0),
        length: Number(item.length ?? 0),
        ...(typeof item.url === "string" && item.url ? { url: item.url } : {})
      }))
      .filter((entity) => entity.className !== "" && entity.length > 0);
    return entities.length > 0 ? entities : undefined;
  } catch {
    return undefined;
  }
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