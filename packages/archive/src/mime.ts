/**
 * 媒体类型判定：Telegram 常把视频、音频等文档报成 application/octet-stream，
 * 落库的 mime 因此不足以决定能否在线播放。这里按「显式 mime → 文件名扩展名 → 字节魔数」
 * 依次兜底，得到可用于预览分流的具体类型。
 */

/** 扩展名 ↔ MIME；同时用于推断与反查下载扩展名。 */
const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".ts": "video/mp2t",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar"
};

/** 无法据此分流预览的占位类型。 */
const OPAQUE_MIME = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/unknown",
  "application/x-unknown",
  "unknown/unknown"
]);

/** 文件名（含路径）的扩展名，小写带点；无扩展名返回空串。 */
export function extensionOf(name: string | undefined): string {
  const text = name?.trim() ?? "";
  if (!text) return "";
  const base = text.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot).toLowerCase();
  return /^\.[a-z0-9]+$/.test(ext) ? ext : "";
}

/** 缺值或占位类型都视为不透明，不能直接用于预览分流。 */
export function isOpaqueMime(mime: string | undefined): boolean {
  const value = mime?.trim().toLowerCase() ?? "";
  return value === "" || OPAQUE_MIME.has(value);
}

/** 按名称推断 MIME；无法识别返回 undefined。 */
export function mimeFromName(name: string | undefined): string | undefined {
  const ext = extensionOf(name);
  return ext ? EXT_MIME[ext] : undefined;
}

/** MIME 反查扩展名（用于在线取回媒体的下载命名）。 */
export function extFromMime(mime: string): string {
  const value = mime.trim().toLowerCase();
  return Object.entries(EXT_MIME).find(([, candidate]) => candidate === value)?.[0] ?? "";
}

/** 显式 mime 可用时以其为准，否则按候选名称逐个推断；都不可得时返回原值。 */
export function resolveMime(stored: string | undefined, ...names: (string | undefined)[]): string | undefined {
  const value = stored?.trim();
  if (!isOpaqueMime(value)) return value;
  for (const name of names) {
    const derived = mimeFromName(name);
    if (derived) return derived;
  }
  return value || undefined;
}

/** 容器魔数 → MIME：仅覆盖无需解码即可判定的常见格式。 */
export function sniffMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 12 && asciiOf(bytes, 4, 8) === "ftyp") return containerOf(bytes) ?? "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return bytes.length >= 5 && bytes[4] === 0x42 ? "video/x-matroska" : "video/webm";
  }
  if (bytes.length >= 12 && asciiOf(bytes, 0, 4) === "RIFF") {
    const form = asciiOf(bytes, 8, 12);
    if (form === "WEBP") return "image/webp";
    if (form === "AVI ") return "video/x-msvideo";
    if (form === "WAVE") return "audio/wav";
  }
  if (bytes.length >= 4 && asciiOf(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 3 && asciiOf(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && asciiOf(bytes, 1, 4) === "PNG") return "image/png";
  if (bytes.length >= 6 && asciiOf(bytes, 0, 3) === "GIF") return "image/gif";
  if (bytes.length >= 4 && bytes[0] === 0x25 && asciiOf(bytes, 1, 4) === "PDF") return "application/pdf";
  return undefined;
}

/** ISO BMFF 分支：ftyp 品牌决定视频还是音频。 */
function containerOf(bytes: Buffer): string | undefined {
  const brand = asciiOf(bytes, 8, 12);
  if (brand.startsWith("M4A") || brand.startsWith("mp4a") || brand.startsWith("M4B")) return "audio/mp4";
  if (brand.startsWith("qt")) return "video/quicktime";
  return undefined;
}

function asciiOf(bytes: Buffer, start: number, end: number): string {
  if (bytes.length < end) return "";
  return bytes.toString("latin1", start, end);
}
