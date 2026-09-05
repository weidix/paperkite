import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { utils } from "telegram";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveClient, TelegramMessage, ThumbParam } from "../archiver.js";
import type { StoredMediaFile } from "../storage/index.js";

export interface LiveMediaResult {
  readonly bytes: Buffer;
  readonly mime: string;
}

/** 在线取回结果：ok 带字节流；missing 表示目标会话/消息已不可达（消息被删等常态情形）。 */
export type LiveMediaOutcome =
  | ({ readonly ok: true } & LiveMediaResult)
  | { readonly ok: false; readonly missing: boolean };

/** 在线缩略图结果：noThumb 表示媒体有缩略图可用的判定失败（文档类无 thumbs）。 */
export type LiveThumbOutcome =
  | ({ readonly ok: true } & LiveMediaResult)
  | { readonly ok: false; readonly missing: boolean; readonly noThumb?: boolean };

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

/** 缩略图规格：thumb 为 GramJS 原生下载参数；无缩略图但属图片类时以整图回退。 */
interface ThumbSpec {
  readonly thumb: ThumbParam | undefined;
  readonly mime: string;
}

/** photo 的最小可用 sizeType 次序（GramJS sizeTypes 中同序的最小两档）。 */
const PHOTO_THUMB_TYPES = ["s", "m"] as const;

/**
 * 在线取回原生缩略图：photo 用最小可用 size，document 系用 videoThumbs/thumbs 首项；
 * 图片类无任何 size 时回退整图，其余类型（无 thumbs 的文档/音频等）报告 noThumb。
 */
export async function fetchLiveThumb(
  file: StoredMediaFile,
  sessions: SessionAccess,
  session: string,
  options: LiveMediaOptions
): Promise<LiveThumbOutcome> {
  const { chatUsername, logger } = options;
  try {
    const result = await sessions.run(session, async (client) => {
      const host = client as ArchiveClient;
      const message = await fetchMessage(host, file, chatUsername);
      if (!message) return { state: "missing" as const };
      if (!message.media) return { state: "unavailable" as const };
      const spec = thumbSpecOf(unwrapWebPage(message.media));
      if (spec === undefined) return { state: "no-thumb" as const };
      if (spec.thumb === undefined) {
        const bytes = await host.downloadMedia(message, {});
        if (bytes === undefined) return { state: "unavailable" as const };
        return { state: "ok" as const, bytes, mime: liveMediaMime(message) };
      }
      const bytes = await host.downloadMedia(message, { thumb: spec.thumb });
      if (bytes === undefined || (Buffer.isBuffer(bytes) && bytes.length === 0)) {
        return { state: "unavailable" as const };
      }
      return { state: "ok" as const, bytes, mime: spec.mime };
    });
    if (result.state === "missing") return { ok: false, missing: true };
    if (result.state === "no-thumb") return { ok: false, missing: false, noThumb: true };
    if (result.state === "unavailable") return { ok: false, missing: false };
    const buffer = result.bytes instanceof Buffer ? result.bytes : await readFile(result.bytes);
    return { ok: true, bytes: buffer, mime: snifImageMime(buffer) ?? result.mime };
  } catch (error) {
    const missing = isMissingPeer(error);
    if (missing) {
      logger.debug("live media peer missing for message " + file.messageId + ", likely deleted");
    } else {
      logger.warn("live media thumb fetch failed for message " + file.messageId, error);
    }
    return { ok: false, missing };
  }
}

function thumbSpecOf(media: unknown): ThumbSpec | undefined {
  const name = className(media);
  if (name === "MessageMediaPhoto") {
    const photo = recordOf(recordOf(media)?.photo);
    const sizes = [...arrayOf(photo?.sizes), ...arrayOf(photo?.videoSizes)];
    const size = pickPhotoThumb(sizes);
    return { thumb: size === undefined ? undefined : typeOf(size) ?? size, mime: "image/jpeg" };
  }
  if (name === "MessageMediaDocument") {
    const document = recordOf(recordOf(media)?.document);
    if (document === undefined) return undefined;
    const videoThumbs = arrayOf(document.videoThumbs);
    if (videoThumbs.length > 0) return { thumb: videoThumbs[0]!, mime: "image/jpeg" };
    const size = arrayOf(document.thumbs).find(isUsableThumb);
    if (size === undefined) return undefined;
    return { thumb: typeOf(size) ?? size, mime: "image/jpeg" };
  }
  return undefined;
}

/** 消息内嵌网页链接的媒体（链接卡片图），解开到内部 photo/document 再判定。 */
function unwrapWebPage(media: unknown): unknown {
  if (className(media) !== "MessageMediaWebPage") return media;
  const webpage = recordOf(recordOf(media)?.webpage);
  if (webpage === undefined) return media;
  return webpage.document ?? webpage.photo ?? media;
}

/** 按 sizeType 优先取最小可用 photo size；无匹配时按字节量取最小项。 */
function pickPhotoThumb(sizes: readonly unknown[]): unknown | undefined {
  for (const type of PHOTO_THUMB_TYPES) {
    const size = sizes.find((item) => typeOf(item) === type && isUsableThumb(item));
    if (size !== undefined) return size;
  }
  return smallestThumb(sizes);
}

function smallestThumb(thumbs: readonly unknown[]): unknown | undefined {
  const usable = thumbs.filter(isUsableThumb);
  if (usable.length === 0) return undefined;
  return usable.reduce((best, item) => (thumbWeight(item) < thumbWeight(best) ? item : best));
}

function isUsableThumb(value: unknown): boolean {
  const name = className(value);
  return name !== "PhotoSizeEmpty" && name !== "PhotoPathSize";
}

function typeOf(value: unknown): string | undefined {
  const record = recordOf(value);
  return record && typeof record.type === "string" && record.type ? record.type : undefined;
}

/** 与 gramjs getThumb 排序一致的最小化权重：越小越接近最小缩略图。 */
function thumbWeight(value: unknown): number {
  const record = recordOf(value);
  if (record === undefined) return 0;
  switch (className(value)) {
    case "PhotoStrippedSize":
    case "PhotoCachedSize":
      return numberValue((record.bytes as { readonly length?: unknown } | undefined)?.length) ?? 0;
    case "PhotoSize":
      return numberValue(record.size) ?? 0;
    case "PhotoSizeProgressive": {
      const sizes = arrayOf(record.sizes).map((item) => numberValue(item) ?? 0);
      return sizes.length > 0 ? Math.max(...sizes) : 0;
    }
    case "VideoSize":
      return numberValue(record.size) ?? 0;
    default:
      return 0;
  }
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** 贴纸/动图缩略图常以 webp 字节返回：按魔数修正 content-type。 */
function snifImageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/gif";
  return undefined;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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