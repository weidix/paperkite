import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RuntimeLogger } from "@paperkite/sdk";
import type { ArchiveStore, LastMessageInfo, MediaRow, MessageRow } from "./storage/index.js";

export interface TelegramMessage {
  readonly id: number;
  readonly date: number;
  readonly text?: string;
  readonly rawText?: string;
  readonly message?: string;
  readonly media?: unknown;
  readonly sender?: unknown;
  readonly senderId?: unknown;
  readonly replyToMsgId?: number;
  readonly replyTo?: { readonly replyToMsgId?: number; readonly replyToTopId?: number };
  readonly forward?: { readonly fromId?: unknown; readonly fromName?: string };
  readonly fwdFrom?: { readonly fromId?: unknown; readonly fromName?: string };
  readonly groupedId?: unknown;
}

export interface DialogEntry {
  readonly title?: string;
  readonly entity?: unknown;
}

export interface ArchiveClient {
  getEntity(identifier: string | number): Promise<unknown>;
  iterDialogs(): AsyncIterable<DialogEntry>;
  iterMessages(entity: unknown, options: { limit: number; maxId: number }): AsyncIterable<TelegramMessage>;
  getMessages(entity: unknown, options: { ids: readonly number[] }): Promise<readonly TelegramMessage[]>;
  downloadMedia(message: TelegramMessage, options: { outputFile?: string }): Promise<Buffer | string | undefined>;
}

export interface ChatInfo {
  readonly chatId: string;
  readonly title?: string;
  readonly username?: string;
  readonly type: "channel" | "group" | "user";
  readonly description?: string;
  readonly membersCount?: number;
}

export interface ArchiveRunOptions {
  readonly daysBack?: number;
  readonly maxMessages?: number;
  readonly resume?: boolean;
  readonly downloadMedia?: boolean;
}

export interface ArchiveResult {
  readonly messages: number;
  readonly media: number;
  readonly skipped: number;
}

export interface ArchiverDependencies {
  readonly store: ArchiveStore;
  readonly mediaPath: string;
  readonly downloadMedia: boolean;
  readonly batchSize: number;
  readonly shouldStop: () => boolean;
  readonly submit: <T>(operation: (client: ArchiveClient) => T | Promise<T>) => Promise<T>;
  readonly chatIdOf: (entity: unknown) => string;
  readonly logger: RuntimeLogger;
}

interface SyncWindow {
  readonly startDate?: Date;
  readonly maxMessages?: number;
  readonly incremental: boolean;
  readonly lastMessageInfo?: LastMessageInfo;
  readonly resumeStartDate?: Date;
}

interface BatchPage {
  readonly rows: MessageRow[];
  readonly minMessageId: number | undefined;
  readonly reachedAnchor: boolean;
  readonly reachedBottom: boolean;
}

interface DownloadedMedia {
  readonly messageId: number;
  readonly fileName: string;
  readonly filePath: string;
  readonly fileSize?: number;
  readonly mimeType?: string;
}

const DAY_MS = 86_400_000;
const EPOCH_ISO = new Date(0).toISOString();

export class MessageArchiver {
  constructor(private readonly deps: ArchiverDependencies) {}

  async findChat(identifier: string | number): Promise<ChatInfo | undefined> {
    try {
      const entity = await this.deps.submit((client) => this.resolveEntity(client, identifier));
      if (!entity) {
        this.deps.logger.info("chat not found: " + identifier);
        return undefined;
      }
      return toChatInfo(entity, this.deps.chatIdOf);
    } catch (error) {
      this.deps.logger.warn("failed to resolve chat " + identifier, error);
      return undefined;
    }
  }

