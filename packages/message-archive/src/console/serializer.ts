import {
  type AlbumRow,
  type MessageRecord,
  type StoredMediaFile,
  type TimeMode,
  normalizeDate,
  normalizeText
} from "../storage/index.js";
import { HttpError } from "./errors.js";

export interface MediaItem {
  readonly id?: string | null;
  readonly message_id?: number | null;
  readonly message_rowid?: string | null;
  readonly media_url: string;
  readonly media_type?: string | null;
  readonly mime_type?: string | null;
}

/** 单条消息的检索结果行（原版查询台的串行化形状）。 */
export interface SearchRow {
  readonly id: string;
  readonly message_id: number;
  readonly chat_id: string;
  readonly grouped_id: string | null;
  readonly chat_title: string | null;
  readonly date: string;
  readonly sender_id: string | null;
  readonly sender_username: string | null;
  readonly sender_first_name: string | null;
  readonly sender_last_name: string | null;
  readonly has_media: boolean;
  readonly media_type: string | null;
  readonly mime_type: string | null;
  readonly message_type: string | null;
  readonly text: string;
  readonly media_files: readonly SerializedMediaFile[];
  readonly album_media_rows: readonly SerializedAlbumRow[];
  readonly media_items: readonly MediaItem[];
  readonly has_preview: boolean;
  readonly media_url: string | null;
}

export interface SerializedMediaFile {
  readonly id: string;
  readonly message_id: number;
  readonly chat_id: string;
  readonly media_type: string | null;
  readonly mime_type: string | null;
}

export interface SerializedAlbumRow {
  readonly id: string;
  readonly message_id: number;
  readonly chat_id: string;
  readonly grouped_id: string;
  readonly date: string;
  readonly has_media: boolean;
  readonly media_type: string | null;
  readonly message_type: string | null;
  readonly mime_type: string | null;
}

export interface SearchInput {
  readonly keyword?: string;
  readonly excludeKeyword?: string;
  readonly chatTitle?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly timeMode: TimeMode;
  readonly limit: number;
  readonly offset: number;
}

export function serializeRow(row: MessageRecord): SearchRow {
  const items = buildMediaItems(row);
  return {
    id: row.rowId,
    message_id: row.messageId,
    chat_id: row.chatId,
    grouped_id: row.groupedId ?? null,
    chat_title: row.chatTitle ?? null,
    date: row.date,
    sender_id: row.senderId ?? null,
    sender_username: row.senderUsername ?? null,
    sender_first_name: row.senderFirstName ?? null,
    sender_last_name: row.senderLastName ?? null,
    has_media: row.hasMedia,
    media_type: row.mediaType ?? null,
    mime_type: row.mimeType ?? null,
    message_type: row.messageType ?? null,
    text: row.text,
    media_files: row.mediaFiles.map(serializeMediaFile),
    album_media_rows: row.albumRows.map(serializeAlbumRow),
    media_items: items,
    has_preview: items.length > 0,
    media_url: items[0]?.media_url ?? null
  };
}

export function parseSearchParams(params: Record<string, unknown>): SearchInput {
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  try {
    dateFrom = normalizeDate(optionalText(params.date_from));
    dateTo = normalizeDate(optionalText(params.date_to));
  } catch (error) {
    throw new HttpError(422, messageOf(error));
  }
  if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
    throw new HttpError(422, "date_from cannot be later than date_to");
  }
  const timeMode = requireTimeMode(optionalText(params.time_mode) ?? "include");
  return {
    keyword: normalizeText(optionalText(params.keyword)),
    excludeKeyword: normalizeText(optionalText(params.exclude_keyword)),
    chatTitle: normalizeText(optionalText(params.chat_title)),
    dateFrom,
    dateTo,
    timeMode,
    limit: boundedInteger(params.limit, 1, 200, 50),
    offset: boundedInteger(params.offset, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

export function requiredRowId(value: unknown): string {
  const text = optionalText(value);
  if (!text) throw new HttpError(422, "message_rowid is required");
  const result = text.trim();
  if (!/^\d+$/.test(result)) throw new HttpError(422, "message_rowid must be a positive integer");
  return result;
}

export function positiveInteger(value: unknown, field: string): number {
  if (value === undefined || value === null || value === "") {
    throw new HttpError(422, `${field} is required`);
  }
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, 0, field);
}

export function boundedInteger(
  value: unknown,
  lower: number,
  upper: number,
  fallback: number,
  field = "limit"
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < lower || number > upper) {
    throw new HttpError(422, `${field} must be an integer between ${lower} and ${upper}`);
  }
  return number;
}

export function isPreviewable(mediaType: string | undefined, mimeType: string | undefined): boolean {
  const type = (mediaType ?? "").trim().toLowerCase();
  if (type === "photo" || type === "sticker") return true;
  return (mimeType ?? "").trim().toLowerCase().startsWith("image/");
}

function buildMediaItems(row: MessageRecord): MediaItem[] {
  const albumItems = row.albumRows
    .filter((album) => isPreviewable(album.mediaType, album.mimeType))
    .map(albumItem);
  const fileItems = row.mediaFiles
    .filter((file) => isPreviewable(file.mediaType, file.mimeType))
    .map(fileItem);

  if (albumItems.length > fileItems.length) return albumItems;
  if (fileItems.length) return fileItems;
  if (isPreviewable(row.mediaType, row.mimeType)) {
    return [{
      id: null,
      media_url: `/api/messages/${row.rowId}/media`,
      media_type: row.mediaType ?? null,
      mime_type: row.mimeType ?? null
    }];
  }
  return [];
}

function albumItem(album: AlbumRow): MediaItem {
  return {
    id: null,
    message_id: album.messageId,
    message_rowid: album.rowId,
    media_url: `/api/messages/${album.rowId}/media`,
    media_type: album.mediaType ?? album.messageType ?? null,
    mime_type: album.mimeType ?? null
  };
}

function fileItem(file: StoredMediaFile): MediaItem {
  return {
    id: file.id,
    message_id: file.messageId,
    media_url: `/api/media-files/${file.id}`,
    media_type: file.mediaType ?? null,
    mime_type: file.mimeType ?? null
  };
}

function serializeMediaFile(file: StoredMediaFile): SerializedMediaFile {
  return {
    id: file.id,
    message_id: file.messageId,
    chat_id: file.chatId,
    media_type: file.mediaType ?? null,
    mime_type: file.mimeType ?? null
  };
}

function serializeAlbumRow(row: AlbumRow): SerializedAlbumRow {
  return {
    id: row.rowId,
    message_id: row.messageId,
    chat_id: row.chatId,
    grouped_id: row.groupedId,
    date: row.date,
    has_media: row.hasMedia,
    media_type: row.mediaType ?? null,
    message_type: row.messageType ?? null,
    mime_type: row.mimeType ?? null
  };
}

function requireTimeMode(value: string): TimeMode {
  if (value !== "include" && value !== "exclude" && value !== "off") {
    throw new HttpError(422, `invalid time mode: ${value}`);
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}