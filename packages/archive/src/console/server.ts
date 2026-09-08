import { createReadStream } from "node:fs";
import fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveStore, MessageEntity, MessageRecord, StoredMediaFile, TimeMode } from "../storage/index.js";
import { normalizeContextLimit, normalizeDate, normalizeLimit, normalizeOffset, normalizeRecordId, normalizeTimeMode } from "../storage/index.js";
import { normalizeEntities, type TelegramMessage } from "../archiver.js";
import { LiveMediaError, LiveMediaStreamer } from "./live.js";
import { diskMediaInfo, extFromMime, fetchLiveMedia, fetchLiveThumb, fileNameOf, isMissingPeer, isPhotoLike, mimeFromName, parseRange, resolveChatEntity } from "./media.js";

export interface ArchiveConsoleServerOptions {
  readonly store: ArchiveStore;
  readonly backend?: string;
  readonly mediaDir?: string;
  readonly session?: string;
  readonly sessions?: SessionAccess;
  readonly logger: RuntimeLogger;
}

const CHAT_MAX = 300;

/** 缩略图成功缓存：同一 recordId 不再反复打 Telegram。 */
const THUMB_TTL_MS = 60 * 60 * 1_000;
const THUMB_CACHE_MAX = 512;
/** 不可达（删除/不可访问）的阴性缓存，避免缩略图反复触发 Telegram 查询。 */
const THUMB_NEGATIVE_TTL_MS = 30 * 1_000;
/** 在线说明缓存：同一 recordId 5 分钟内不再重复取回。 */
const LIVE_TEXT_TTL_MS = 5 * 60 * 1_000;