  async saveChatMessages(chatIdentifier: string | number, options: ArchiveRunOptions = {}): Promise<ArchiveResult> {
    const chatInfo = await this.findChat(chatIdentifier);
    if (!chatInfo) return { messages: 0, media: 0, skipped: 0 };

    await this.deps.store.saveChat(chatInfo);

    const daysBack = options.daysBack ?? 30;
    const maxMessages = options.maxMessages ?? 1_000;
    const endDate = new Date();
    const window = await this.planSyncWindow(
      chatInfo.chatId,
      daysBack,
      maxMessages,
      options.resume ?? true,
      endDate
    );

    const sessionId = await this.deps.store.startSyncSession(
      chatInfo.chatId,
      window.startDate?.toISOString() ?? EPOCH_ISO,
      endDate.toISOString()
    );
    const counts = { messages: 0, media: 0, skipped: 0, processed: 0 };

    try {
      await this.runSyncWindow(chatInfo, chatIdentifier, window, counts, options.downloadMedia ?? this.deps.downloadMedia);
      await this.deps.store.completeSyncSession(sessionId, counts.messages, counts.media);
      this.deps.logger.info(
        "sync done for " + chatIdentifier +
        `: processed=${counts.processed} new=${counts.messages} skipped=${counts.skipped} media=${counts.media}`
      );
      return asResult(counts);
    } catch (error) {
      await this.deps.store.completeSyncSession(sessionId, counts.messages, counts.media);
      this.deps.logger.warn("sync failed for " + chatIdentifier, error);
      return asResult(counts);
    }
  }

  private async resolveEntity(client: ArchiveClient, identifier: string | number): Promise<unknown> {
    if (typeof identifier === "number") return client.getEntity(identifier);

    let name = String(identifier).trim();
    if (/^https?:\/\//i.test(name)) {
      const last = name.replace(/\/+$/, "").split("/").pop();
      if (last) name = `@${last.replace(/^@/, "")}`;
    }
    if (name.startsWith("@")) return client.getEntity(name);

    const needle = name.toLowerCase();
    for await (const dialog of client.iterDialogs()) {
      const title = dialog.title ?? "";
      const username = entityUsername(dialog.entity) ?? "";
      if (title.toLowerCase().includes(needle) || username.toLowerCase() === needle) {
        return dialog.entity ?? client.getEntity(name);
      }
    }
    return undefined;
  }

  private async planSyncWindow(
    chatId: string,
    daysBack: number,
    maxMessages: number,
    resume: boolean,
    endDate: Date
  ): Promise<SyncWindow> {
    const startDate = daysBack === 0 ? undefined : new Date(endDate.getTime() - daysBack * DAY_MS);
    let max = maxMessages === 0 ? undefined : maxMessages;
    if (startDate === undefined && max === undefined) {
      throw new Error("days_back and max_messages cannot both be unlimited");
    }

    let incremental = false;
    let lastMessageInfo: LastMessageInfo | undefined;
    let resumeStartDate = startDate;

    if (resume) {
      lastMessageInfo = await this.deps.store.getLastMessageInfo(chatId);
      if (lastMessageInfo) {
        incremental = true;
        const lastDate = new Date(lastMessageInfo.date);
        resumeStartDate = startDate ? (lastDate > startDate ? lastDate : startDate) : lastDate;
        if (max !== undefined) max = Math.min(max, 1_000);
        this.deps.logger.info("incremental sync for " + chatId + " from " + resumeStartDate.toISOString());
      } else {
        this.deps.logger.info("full sync for " + chatId);
      }
    } else {
      this.deps.logger.info("full re-sync for " + chatId + " (resume disabled)");
    }

    return { startDate, maxMessages: max, incremental, lastMessageInfo, resumeStartDate };
  }

  private async runSyncWindow(
    chatInfo: ChatInfo,
    chatIdentifier: string | number,
    window: SyncWindow,
    counts: MutableCounts,
    downloadMedia: boolean
  ): Promise<void> {
    const budget: { remaining?: number } = { remaining: window.maxMessages };
    const minDate = window.incremental ? window.resumeStartDate : window.startDate;
    const anchorId = window.incremental ? window.lastMessageInfo?.messageId : undefined;
    await this.sweep(
      chatInfo,
      String(chatIdentifier),
      minDate,
      anchorId,
      budget,
      counts,
      downloadMedia
    );
  }

