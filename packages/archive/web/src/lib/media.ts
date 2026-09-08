import {
  fetchMediaMeta,
  mediaDiskUrl,
  mediaDownloadUrl,
  mediaLiveUrl,
  mediaRowUrl
} from "$lib/api";
import type { AlbumContextEntry, MessageRecord, StoredMediaFile } from "$lib/model";
import { showLightbox, type LightboxItem } from "$lib/state.svelte";

/** 媒体视觉类型：image/video 出缩略图，audio/file 出图标。 */
export type MediaKind = "image" | "video" | "audio" | "file";

/** 落盘文件的类型判定：mime 优先，照片/贴纸/动图按图片处理。 */
export function kindOfFile(file: StoredMediaFile): MediaKind {
  const mime = file.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const type = file.mediaType;
  if (type === "photo" || type === "sticker" || type === "animation") return "image";
  if (type === "video") return "video";
  return "file";
}

/** 消息行类型判定：与 kindOfFile 同序，供未落盘行使用。 */
export function kindOfRow(row: { mediaType?: string; mimeType?: string }): MediaKind {
  const mime = row.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const type = row.mediaType ?? "";
  if (type === "photo" || type === "sticker" || type === "animation") return "image";
  if (type === "video") return "video";
  return "file";
}

/** 行内缩略图规格：url 存在时直接出图，否则按类型画图标。 */
export interface RowThumb {
  readonly kind: MediaKind;
  readonly url?: string;
}

/** 消息行缩略图：优先落盘文件，未落盘的 image/video 用原生缩略图。 */
export function fileThumbOf(record: MessageRecord): RowThumb {
  const file = record.mediaFiles[0];
  if (file !== undefined) return { kind: kindOfFile(file), url: mediaDiskUrl(file.id) };
  return rowThumbOf(record);
}

export function rowThumbOf(row: { recordId: string; hasMedia: boolean; mediaType?: string; mimeType?: string }): RowThumb {
  const kind = kindOfRow(row);
  if (!row.hasMedia || (kind !== "image" && kind !== "video")) return { kind };
  return { kind, url: mediaRowUrl(row.recordId) };
}

/** 预览 mime：库里缺 mime 时按媒体类型给占位，保证预览分支正确分流。 */
export function previewMimeOf(value: { readonly mimeType?: string; readonly mediaType?: string }): string {
  const mime = value.mimeType?.trim();
  if (mime) return mime;
  switch (value.mediaType) {
    case "video": return "video/mp4";
    case "audio": return "audio/mpeg";
    case "animation": return "image/gif";
    default: return "application/octet-stream";
  }
}

/** 预览器条目：落盘文件优先，否则走消息行整图在线取回。 */
export function lightboxItemsOf(record: MessageRecord): LightboxItem[] {
  if (record.mediaFiles.length > 0) return record.mediaFiles.map(itemForFile);
  if (record.hasMedia) return [itemForRow(record)];
  return [];
}

/** 相册预览序列：跨行展平全部媒体项与每行起始序号。 */
export function albumLightboxItems(entry: AlbumContextEntry): { items: LightboxItem[]; starts: number[] } {
  const items: LightboxItem[] = [];
  const starts: number[] = [];
  for (const row of entry.rows) {
    starts.push(items.length);
    items.push(...lightboxItemsOf(row));
  }
  return { items, starts };
}

export function openMessageLightbox(record: MessageRecord, index = 0): void {
  const items = lightboxItemsOf(record);
  if (items.length === 0) return;
  showLightbox(items, Math.min(index, items.length - 1));
}

/** 相册整体进预览器；rowIndex 指向相册内第几行。 */
export function openAlbumLightbox(entry: AlbumContextEntry, rowIndex = 0): void {
  const { items, starts } = albumLightboxItems(entry);
  if (items.length === 0) return;
  showLightbox(items, starts[Math.min(rowIndex, starts.length - 1)] ?? 0);
}

function itemForFile(file: StoredMediaFile): LightboxItem {
  return {
    name: file.fileName ?? `media_${file.id}`,
    mime: file.mimeType ?? "",
    size: file.fileSize,
    spec: file.mediaType,
    load: () => loadPreview(file)
  };
}

function itemForRow(row: { recordId: string; messageId: number; mediaType?: string; mimeType?: string }): LightboxItem {
  const kind = kindOfRow(row);
  const mime = previewMimeOf(row);
  const url = mediaRowUrl(row.recordId, "full");
  return {
    name: `media_${row.messageId}`,
    mime,
    size: undefined,
    spec: row.mediaType ?? "",
    load: () => (kind === "image" ? loadLiveBlob(url) : Promise.resolve(directLive(url, mime)))
  };
}

async function loadPreview(file: StoredMediaFile): Promise<{ url: string; source: "落盘" | "在线"; mime?: string; downloadUrl?: string }> {
  try {
    const meta = await fetchMediaMeta(file.id);
    if (meta.onDisk) {
      return { url: mediaDiskUrl(file.id), source: "落盘", mime: file.mimeType ?? "", downloadUrl: mediaDownloadUrl(file.id, "file") };
    }
  } catch {
    // 元数据不可得时按在线取回处理
  }
  const url = mediaLiveUrl(file.id);
  if (kindOfFile(file) === "image") return loadLiveBlob(url);
  return directLive(url, previewMimeOf(file));
}

/** 在线直接取回：媒体元素直连流式端点，边下边播并支持拖动。 */
function directLive(path: string, mime: string): { url: string; source: "在线"; mime: string; downloadUrl: string } {
  return {
    url: path,
    source: "在线",
    mime,
    downloadUrl: `${path}${path.includes("?") ? "&" : "?"}download=1`
  };
}

/** 在线取回并转 object URL；mime 取响应头，供预览按实际内容分流。 */
async function loadLiveBlob(path: string): Promise<{ url: string; source: "落盘" | "在线"; mime: string; downloadUrl: string }> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`取回失败 (${res.status})`);
  const blob = await res.blob();
  const mime = res.headers.get("content-type") ?? (blob.type || "application/octet-stream");
  return {
    url: URL.createObjectURL(blob),
    source: "在线",
    mime,
    downloadUrl: `${path}${path.includes("?") ? "&" : "?"}download=1`
  };
}