import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { SessionAccess } from "@paperkite/sdk";
import type { ArchiveStore } from "../storage/index.js";
import { HttpError } from "./errors.js";
import { isPreviewable, type MediaItem } from "./serializer.js";

export interface LiveTelegramMessage {
  readonly id: number;
  readonly media?: unknown;
  readonly groupedId?: unknown;
}

export interface LiveTelegramClient {
  getMessages(entity: unknown, options: { ids: readonly number[] }): Promise<readonly LiveTelegramMessage[]>;
  downloadMedia(message: LiveTelegramMessage, options: Record<string, unknown>): Promise<Buffer | string | undefined>;
}

interface DownloadedPreview {
  readonly data: Buffer;
  readonly contentType: string;
}

export class LiveMediaService {
  constructor(
    private readonly store: ArchiveStore,
    private readonly sessionName: string | undefined,
    private readonly sessions: SessionAccess | undefined
  ) {}

  get available(): boolean {
    return this.sessionName !== undefined && this.sessions !== undefined;
  }

  async fetchPreview(rowId: string): Promise<DownloadedPreview> {
    const row = await this.store.getMessageByRowId(rowId);
    if (!row) throw new HttpError(404, "message media not found");
    if (!row.hasMedia) throw new HttpError(415, "message has no media");
    return this.download(row.chatId, row.messageId);
  }

  async fetchChatMessage(chatId: string, messageId: number): Promise<DownloadedPreview> {
    return this.download(chatId, messageId);
  }

  async fetchAlbum(rowId: string): Promise<MediaItem[]> {
    const row = await this.store.getMessageByRowId(rowId);
    if (!row) throw new HttpError(404, "message album not found");
    if (!row.hasMedia) throw new HttpError(415, "message has no media");

    const chatId = row.chatId;
    const messageId = row.messageId;
    return this.run(async (client) => {
      const anchor = (await client.getMessages(chatId, { ids: [messageId] })).find(Boolean);
      if (!anchor?.media) throw new HttpError(404, "message album not found");

      const anchorPayload = previewPayload(chatId, anchor);
      if (!anchorPayload) throw new HttpError(415, "media is not previewable");

      const groupedId = anchor.groupedId;
      if (groupedId === undefined || groupedId === null) return [anchorPayload];

      const startId = Math.max(messageId - 20, 1);
      const candidates = await client.getMessages(chatId, { ids: range(startId, messageId + 20) });
      const items: MediaItem[] = [];
      const seen = new Set<number>();
      for (const candidate of candidates) {
        if (!candidate || !candidate.media || candidate.groupedId !== groupedId) continue;
        const payload = previewPayload(chatId, candidate);
        if (!payload || payload.message_id === undefined || payload.message_id === null) continue;
        if (seen.has(payload.message_id)) continue;
        seen.add(payload.message_id);
        items.push(payload);
      }
      items.sort((left, right) => Number(left.message_id) - Number(right.message_id));
      return items.length ? items : [anchorPayload];
    });
  }

  async resolveMediaFile(id: string): Promise<{ path: string; contentType: string } | undefined> {
    const media = await this.store.getMediaFileById(id);
    if (!media) return undefined;
    if (!isPreviewable(media.mediaType, media.mimeType)) throw new HttpError(415, "media is not previewable");
    if (!media.filePath) return undefined;

    const path = resolve(media.filePath);
    try {
      const details = await stat(path);
      if (!details.isFile()) return undefined;
    } catch {
      return undefined;
    }
    return { path, contentType: (media.mimeType ?? "").trim().toLowerCase() || "image/jpeg" };
  }

  private async download(chatId: string, messageId: number): Promise<DownloadedPreview> {
    return this.run(async (client) => {
      const message = (await client.getMessages(chatId, { ids: [messageId] })).find(Boolean);
      if (!message?.media) throw new HttpError(404, "message media not found");

      const preview = previewPayload(chatId, message);
      if (!preview) throw new HttpError(415, "media is not previewable");
      const data = await client.downloadMedia(message, {});
      if (!data) throw new HttpError(404, "message media not found");
      return { data: toBuffer(data), contentType: mimeFor(preview) };
    });
  }

  private async run<T>(operation: (client: LiveTelegramClient) => Promise<T>): Promise<T> {
    if (!this.sessions || !this.sessionName) {
      throw new HttpError(503, "message media service is unavailable");
    }
    return this.sessions.run(this.sessionName, (client: unknown) => operation(client as LiveTelegramClient));
  }
}

function previewPayload(chatId: string, message: LiveTelegramMessage): MediaItem | undefined {
  const media = message.media;
  if (!media) return undefined;
  if (className(media) === "MessageMediaPhoto") {
    return photoPayload(chatId, message.id);
  }
  if (className(media) === "MessageMediaDocument") {
    const record = asRecord(media);
    const document = asRecord(record?.document) ?? {};
    const mimeType = (document.mimeType ?? document.mime_type ?? "").toString().trim().toLowerCase();
    const isSticker = Array.isArray(document.attributes) &&
      document.attributes.some((attribute) => className(attribute) === "DocumentAttributeSticker");
    if (!isSticker && !mimeType.startsWith("image/")) return undefined;
    return {
      id: null,
      message_id: message.id,
      media_url: `/api/chats/${chatId}/messages/${message.id}/media`,
      media_type: isSticker ? "sticker" : "document",
      mime_type: mimeType || "image/webp"
    };
  }
  return undefined;
}

function photoPayload(chatId: string, messageId: number): MediaItem {
  return {
    id: null,
    message_id: messageId,
    media_url: `/api/chats/${chatId}/messages/${messageId}/media`,
    media_type: "photo",
    mime_type: "image/jpeg"
  };
}

function className(value: unknown): string {
  if (value === null || value === undefined) return "";
  const record = asRecord(value);
  if (record && typeof record.className === "string" && record.className) return record.className;
  const constructor = (value as { constructor?: { name?: string } }).constructor;
  return constructor?.name ?? "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function mimeFor(preview: MediaItem): string {
  return (preview.mime_type ?? "image/jpeg").trim().toLowerCase();
}

function toBuffer(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}