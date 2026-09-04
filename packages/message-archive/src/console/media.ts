import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { TelegramMessage } from "../archiver.js";
import type { StoredMediaFile } from "../storage/index.js";

export interface LiveMediaClient {
  getMessages(chatId: string, options: { ids: readonly number[] }): Promise<readonly TelegramMessage[]>;
  downloadMedia(message: TelegramMessage, options?: { outputFile?: string }): Promise<Buffer | string | undefined>;
}

export interface LiveMediaResult {
  readonly bytes: Buffer;
  readonly mime: string;
}

/** 在线取回结果：ok 带字节流；missing 表示目标会话/消息已不可达（消息被删等常态情形）。 */
export type LiveMediaOutcome =
  | ({ readonly ok: true } & LiveMediaResult)
  | { readonly ok: false; readonly missing: boolean };

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

/** 经注入会话从 Telegram 取回未落盘媒体；message 缺失或下载失败时返回不可用结果。 */
export async function fetchLiveMedia(
  file: StoredMediaFile,
  sessions: SessionAccess,
  session: string,
  logger: RuntimeLogger
): Promise<LiveMediaOutcome> {
  try {
    const result = await sessions.run(session, async (client) => {
      const host = client as LiveMediaClient;
      const messages = await host.getMessages(file.chatId, { ids: [file.messageId] });
      const message = messages.find((item) => item.id === file.messageId);
      if (!message || !message.media) return undefined;
      const bytes = await host.downloadMedia(message);
      return { bytes, mime: liveMediaMime(message) };
    });
    if (!result) return { ok: false, missing: false };
    if (result.bytes === undefined) return { ok: false, missing: false };
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

/** 会话/消息已删除或对当前账号不可见时的典型错误。 */
function isMissingPeer(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find (the )?input entity|could not find the entity|CHANNEL_PRIVATE|CHANNEL_INVALID|chat (was )?not found|peer id is invalid/i.test(message);
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