  private async sweep(
    chatInfo: ChatInfo,
    chatLabel: string,
    minDate: Date | undefined,
    stopAnchorId: number | undefined,
    budget: { remaining?: number },
    counts: MutableCounts,
    downloadMedia: boolean
  ): Promise<void> {
    const chatId = chatInfo.chatId;
    let nextMaxId: number | undefined;

    while (!this.deps.shouldStop() && !budgetExhausted(budget)) {
      let pageLimit = this.deps.batchSize;
      if (budget.remaining !== undefined) pageLimit = Math.min(pageLimit, budget.remaining);

      const page = await this.deps.submit((client) => this.fetchPageOnHost(client, chatId, chatInfo, minDate, nextMaxId, pageLimit, stopAnchorId));
      counts.processed += page.rows.length;
      const consumed = await this.commitPage(chatId, chatLabel, page, counts, downloadMedia);
      if (budget.remaining !== undefined) budget.remaining -= consumed;

      if (page.rows.length === 0 || page.reachedBottom) break;
      if (stopAnchorId !== undefined && page.reachedAnchor) break;
      if (page.minMessageId === undefined || page.minMessageId <= 1) break;
      nextMaxId = page.minMessageId;
    }
  }

  private async fetchPageOnHost(
    client: ArchiveClient,
    chatId: string,
    chatInfo: ChatInfo,
    minDate: Date | undefined,
    maxId: number | undefined,
    limit: number,
    stopAnchorId: number | undefined
  ): Promise<BatchPage> {
    const rows: MessageRow[] = [];
    let minMessageId: number | undefined;
    let reachedAnchor = false;
    let reachedBottom = false;

    for await (const message of client.iterMessages(chatId, { limit, maxId: maxId ?? 0 })) {
      const date = new Date(Number(message.date) * 1_000);
      if (minDate !== undefined && date < minDate) {
        reachedBottom = true;
        break;
      }
      if (stopAnchorId !== undefined && message.id <= stopAnchorId) reachedAnchor = true;
      rows.push(extractMessageRow(message, chatInfo));
      if (minMessageId === undefined || message.id < minMessageId) minMessageId = message.id;
      if (reachedAnchor || reachedBottom) break;
    }

    return { rows, minMessageId, reachedAnchor, reachedBottom };
  }

  private async commitPage(
    chatId: string,
    chatLabel: string,
    page: BatchPage,
    counts: MutableCounts,
    downloadMedia: boolean
  ): Promise<number> {
    if (page.rows.length === 0) return 0;

    const ids = page.rows.map((row) => row.messageId);
    const existing = await this.deps.store.messageIdsExist(chatId, ids);
    const newRows = page.rows.filter((row) => !existing.has(row.messageId));
    counts.skipped += page.rows.length - newRows.length;

    let inserted = 0;
    let savedMedia = 0;
    if (newRows.length) {
      const mediaRows = downloadMedia ? await this.downloadNewMedia(chatId, newRows) : [];
      const committed = await this.deps.store.saveBatch(withMediaPaths(newRows, mediaRows), mediaRows);
      inserted = committed.messages;
      savedMedia = committed.media;
      counts.messages += inserted;
      counts.media += savedMedia;
    }

    this.deps.logger.info(
      `batch committed for ${chatLabel}: fetched=${page.rows.length} new=${inserted} ` +
      `skipped=${page.rows.length - newRows.length} media=${savedMedia} (total new=${counts.messages})`
    );
    return page.rows.length;
  }

