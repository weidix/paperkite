import type {
  ArchiveContextResult,
  ArchiveSearchResult,
  MessageEntity,
  MessageRecord,
  ReplyChainResult,
  SenderQuery,
  SenderSearchResult,
  SenderSummary,
  StoredMediaFile,
  TimeMode
} from "$lib/model";

export type { TimeMode };

export interface ArchiveState {
  readonly backend: string;
  readonly session: string | null;
  readonly mediaDir: string | null;
  readonly blockwords: {
    readonly version: number;
    readonly count: number;
  };
  readonly blockedUsers: {
    readonly version: number;
    readonly count: number;
  };
}

/** 屏蔽词列表快照（服务端内存缓存，读路径不触表）。 */
export interface BlockwordState {
  readonly words: readonly string[];
  readonly version: number;
}

/** 屏蔽用户名单快照（带展示信息，供管理界面使用）。 */
export interface BlockedUserInfo {
  readonly userId: string;
  readonly name?: string;
  readonly username?: string;
}

export interface BlockedUserState {
  readonly users: readonly BlockedUserInfo[];
  readonly version: number;
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
  chatIds?: readonly string[];
  chatTitle?: string;
  from?: string;
  to?: string;
  mode?: TimeMode;
  users?: readonly string[];
  forwardFrom?: string;
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

/** 未落盘媒体按消息行取回：size=thumb 为 Telegram 原生缩略图，size=full 为整图在线取回。 */
export function mediaRowUrl(recordId: string, size: "thumb" | "full" = "thumb"): string {
  return `/api/messages/${recordId}/thumb?size=${size}`;
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
  if (query.chatIds?.length) params.set("chat", query.chatIds.join(","));
  if (query.chatTitle) params.set("chatTitle", query.chatTitle);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.mode && query.mode !== "include") params.set("timeMode", query.mode);
  if (query.users?.length) params.set("users", query.users.join(","));
  if (query.forwardFrom) params.set("forwardFrom", query.forwardFrom);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  return request(`/api/search?${params}`);
}

export async function fetchMessage(recordId: string): Promise<MessageRecord> {
  return request(`/api/messages/${recordId}`);
}

export async function fetchContext(
  recordId: string,
  before: number,
  after: number,
  beforeOffset = 0,
  afterOffset = 0
): Promise<ArchiveContextResult> {
  return request(`/api/messages/${recordId}/context?before=${before}&after=${after}&beforeOffset=${beforeOffset}&afterOffset=${afterOffset}`);
}

export async function fetchChats(): Promise<ChatsResult> {
  return request("/api/chats");
}

export async function searchSenders(query: SenderQuery): Promise<SenderSearchResult> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.chatId) params.set("chat", query.chatId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  return request(`/api/senders?${params}`);
}

export async function fetchSenderSummary(senderId: string, chatId?: string): Promise<SenderSummary> {
  const params = new URLSearchParams();
  if (chatId) params.set("chat", chatId);
  const suffix = params.size ? `?${params}` : "";
  return request(`/api/senders/${encodeURIComponent(senderId)}/summary${suffix}`);
}

export async function fetchReplyChain(recordId: string): Promise<ReplyChainResult> {
  return request(`/api/messages/${recordId}/replies`);
}

/** 在线说明：从 Telegram 实时取回原始文本与实体（归档缺实体时用于补显）。 */
export async function fetchLiveText(recordId: string): Promise<{ text: string; entities?: readonly MessageEntity[] }> {
  return request(`/api/messages/${recordId}/live-text`);
}

export async function fetchMediaMeta(id: string): Promise<MediaMeta> {
  return request(`/api/mediafiles/${id}`);
}

export async function fetchBlockwords(): Promise<BlockwordState> {
  return request("/api/blockwords");
}

export async function addBlockword(word: string): Promise<BlockwordState> {
  return request("/api/blockwords", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ word })
  });
}

export async function removeBlockword(word: string): Promise<BlockwordState> {
  return request(`/api/blockwords/${encodeURIComponent(word)}`, { method: "DELETE" });
}

export async function fetchBlockedUsers(): Promise<BlockedUserState> {
  return request("/api/blockedusers");
}

export async function addBlockedUser(input: BlockedUserInfo): Promise<BlockedUserState> {
  return request("/api/blockedusers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function removeBlockedUser(userId: string): Promise<BlockedUserState> {
  return request(`/api/blockedusers/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String(body.error)
      : `请求失败 (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}