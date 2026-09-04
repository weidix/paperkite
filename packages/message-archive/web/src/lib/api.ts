import type {
  ArchiveContextResult,
  ArchiveSearchResult,
  MessageRecord,
  StoredMediaFile,
  TimeMode
} from "$lib/model";

export type { TimeMode };

export interface ArchiveState {
  readonly backend: string;
  readonly session: string | null;
  readonly mediaRoot: string | null;
}

export interface ChatLedger {
  readonly chatId: string;
  readonly title: string;
  readonly username?: string;
  readonly type?: string;
  readonly count: number;
  readonly lastDate?: string;
  readonly lastText?: string;
}

export interface ChatsResult {
  readonly chats: readonly ChatLedger[];
  readonly capped: boolean;
}

export interface MediaMeta {
  readonly file: StoredMediaFile;
  readonly onDisk: boolean;
}

export interface SearchQuery {
  q?: string;
  chat?: string;
  chatTitle?: string;
  from?: string;
  to?: string;
  mode?: TimeMode;
  limit?: number;
  offset?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function mediaDiskUrl(id: string): string {
  return `/api/mediafiles/${id}/file`;
}

export function mediaLiveUrl(id: string): string {
  return `/api/mediafiles/${id}/live`;
}

/** 未落盘媒体按消息行在线取回（图源 Telegram 会话）。 */
export function mediaLiveThumbUrl(rowId: string): string {
  return `/api/messages/${rowId}/thumb`;
}

export function mediaDownloadUrl(id: string, source: "file" | "live"): string {
  return `${source === "file" ? mediaDiskUrl(id) : mediaLiveUrl(id)}?download=1`;
}

export async function fetchState(): Promise<ArchiveState> {
  return request("/api/state");
}

export async function searchMessages(query: SearchQuery): Promise<ArchiveSearchResult> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.chat) params.set("chat", query.chat);
  if (query.chatTitle) params.set("chatTitle", query.chatTitle);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.mode && query.mode !== "include") params.set("timeMode", query.mode);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  return request(`/api/search?${params}`);
}

export async function fetchMessage(rowId: string): Promise<MessageRecord> {
  return request(`/api/messages/${rowId}`);
}

export async function fetchContext(
  rowId: string,
  before: number,
  after: number,
  beforeOffset = 0,
  afterOffset = 0
): Promise<ArchiveContextResult> {
  return request(`/api/messages/${rowId}/context?before=${before}&after=${after}&beforeOffset=${beforeOffset}&afterOffset=${afterOffset}`);
}

export async function fetchChats(): Promise<ChatsResult> {
  return request("/api/chats");
}

export async function fetchMediaMeta(id: string): Promise<MediaMeta> {
  return request(`/api/mediafiles/${id}`);
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String(body.error)
      : `请求失败 (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}