import { createReadStream } from "node:fs";
import fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveStore, StoredMediaFile, TimeMode } from "../storage/index.js";
import { normalizeContextLimit, normalizeDate, normalizeLimit, normalizeOffset, normalizeRowId, normalizeTimeMode } from "../storage/index.js";
import { diskMediaInfo, extFromMime, fetchLiveMedia, fetchLiveThumb, fileNameOf, mimeFromName, parseRange } from "./media.js";

export interface ArchiveConsoleServerOptions {
  readonly store: ArchiveStore;
  readonly backend?: string;
  readonly mediaRoot?: string;
  readonly session?: string;
  readonly sessions?: SessionAccess;
  readonly logger: RuntimeLogger;
}

const CHAT_MAX = 300;

/** 缩略图成功缓存：同一 rowId 不再反复打 Telegram。 */
const THUMB_TTL_MS = 60 * 60 * 1_000;
const THUMB_CACHE_MAX = 512;
/** 不可达（删除/不可访问）的阴性缓存，避免缩略图反复触发 Telegram 查询。 */
const THUMB_NEGATIVE_TTL_MS = 30 * 1_000;

export function createArchiveConsoleServer(options: ArchiveConsoleServerOptions): FastifyInstance {
  const server = fastify({ logger: false });
  const thumbCache = new Map<string, CachedThumb>();
  const negativeCache = new Map<string, NegativeThumb>();
  server.addHook("onClose", (_instance, done) => {
    releaseIdleConnections(server);
    done();
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
  registerRoutes(server, options, thumbCache, negativeCache);
  return server;
}

function registerRoutes(
  server: FastifyInstance,
  options: ArchiveConsoleServerOptions,
  thumbCache: Map<string, CachedThumb>,
  negativeCache: Map<string, NegativeThumb>
): void {
  const { store, mediaRoot, session, sessions, logger } = options;

  server.get("/api/state", async () => ({
    backend: options.backend ?? "sqlite",
    session: session ?? null,
    mediaRoot: mediaRoot ?? null
  }));

  server.get<{
    Querystring: {
      q?: string; exclude?: string; chat?: string; chatTitle?: string;
      from?: string; to?: string; timeMode?: string; limit?: string; offset?: string;
    };
  }>("/api/search", async (request, reply) => {
    try {
      const query = request.query;
      const result = await store.searchStructured({
        keyword: text(query.q),
        excludeKeyword: text(query.exclude),
        chatId: text(query.chat),
        chatTitle: text(query.chatTitle),
        dateFrom: dateOr(query.from),
        dateTo: dateOr(query.to),
        timeMode: modeOr(query.timeMode),
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
        const record = await store.getMessageByRowId(rowIdOr(request.params.id));
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
        const rowId = rowIdOr(request.params.id);
        const before = normalizeContextLimit(intOr(request.query.before));
        const after = normalizeContextLimit(intOr(request.query.after));
        const beforeOffset = normalizeOffset(intOr(request.query.beforeOffset));
        const afterOffset = normalizeOffset(intOr(request.query.afterOffset));
        const context = await store.getMessageContext(rowId, before, after, beforeOffset, afterOffset);
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

  server.get<{ Params: { id: string } }>("/api/mediafiles/:id", async (request, reply) => {
    try {
      const file = await store.getMediaFileById(rowIdOr(request.params.id));
      if (!file) throw new HttpError(404, "媒体记录不存在");
      return { file, onDisk: (await diskMediaInfo(file, mediaRoot)) !== undefined };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get<{ Params: { id: string }; Querystring: { download?: string; size?: string } }>(
    "/api/messages/:id/thumb",
    async (request, reply) => {
      try {
        if (!session || !sessions) throw new HttpError(503, "archive.console_web 未配置 Telegram 会话");
        const rowId = rowIdOr(request.params.id);
        const record = await store.getMessageByRowId(rowId);
        if (!record) throw new HttpError(404, "消息不存在");
        if (!record.hasMedia) throw new HttpError(400, "该消息没有媒体");
        const file: StoredMediaFile = {
          id: record.rowId,
          messageId: record.messageId,
          chatId: record.chatId,
          mediaType: record.mediaType ?? "",
          fileName: `${record.messageId}`,
          mimeType: record.mimeType
        };
        if (request.query.size === "full") {
          return sendLiveFull(reply, file, sessions, session, store, logger, request.query.download === "1");
        }
        const cached = thumbCacheGet(rowId, thumbCache);
        if (cached) {
          thumbHeaders(reply, cached.mime, cached.bytes.length, record.messageId, request.query.download === "1");
          return reply.send(cached.bytes);
        }
        const negative = negativeCacheGet(rowId, negativeCache);
        if (negative) throw new HttpError(negative.status, negative.message);
        const result = await fetchLiveThumb(file, sessions, session, {
          chatUsername: await store.getChatUsername(file.chatId),
          logger
        });
        if (!result.ok) {
          if (result.missing) {
            negativeCachePut(rowId, 410, "消息已从 Telegram 删除或会话无法访问", negativeCache);
            throw new HttpError(410, "消息已从 Telegram 删除或会话无法访问");
          }
          if (result.noThumb) {
            negativeCachePut(rowId, 404, "该媒体没有可用的缩略图", negativeCache);
            throw new HttpError(404, "该媒体没有可用的缩略图");
          }
          throw new HttpError(404, "无法从 Telegram 取回该媒体");
        }
        thumbCachePut(rowId, result.bytes, result.mime, thumbCache);
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
        const file = await store.getMediaFileById(rowIdOr(request.params.id));
        if (!file) throw new HttpError(404, "媒体记录不存在");
        const info = await diskMediaInfo(file, mediaRoot);
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
        if (!session || !sessions) throw new HttpError(503, "archive.console_web 未配置 Telegram 会话");
        const file = await store.getMediaFileById(rowIdOr(request.params.id));
        if (!file) throw new HttpError(404, "媒体记录不存在");
        const result = await fetchLiveMedia(file, sessions, session, {
          chatUsername: await store.getChatUsername(file.chatId),
          logger
        });
        if (!result.ok) {
          throw new HttpError(
            result.missing ? 410 : 404,
            result.missing ? "消息已从 Telegram 删除或会话无法访问" : "无法从 Telegram 取回该媒体"
          );
        }
        sendDownloadHeaders(reply, file, result.mime, result.bytes.length, request.query.download === "1");
        reply.header("cache-control", "no-store");
        return reply.send(result.bytes);
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

/** 整图在线取回（预览器用）：不经缩略图缓存，直接透传 Telegram 字节。 */
async function sendLiveFull(
  reply: FastifyReply,
  file: StoredMediaFile,
  sessions: SessionAccess,
  session: string,
  store: ArchiveStore,
  logger: RuntimeLogger,
  download: boolean
): Promise<FastifyReply> {
  const result = await fetchLiveMedia(file, sessions, session, {
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

function thumbCacheGet(rowId: string, cache: Map<string, CachedThumb>): CachedThumb | undefined {
  const hit = cache.get(rowId);
  if (hit === undefined) return undefined;
  if (Date.now() >= hit.expires) {
    cache.delete(rowId);
    return undefined;
  }
  cache.delete(rowId);
  cache.set(rowId, hit);
  return hit;
}

function thumbCachePut(rowId: string, bytes: Buffer, mime: string, cache: Map<string, CachedThumb>): void {
  if (cache.size >= THUMB_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(rowId, { bytes, mime, expires: Date.now() + THUMB_TTL_MS });
}

interface NegativeThumb {
  readonly status: number;
  readonly message: string;
  readonly expires: number;
}

function negativeCacheGet(rowId: string, cache: Map<string, NegativeThumb>): NegativeThumb | undefined {
  const hit = cache.get(rowId);
  if (hit === undefined) return undefined;
  if (Date.now() >= hit.expires) {
    cache.delete(rowId);
    return undefined;
  }
  return hit;
}

function negativeCachePut(rowId: string, status: number, message: string, cache: Map<string, NegativeThumb>): void {
  cache.set(rowId, { status, message, expires: Date.now() + THUMB_NEGATIVE_TTL_MS });
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

function rowIdOr(value: string): string {
  try {
    return normalizeRowId(value);
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