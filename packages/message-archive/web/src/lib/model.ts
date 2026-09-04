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

/** 同相册内的一条可预览消息。 */
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