import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { utils } from "telegram";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveClient, TelegramMessage } from "../archiver.js";
import type { StoredMediaFile } from "../storage/index.js";

export interface LiveMediaResult {
  readonly bytes: Buffer;
  readonly mime: string;
}

/** 在线取回结果：ok 带字节流；missing 表示目标会话/消息已不可达（消息被删等常态情形）。 */
export type LiveMediaOutcome =
  | ({ readonly ok: true } & LiveMediaResult)
  | { readonly ok: false; readonly missing: boolean };

export interface LiveMediaOptions {
  /** 归档 chats 表里的会话句柄，供在线取回冷启动时解析实体。 */
  readonly chatUsername?: string;
  readonly logger: RuntimeLogger;
}

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar"
};

/** 落盘路径解析：配置 mediaRoot 时限定其内，否则相对进程工作目录解析。 */
export function resolveMediaPath(raw: string | undefined, mediaRoot: string | undefined): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const root = mediaRoot?.trim() ? resolve(mediaRoot) : undefined;
  const path = root ? resolve(root, text) : resolve(process.cwd(), text);
  if (root && path !== root && !path.startsWith(root + sep)) return undefined;
  return path;
}

export function mimeFromName(path: string): string {
  return EXT_MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** MIME 反查扩展名（用于在线取回媒体的下载命名）。 */
export function extFromMime(mime: string): string {
  return Object.entries(EXT_MIME).find(([, value]) => value === mime)?.[0] ?? "";
}

export function fileNameOf(file: StoredMediaFile, path: string): string {
  const name = file.fileName?.trim().replace(/["\\]/g, "_");
  if (name) return name;
  const base = path.split("/").pop()?.split("\\").pop();
  return base || `media_${file.id}`;
}

export function parseRange(header: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return undefined;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "") {
    if (endText === "") return undefined;
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isInteger(start) || start < 0 || start >= size) return undefined;
  if (endText === "") return { start, end: size - 1 };
  const end = Math.min(Number(endText), size - 1);
  if (!Number.isInteger(end) || end < start) return undefined;
  return { start, end };
}

/** 经注入会话从 Telegram 取回未落盘媒体；消息/媒体不可得时返回不可用结果。 */
export async function fetchLiveMedia(
  file: StoredMediaFile,
  sessions: SessionAccess,
  session: string,
  options: LiveMediaOptions
): Promise<LiveMediaOutcome> {
  const { chatUsername, logger } = options;
  try {
    const result = await sessions.run(session, async (client) => {
      const host = client as ArchiveClient;
      const message = await fetchMessage(host, file, chatUsername);
      if (!message) return { state: "missing" as const };
      if (!message.media) return { state: "unavailable" as const };
      const bytes = await host.downloadMedia(message, {});
      if (bytes === undefined) return { state: "unavailable" as const };
      return { state: "ok" as const, bytes, mime: liveMediaMime(message) };
    });
    if (result.state === "missing") return { ok: false, missing: true };
    if (result.state === "unavailable") return { ok: false, missing: false };
    const buffer = result.bytes instanceof Buffer ? result.bytes : await readFile(result.bytes);
    return { ok: true, bytes: buffer, mime: result.mime };
  } catch (error) {
    const missing = isMissingPeer(error);
    if (missing) {
      logger.debug("live media peer missing for message " + file.messageId + ", likely deleted");
    } else {
      logger.warn("live media fetch failed for message " + file.messageId, error);
    }
    return { ok: false, missing };
  }
}

/**
 * 取回目标消息。冷启动会话没有实体缓存时，先按归档用户名解析实体再重试；
 * 解析不到（渠道私密/不可达）时抛出原始错误，由缺失判定统一归类。
 */
async function fetchMessage(
  host: ArchiveClient,
  file: StoredMediaFile,
  chatUsername: string | undefined
): Promise<TelegramMessage | undefined> {
  try {
    return await fetchById(host, file, file.chatId);
  } catch (error) {
    if (!isUnresolvedEntityError(error)) throw error;
    const entity = await resolveChatEntity(host, file, chatUsername);
    if (entity === undefined) throw error;
    return fetchById(host, file, entity);
  }
}

async function fetchById(
  host: ArchiveClient,
  file: StoredMediaFile,
  entity: unknown
): Promise<TelegramMessage | undefined> {
  const messages = await host.getMessages(entity, { ids: [file.messageId] });
  return messages.find((item) => item !== undefined && item !== null && item.id === file.messageId);
}

/** 按归档用户名解析，失败后回退到会话清单扫描；返回与归档 chatId 匹配的实体。 */
async function resolveChatEntity(
  host: ArchiveClient,
  file: StoredMediaFile,
  chatUsername: string | undefined
): Promise<unknown | undefined> {
  const handle = chatUsername?.trim().replace(/^@/, "");
  if (handle) {
    try {
      const entity = await host.getEntity("@" + handle);
      if (peerIdOf(entity) === file.chatId) return entity;
    } catch (error) {
      // 句柄失效（删除/更名/私密），继续尝试会话清单
    }
  }
  try {
    for await (const dialog of host.iterDialogs()) {
      const entity = dialog.entity;
      if (entity !== undefined && entity !== null && peerIdOf(entity) === file.chatId) return entity;
    }
  } catch (error) {
    // 会话清单不可迭代时按解析失败处理
  }
  return undefined;
}

function peerIdOf(entity: unknown): string {
  try {
    return String(utils.getPeerId(entity as Parameters<typeof utils.getPeerId>[0]));
  } catch {
    return "";
  }
}

/** 会话/消息已删除或对当前账号不可见时的典型错误。 */
function isMissingPeer(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find (the )?input entity|could not find the entity|CHANNEL_PRIVATE|CHANNEL_INVALID|CHANNEL_FORBIDDEN|CHAT_FORBIDDEN|chat (was )?not found|peer id is invalid/i.test(message);
}

/** gramjs 本地实体缓存缺失、尚可尝试解析的错误。 */
function isUnresolvedEntityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find (the )?input entity/i.test(message);
}

function liveMediaMime(message: TelegramMessage): string {
  const media = message.media;
  if (className(media) === "MessageMediaPhoto") return "image/jpeg";
  if (className(media) === "MessageMediaDocument") {
    const document = recordOf(recordOf(media)?.document);
    const mime = document?.mimeType;
    if (typeof mime === "string" && mime.trim()) return mime.trim();
  }
  return "application/octet-stream";
}

function className(value: unknown): string {
  if (value === null || value === undefined) return "";
  const record = recordOf(value);
  if (record && typeof record.className === "string" && record.className) return record.className;
  return (value as { constructor?: { name?: string } }).constructor?.name ?? "";
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export interface DiskMediaInfo {
  readonly path: string;
  readonly size: number;
}

export async function diskMediaInfo(
  file: StoredMediaFile,
  mediaRoot: string | undefined
): Promise<DiskMediaInfo | undefined> {
  const path = resolveMediaPath(file.filePath, mediaRoot);
  if (!path) return undefined;
  try {
    const info = await stat(path);
    return info.isFile() ? { path, size: info.size } : undefined;
  } catch {
    return undefined;
  }
}