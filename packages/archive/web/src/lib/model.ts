/** 归档存储的数据模型（与插件 storage 层对应，前端只读）。 */

export type TimeMode = "include" | "exclude" | "off";

/** 已落库的媒体文件完整记录。 */
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

/** 消息实体（对齐 Telegram 原生 entities）：offset/length 为 UTF-16 码元，链接实体带 url。 */
export interface MessageEntity {
  readonly className: string;
  readonly offset: number;
  readonly length: number;
  readonly url?: string;
}

/** 同相册内的一条可预览消息。 */
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
  readonly replyToText?: string;
  readonly forwardFromId?: string;
  readonly forwardFromName?: string;
  readonly entities?: readonly MessageEntity[];
  readonly text: string;
  readonly mediaFiles: readonly StoredMediaFile[];
  readonly albumRows: readonly AlbumRow[];
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

/** 锚点条目及两侧上下文；beforeN/afterN 为该侧条目总数（不含锚点）。 */
export interface ArchiveContextResult {
  readonly anchor: ContextEntry | undefined;
  readonly before: readonly ContextEntry[];
  readonly after: readonly ContextEntry[];
  readonly beforeN: number;
  readonly afterN: number;
}

/** 发送者的展示信息（用户维度检索结果项）。 */
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

export interface SenderSummaryChat {
  readonly chatId: string;
  readonly chatTitle?: string;
  readonly count: number;
  readonly lastDate?: string;
  readonly lastText?: string;
}

export interface SenderSummary {
  readonly sender: SenderInfo;
  readonly total: number;
  readonly firstDate?: string;
  readonly lastDate?: string;
  readonly chats: readonly SenderSummaryChat[];
}

export interface ReplyChainResult {
  readonly parent?: ContextEntry;
  readonly children: readonly ContextEntry[];
  readonly replyToMessageId?: number;
}