  private async downloadNewMedia(chatId: string, newRows: readonly MessageRow[]): Promise<MediaRow[]> {
    const targets = newRows
      .filter((row) => row.hasMedia)
      .map((row) => ({ messageId: row.messageId, mediaType: row.mediaType ?? "document" }));
    if (!targets.length) return [];

    const chatDir = join(this.deps.mediaPath, `chat_${chatId}`);
    await mkdir(chatDir, { recursive: true });

    const ids = targets.map((target) => target.messageId);
    const downloaded = await this.deps.submit((client) => this.downloadMediaOnHost(client, chatId, chatDir, ids));
    const byId = new Map(downloaded.map((item) => [item.messageId, item]));

    const mediaRows: MediaRow[] = [];
    for (const target of targets) {
      const item = byId.get(target.messageId);
      if (!item) continue;
      mediaRows.push({
        messageId: target.messageId,
        chatId,
        mediaType: target.mediaType,
        fileName: item.fileName,
        filePath: item.filePath,
        fileSize: item.fileSize,
        mimeType: item.mimeType
      });
    }
    return mediaRows;
  }

  private async downloadMediaOnHost(
    client: ArchiveClient,
    chatId: string,
    chatDir: string,
    messageIds: readonly number[]
  ): Promise<DownloadedMedia[]> {
    const messages = (await client.getMessages(chatId, { ids: messageIds })).filter(Boolean);
    const results: DownloadedMedia[] = [];
    for (const message of messages) {
      if (!message.media) continue;
      try {
        const document = recordOf(documentOf(message.media));
        const ext = photoOf(message.media) ? "jpg" : documentExtension(document) ?? "bin";
        const filePath = await client.downloadMedia(message, { outputFile: join(chatDir, `msg_${message.id}.${ext}`) });
        if (!filePath) continue;
        results.push({
          messageId: message.id,
          fileName: basename(String(filePath)),
          filePath: String(filePath),
          fileSize: optionalNumber(document?.size),
          mimeType: optionalText(document?.mimeType)
        });
      } catch (error) {
        this.deps.logger.warn("failed to download media for message " + message.id, error);
      }
    }
    return results;
  }
}

function extractMessageRow(message: TelegramMessage, chatInfo: ChatInfo): MessageRow {
  const media = describeMedia(message.media);
  const forward = message.forward ?? message.fwdFrom;
  const forwardFromId = forward !== undefined && forward !== null ? peerIdValue(forward.fromId) : undefined;
  const forwardFromName = forward !== undefined && forward !== null ? optionalText(forward.fromName) : undefined;
  const groupedId = message.groupedId !== undefined && message.groupedId !== null
    ? String(message.groupedId)
    : undefined;
  const sender = message.sender;
  return {
    messageId: message.id,
    chatId: chatInfo.chatId,
    ...(chatInfo.title !== undefined ? { chatTitle: chatInfo.title } : {}),
    senderId: optionalString(message.senderId),
    senderUsername: entityUsername(sender),
    senderFirstName: entityFirstName(sender),
    senderLastName: entityLastName(sender),
    date: new Date(Number(message.date) * 1_000).toISOString(),
    text: message.rawText ?? message.message ?? "",
    messageType: media.messageType,
    replyToMsgId: message.replyToMsgId ?? message.replyTo?.replyToMsgId,
    hasMedia: message.media !== undefined && message.media !== null,
    mediaType: media.mediaType,
    ...(groupedId !== undefined ? { groupedId } : {}),
    ...(forwardFromId !== undefined ? { forwardFromId, forwardFromName } : {})
  };
}

function describeMedia(media: unknown): { messageType: string; mediaType?: string; mimeType?: string } {
  if (!media) return { messageType: "text" };
  if (photoOf(media)) return { messageType: "photo", mediaType: "photo", mimeType: "image/jpeg" };
  if (className(media) === "MessageMediaDocument") {
    const document = recordOf(documentOf(media) ?? media);
    const attributes = Array.isArray(document?.attributes) ? document.attributes as unknown[] : [];
    const mimeType = optionalText(document?.mimeType);
    if (attributes.some(hasName("DocumentAttributeSticker"))) {
      return { messageType: "sticker", mediaType: "sticker", mimeType: mimeType ?? "image/webp" };
    }
    if (attributes.some(hasName("DocumentAttributeAnimated"))) {
      return { messageType: "animation", mediaType: "animation", mimeType };
    }
    return { messageType: "document", mediaType: "document", mimeType };
  }
  return { messageType: "text" };
}