export function createArchiveConsoleServer(options: ArchiveConsoleServerOptions): FastifyInstance {
  const server = fastify({ logger: false });
  const thumbCache = new Map<string, CachedThumb>();
  const negativeCache = new Map<string, NegativeThumb>();
  const liveTextCache = new Map<string, LiveTextCacheEntry>();
  const live = options.session && options.sessions
    ? new LiveMediaStreamer({
        sessions: options.sessions,
        logger: options.logger
      })
    : undefined;
  server.addHook("onClose", async () => {
    releaseIdleConnections(server);
  });
  server.setErrorHandler((error: unknown, _request, reply) => {
    const status = error instanceof HttpError
      ? error.status
      : (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) options.logger.error("archive console request failed", error);
    if (!reply.sent) {
      return reply.code(status).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  registerRoutes(server, options, thumbCache, negativeCache, liveTextCache, live);
  return server;
}

function registerRoutes(
  server: FastifyInstance,
  options: ArchiveConsoleServerOptions,
  thumbCache: Map<string, CachedThumb>,
  negativeCache: Map<string, NegativeThumb>,
  liveTextCache: Map<string, LiveTextCacheEntry>,
  live: LiveMediaStreamer | undefined
): void {
  const { store, mediaDir, session, sessions, logger } = options;

  server.get("/api/state", async () => {
    const blockwords = await store.listBlockwords();
    const blockedUsers = await store.listBlockedUsers();
    return {
      backend: options.backend ?? "sqlite",
      session: session ?? null,
      mediaDir: mediaDir ?? null,
      blockwords: { version: blockwords.version, count: blockwords.words.length },
      blockedUsers: { version: blockedUsers.version, count: blockedUsers.users.length }
    };
  });

  server.get("/api/blockwords", async () => store.listBlockwords());

  server.post<{ Body: { word?: unknown } }>("/api/blockwords", async (request, reply) => {
    const { word } = request.body ?? {};
    if (typeof word !== "string") throw new HttpError(400, "屏蔽词必须是字符串");
    const result = await store.addBlockword(word);
    if (result === "invalid") throw new HttpError(400, "屏蔽词需为 1-64 字符");
    if (result === "exists") throw new HttpError(409, "屏蔽词已存在");
    reply.code(201);
    return store.listBlockwords();
  });

  server.delete<{ Params: { word: string } }>("/api/blockwords/:word", async (request) => {
    const removed = await store.removeBlockword(request.params.word);
    if (!removed) throw new HttpError(404, "屏蔽词不存在");
    return store.listBlockwords();
  });

  server.get("/api/blockedusers", async () => store.listBlockedUsers());

  server.post<{ Body: { userId?: unknown; name?: unknown; username?: unknown } }>(
    "/api/blockedusers",
    async (request, reply) => {
      const { userId, name, username } = request.body ?? {};
      if (typeof userId !== "string") throw new HttpError(400, "用户 ID 必须是字符串");
      const result = await store.addBlockedUser({
        userId,
        ...(typeof name === "string" ? { name } : {}),
        ...(typeof username === "string" ? { username } : {})
      });
      if (result === "invalid") throw new HttpError(400, "用户 ID 需为 1-64 字符");
      if (result === "exists") throw new HttpError(409, "该用户已在屏蔽名单");
      reply.code(201);
      return store.listBlockedUsers();
    }
  );

  server.delete<{ Params: { id: string } }>("/api/blockedusers/:id", async (request) => {
    const removed = await store.removeBlockedUser(request.params.id);
    if (!removed) throw new HttpError(404, "该用户不在屏蔽名单");
    return store.listBlockedUsers();
  });

  server.get<{
    Querystring: {
      q?: string; exclude?: string; chat?: string; chatTitle?: string;
      from?: string; to?: string; timeMode?: string; limit?: string; offset?: string;
      users?: string; forwardFrom?: string;
    };
  }>("/api/search", async (request, reply) => {
    try {
      const query = request.query;
      const result = await store.searchStructured({
        keyword: text(query.q),
        excludeKeyword: text(query.exclude),
        chatIds: chatIdsOr(query.chat),
        chatTitle: text(query.chatTitle),
        dateFrom: dateOr(query.from),
        dateTo: dateOr(query.to),
        timeMode: modeOr(query.timeMode),
        senderIds: usersOr(query.users),
        forwardFromId: forwardIdOr(query.forwardFrom),
        forwardFromName: forwardNameOr(query.forwardFrom),
        limit: normalizeLimit(intOr(query.limit)),
        offset: normalizeOffset(intOr(query.offset))
      });
      return result;
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get<{ Params: { id: string }; Querystring: { before?: string; after?: string } }>(
    "/api/messages/:id",
    async (request, reply) => {
      try {
        const record = await store.getMessageByRecordId(recordIdOr(request.params.id));
        if (!record) throw new HttpError(404, "消息不存在");
        return record;
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string }; Querystring: { before?: string; after?: string; beforeOffset?: string; afterOffset?: string } }>(
    "/api/messages/:id/context",
    async (request, reply) => {
      try {
        const recordId = recordIdOr(request.params.id);
        const before = normalizeContextLimit(intOr(request.query.before));
        const after = normalizeContextLimit(intOr(request.query.after));
        const beforeOffset = normalizeOffset(intOr(request.query.beforeOffset));
        const afterOffset = normalizeOffset(intOr(request.query.afterOffset));
        const context = await store.getMessageContext(recordId, before, after, beforeOffset, afterOffset);
        if (!context.anchor) throw new HttpError(404, "消息不存在");
        return context;
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get("/api/chats", async (request, reply) => {
    try {
      const chats = await store.listChatLedger(CHAT_MAX);
      return { chats, capped: chats.length >= CHAT_MAX };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get<{ Querystring: { q?: string; chat?: string; limit?: string } }>(
    "/api/senders",
    async (request, reply) => {
      try {
        return await store.searchSenders({
          q: text(request.query.q),
          chatId: text(request.query.chat),
          limit: normalizeLimit(intOr(request.query.limit))
        });
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string }; Querystring: { chat?: string } }>(
    "/api/senders/:id/summary",
    async (request, reply) => {
      try {
        const summary = await store.getSenderSummary(senderIdOr(request.params.id), text(request.query.chat));
        if (!summary) throw new HttpError(404, "没有该发送者的记录");
        return summary;
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/messages/:id/replies",
    async (request, reply) => {
      try {
        const chain = await store.getReplyChain(recordIdOr(request.params.id));
        if (!chain) throw new HttpError(404, "消息不存在");
        return chain;
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Querystring: { chat?: string; username?: string; code?: string; msg?: string } }>(
    "/api/messages/resolve",
    async (request, reply) => {
      try {
        const messageId = intOr(request.query.msg) ?? 0;
        if (!Number.isInteger(messageId) || messageId <= 0) throw new HttpError(400, "msg 须为正整数");
        const recordId = await store.resolveMessageRef({
          chatId: text(request.query.chat),
          username: text(request.query.username),
          code: text(request.query.code),
          messageId
        });
        if (!recordId) throw new HttpError(404, "存档中无此消息");
        return { recordId };
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string } }>(
    "/api/messages/:id/live-text",
    async (request, reply) => {
      try {
        if (!session || !sessions) throw new HttpError(503, "archive console needs a Telegram session");
        const recordId = recordIdOr(request.params.id);
        const cached = liveTextCacheGet(recordId, liveTextCache);
        if (cached !== undefined) return { text: cached.text, entities: cached.entities };
        const record = await store.getMessageByRecordId(recordId);
        if (!record) throw new HttpError(404, "消息不存在");
        const caption = await fetchLiveCaptionText(sessions, store, logger, record);
        if (caption === undefined) {
          liveTextCacheNeg(recordId, liveTextCache);
          throw new HttpError(410, "消息已从 Telegram 删除或会话无法访问");
        }
        liveTextCachePut(recordId, caption, liveTextCache);
        return { text: caption.text, entities: caption.entities };
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string } }>("/api/mediafiles/:id", async (request, reply) => {
    try {
      const file = await store.getMediaFileById(recordIdOr(request.params.id));
      if (!file) throw new HttpError(404, "媒体记录不存在");
      return { file, onDisk: (await diskMediaInfo(file, mediaDir)) !== undefined };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get<{ Params: { id: string }; Querystring: { download?: string; size?: string } }>(
    "/api/messages/:id/thumb",
    async (request, reply) => {
      try {
        if (!session || !sessions) throw new HttpError(503, "archive console needs a Telegram session");
        const recordId = recordIdOr(request.params.id);
        const record = await store.getMessageByRecordId(recordId);
        if (!record) throw new HttpError(404, "消息不存在");
        if (!record.hasMedia) throw new HttpError(400, "该消息没有媒体");
        const file: StoredMediaFile = {
          id: record.recordId,
          messageId: record.messageId,
          chatId: record.chatId,
          mediaType: record.mediaType ?? "",
          fileName: `${record.messageId}`,
          mimeType: record.mimeType
        };
        if (request.query.size === "full") {
          if (live === undefined) throw new HttpError(503, "archive console needs a Telegram session");
          if (isPhotoLike(file)) {
            return sendLiveFull(reply, file, sessions, store, logger, request.query.download === "1");
          }
          return serveLiveStream(request, reply, live, file, await store.getChatUsername(file.chatId), request.query.download === "1");
        }
        const cached = thumbCacheGet(recordId, thumbCache);
        if (cached) {
          thumbHeaders(reply, cached.mime, cached.bytes.length, record.messageId, request.query.download === "1");
          return reply.send(cached.bytes);
        }
        const negative = negativeCacheGet(recordId, negativeCache);
        if (negative) throw new HttpError(negative.status, negative.message);
        const result = await fetchLiveThumb(file, sessions, {
          chatUsername: await store.getChatUsername(file.chatId),
          logger
        });
        if (!result.ok) {
          if (result.missing) {
            negativeCachePut(recordId, 410, "消息已从 Telegram 删除或会话无法访问", negativeCache);
            throw new HttpError(410, "消息已从 Telegram 删除或会话无法访问");
          }
          if (result.noThumb) {
            negativeCachePut(recordId, 404, "该媒体没有可用的缩略图", negativeCache);
            throw new HttpError(404, "该媒体没有可用的缩略图");
          }
          throw new HttpError(404, "无法从 Telegram 取回该媒体");
        }
        thumbCachePut(recordId, result.bytes, result.mime, thumbCache);
        thumbHeaders(reply, result.mime, result.bytes.length, record.messageId, request.query.download === "1");
        return reply.send(result.bytes);
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    "/api/mediafiles/:id/file",
    async (request, reply) => {
      try {
        const file = await store.getMediaFileById(recordIdOr(request.params.id));
        if (!file) throw new HttpError(404, "媒体记录不存在");
        const info = await diskMediaInfo(file, mediaDir);
        if (!info) throw new HttpError(404, "媒体文件未落盘");
        return sendMediaStream(request, reply, file, info.path, info.size, file.mimeType);
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );

  server.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    "/api/mediafiles/:id/live",
    async (request, reply) => {
      try {
        if (live === undefined || !session || !sessions) throw new HttpError(503, "archive console needs a Telegram session");
        const file = await store.getMediaFileById(recordIdOr(request.params.id));
        if (!file) throw new HttpError(404, "媒体记录不存在");
        if (isPhotoLike(file)) {
          return sendLiveFull(reply, file, sessions, store, logger, request.query.download === "1");
        }
        return serveLiveStream(request, reply, live, file, await store.getChatUsername(file.chatId), request.query.download === "1");
      } catch (error) {
        return sendError(reply, error, logger);
      }
    }
  );
}

async function sendMediaStream(
  request: FastifyRequest<{ Querystring: { download?: string } }>,
  reply: FastifyReply,
  file: StoredMediaFile,
  path: string,
  size: number,
  storedMime: string | undefined
): Promise<FastifyReply | undefined> {
  const mime = storedMime?.trim() || mimeFromName(path);
  const name = fileNameOf(file, path);
  reply.header("content-type", mime);
  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "private, max-age=300");
  if (request.query.download === "1") {
    reply.header("content-disposition", `attachment; filename="${name}"`);
  }
  const range = request.headers.range;
  if (range) {
    const part = parseRange(range, size);
    if (!part) {
      reply.header("content-type", "application/json; charset=utf-8");
      reply.code(416).header("content-range", `bytes */${size}`);
      return reply.send({ error: "range 请求无效" });
    }
    reply.code(206);
    reply.header("content-range", `bytes ${part.start}-${part.end}/${size}`);
    reply.header("content-length", String(part.end - part.start + 1));
    return reply.send(createReadStream(path, { start: part.start, end: part.end }));
  }
  reply.header("content-length", String(size));
  return reply.send(createReadStream(path));
}

function sendDownloadHeaders(
  reply: FastifyReply,
  file: StoredMediaFile,
  mime: string,
  size: number,
  download: boolean
): void {
  reply.header("content-type", mime);
  reply.header("content-length", String(size));
  if (download) {
    const name = fileNameOf(file, "");
    reply.header("content-disposition", `attachment; filename="${name}"`);
  }
}

/** 在线媒体直通：字节区间（含渐进整段）直接转发，错误统一映射为 HTTP。 */
async function serveLiveStream(
  request: FastifyRequest<{ Querystring: { download?: string } }>,
  reply: FastifyReply,
  live: LiveMediaStreamer,
  file: StoredMediaFile,
  chatUsername: string | undefined,
  download: boolean
): Promise<FastifyReply | undefined> {
  try {
    const stream = await live.serve(request, reply, file, chatUsername, download);
    if (stream === undefined) return undefined;
    return reply.send(stream);
  } catch (error) {
    if (error instanceof LiveMediaError) throw new HttpError(error.status, error.message);
    throw error;
  }
}

/** 整图在线取回（预览器用）：不经缩略图缓存，直接透传 Telegram 字节。 */
async function sendLiveFull(
  reply: FastifyReply,
  file: StoredMediaFile,
  sessions: SessionAccess,
  store: ArchiveStore,
  logger: RuntimeLogger,
  download: boolean
): Promise<FastifyReply> {
  const result = await fetchLiveMedia(file, sessions, {
    chatUsername: await store.getChatUsername(file.chatId),
    logger
  });
  if (!result.ok) {
    throw new HttpError(
      result.missing ? 410 : 404,
      result.missing ? "消息已从 Telegram 删除或会话无法访问" : "无法从 Telegram 取回该媒体"
    );
  }
  sendDownloadHeaders(reply, file, result.mime, result.bytes.length, download);
  reply.header("cache-control", "no-store");
  return reply.send(result.bytes);
}

function thumbHeaders(
  reply: FastifyReply,
  mime: string,
  size: number,
  messageId: number,
  download: boolean
): void {
  reply.header("content-type", mime);
  reply.header("content-length", String(size));
  if (download) {
    reply.header("content-disposition", `attachment; filename="${messageId}${extFromMime(mime)}"`);
  }
  reply.header("cache-control", "private, max-age=3600");
}

interface CachedThumb {
  readonly bytes: Buffer;
  readonly mime: string;
  readonly expires: number;
}

function thumbCacheGet(recordId: string, cache: Map<string, CachedThumb>): CachedThumb | undefined {
  const hit = cache.get(recordId);
  if (hit === undefined) return undefined;
  if (Date.now() >= hit.expires) {
    cache.delete(recordId);
    return undefined;
  }
  cache.delete(recordId);
  cache.set(recordId, hit);
  return hit;
}

function thumbCachePut(recordId: string, bytes: Buffer, mime: string, cache: Map<string, CachedThumb>): void {
  if (cache.size >= THUMB_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(recordId, { bytes, mime, expires: Date.now() + THUMB_TTL_MS });
}

interface NegativeThumb {
  readonly status: number;
  readonly message: string;
  readonly expires: number;
}

function negativeCacheGet(recordId: string, cache: Map<string, NegativeThumb>): NegativeThumb | undefined {
  const hit = cache.get(recordId);
  if (hit === undefined) return undefined;
  if (Date.now() >= hit.expires) {
    cache.delete(recordId);
    return undefined;
  }
  return hit;
}

function negativeCachePut(recordId: string, status: number, message: string, cache: Map<string, NegativeThumb>): void {
  cache.set(recordId, { status, message, expires: Date.now() + THUMB_NEGATIVE_TTL_MS });
}

interface LiveTextCacheEntry {
  readonly text: string;
  readonly entities: readonly MessageEntity[];
  readonly expires: number;
}

function liveTextCacheGet(recordId: string, cache: Map<string, LiveTextCacheEntry>): LiveTextCacheEntry | undefined {
  const hit = cache.get(recordId);
  if (hit === undefined || Date.now() >= hit.expires) {
    cache.delete(recordId);
    return undefined;
  }
  return hit.text === "" ? undefined : hit;
}

function liveTextCachePut(recordId: string, entry: { text: string; entities: readonly MessageEntity[] }, cache: Map<string, LiveTextCacheEntry>): void {
  cache.set(recordId, { ...entry, expires: Date.now() + LIVE_TEXT_TTL_MS });
}

function liveTextCacheNeg(recordId: string, cache: Map<string, LiveTextCacheEntry>): void {
  cache.set(recordId, { text: "", entities: [], expires: Date.now() + THUMB_NEGATIVE_TTL_MS });
}

/** 在线说明：从 Telegram 实时取回消息原始文本与实体（相册取全部成员的最长文本），原样返回。 */
async function fetchLiveCaptionText(
  sessions: SessionAccess,
  store: ArchiveStore,
  logger: RuntimeLogger,
  record: MessageRecord
): Promise<{ text: string; entities: readonly MessageEntity[] } | undefined> {
  const targets = albumTargetsOf(record);
  try {
    const chatUsername = await store.getChatUsername(record.chatId);
    return await sessions.run(async (client) => {
      const host = client as unknown as import("../archiver.js").ArchiveClient;
      const entity = await resolveChatEntity(host, record.chatId, chatUsername);
      if (entity === undefined) return undefined;
      const messages = await host.getMessages(entity, { ids: targets });
      let best: { text: string; entities: readonly MessageEntity[] } | undefined;
      for (const message of messages) {
        if (message === undefined || message === null) continue;
        const text = String(message.rawText ?? message.message ?? "").trim();
        if (best === undefined || text.length > best.text.length) {
          best = { text, entities: normalizeEntities(message.entities) };
        }
      }
      if (best === undefined || best.text === "") return undefined;
      return { text: best.text, entities: best.entities };
    });
  } catch (error) {
    if (isMissingPeer(error)) {
      logger.debug("live caption peer missing for message " + record.recordId);
      return undefined;
    }
    throw error;
  }
}

/** 相册取全部成员的消息 ID（上限 20），普通消息取自身。 */
function albumTargetsOf(record: MessageRecord): readonly number[] {
  const ids = record.albumRows.length > 0
    ? record.albumRows.map((row) => row.messageId)
    : [record.messageId];
  return [...new Set(ids)].slice(0, 20);
}

function sendError(reply: FastifyReply, error: unknown, logger: RuntimeLogger): FastifyReply | undefined {
  if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
  const message = error instanceof Error ? error.message : String(error);
  logger.error("archive console request failed", error);
  return reply.code(500).send({ error: message });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function recordIdOr(value: string): string {
  try {
    return normalizeRecordId(value);
  } catch (error) {
    throw new HttpError(400, errorMessage(error));
  }
}

function dateOr(value: string | undefined): string | undefined {
  try {
    return normalizeDate(value);
  } catch (error) {
    throw new HttpError(400, errorMessage(error));
  }
}

function modeOr(value: string | undefined): TimeMode {
  try {
    return normalizeTimeMode(value as TimeMode | undefined);
  } catch (error) {
    throw new HttpError(400, errorMessage(error));
  }
}

function intOr(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return Number(value);
}

function text(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

/** 逗号分隔的用户 ID 列表：trim + 去空，上限 50；空串等价于未指定。 */
function usersOr(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const users = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (users.length > 50) throw new HttpError(400, "用户数量超过上限（50）");
  return users;
}

/** 逗号分隔的会话 ID 列表：trim + 去空，上限 50；空串等价于未指定。 */
function chatIdsOr(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const chats = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (chats.length > 50) throw new HttpError(400, "群组数量超过上限（50）");
  return chats;
}

/** 转发来源参数：纯数字按 ID 精确匹配，否则按显示名包含匹配（大小写不敏感）。 */
function forwardIdOr(value: string | undefined): string | undefined {
  const result = text(value);
  return result && /^\d+$/.test(result) ? result : undefined;
}

function forwardNameOr(value: string | undefined): string | undefined {
  const result = text(value);
  return result && /^\d+$/.test(result) ? undefined : result;
}

/** 发送者 ID：trim + 长度校验（负 ID / 频道 ID 合法，不做数字限制）。 */
function senderIdOr(value: string): string {
  const result = value.trim();
  if (result === "" || result.length > 64) throw new HttpError(400, "用户 ID 需为 1-64 字符");
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 关停时释放 keep-alive 连接，避免 server.close 长期挂起。 */
function releaseIdleConnections(server: FastifyInstance): void {
  let attempts = 0;
  const tick = (): void => {
    server.server.closeIdleConnections();
    attempts += 1;
    if (attempts >= 5) return;
    const timer = setTimeout(tick, 100);
    timer.unref();
  };
  tick();
}