function documentExtension(document: unknown): string | undefined {
  const record = recordOf(document);
  const attributes = Array.isArray(record?.attributes) ? record.attributes as unknown[] : [];
  for (const attribute of attributes) {
    if (!hasName("DocumentAttributeFilename")(attribute)) continue;
    const fileName = optionalText(recordOf(attribute)?.fileName);
    if (fileName) {
      const dot = fileName.lastIndexOf(".");
      if (dot >= 0 && dot < fileName.length - 1) return fileName.slice(dot + 1).toLowerCase();
    }
  }
  const mimeType = optionalText(record?.mimeType);
  const mimeExt = mimeType?.split("/")[1];
  return mimeExt && /^[a-z0-9]+$/.test(mimeExt) ? mimeExt : undefined;
}

function entityUsername(entity: unknown): string | undefined {
  return optionalText(recordOf(entity)?.username);
}

function entityFirstName(entity: unknown): string | undefined {
  return optionalText(recordOf(entity)?.firstName);
}

function entityLastName(entity: unknown): string | undefined {
  return optionalText(recordOf(entity)?.lastName);
}

function peerIdValue(peer: unknown): string | undefined {
  const record = recordOf(peer);
  if (!record) return undefined;
  for (const key of ["userId", "channelId", "chatId"]) {
    if (record[key] !== undefined && record[key] !== null) return String(record[key]);
  }
  return undefined;
}

function toChatInfo(entity: unknown, chatIdOf: (entity: unknown) => string): ChatInfo {
  const record = recordOf(entity) ?? {};
  const firstName = optionalText(record.firstName);
  const lastName = optionalText(record.lastName);
  const title = optionalText(record.title) ?? [firstName, lastName].filter(Boolean).join(" ") ?? "Unknown";
  return {
    chatId: chatIdOf(entity),
    title,
    username: optionalText(record.username),
    type: className(entity) === "Channel" ? "channel" : className(entity) === "Chat" ? "group" : "user",
    description: optionalText(record.about),
    membersCount: optionalNumber(record.participantsCount)
  };
}

interface MutableCounts {
  messages: number;
  media: number;
  skipped: number;
  processed: number;
}

function asResult(counts: MutableCounts): ArchiveResult {
  return { messages: counts.messages, media: counts.media, skipped: counts.skipped };
}

function budgetExhausted(budget: { remaining?: number }): boolean {
  return budget.remaining !== undefined && budget.remaining <= 0;
}

function withMediaPaths(rows: readonly MessageRow[], mediaRows: readonly MediaRow[]): MessageRow[] {
  const paths = new Map(mediaRows.map((row) => [row.messageId, row.filePath]));
  return rows.map((row) => {
    const mediaPath = paths.get(row.messageId);
    return mediaPath !== undefined ? { ...row, mediaPath } : row;
  });
}

function photoOf(media: unknown): boolean {
  return className(media) === "MessageMediaPhoto";
}

function documentOf(media: unknown): unknown {
  return className(media) === "MessageMediaDocument" ? recordOf(media)?.document : undefined;
}

function className(value: unknown): string {
  if (value === null || value === undefined) return "";
  const record = recordOf(value);
  if (record && typeof record.className === "string" && record.className) return record.className;
  const constructor = (value as { constructor?: { name?: string } }).constructor;
  return constructor?.name ?? "";
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function hasName(name: string): (value: unknown) => boolean {
  return (value) => className(value) === name;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}