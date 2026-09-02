import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastify from "fastify";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { ArchiveStore } from "../storage/index.js";
import { HttpError, isDatabaseError, isHttpError } from "./errors.js";
import { LiveMediaService } from "./media.js";
import {
  boundedInteger,
  parseSearchParams,
  positiveInteger,
  requiredRowId,
  serializeRow
} from "./serializer.js";

export interface ConsoleServerOptions {
  readonly sessionName?: string;
  readonly sessions?: SessionAccess;
  readonly logger: RuntimeLogger;
}

export function createConsoleServer(store: ArchiveStore, options: ConsoleServerOptions): FastifyInstance {
  const server = fastify({ logger: false });
  server.addHook("onClose", (_instance, done) => {
    releaseIdleConnections(server);
    done();
  });
  const media = new LiveMediaService(store, options.sessionName, options.sessions);
  registerRoutes(server, store, media, options.logger);
  return server;
}

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

function registerRoutes(
  server: FastifyInstance,
  store: ArchiveStore,
  media: LiveMediaService,
  logger: RuntimeLogger
): void {
  server.get("/api/search/structured", async (request, reply) => {
    try {
      const result = await store.searchStructured(parseSearchParams(request.query as Record<string, unknown>));
      return {
        items: result.items.map(serializeRow),
        total: result.total,
        limit: result.limit,
        offset: result.offset
      };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get("/api/search/context", async (request, reply) => {
    try {
      const params = request.query as Record<string, unknown>;
      const result = await store.getMessageContext(
        requiredRowId(params.message_rowid),
        boundedInteger(params.before_n, 0, 999, 10, "before_n"),
        boundedInteger(params.after_n, 0, 999, 10, "after_n")
      );
      return {
        anchor: result.anchor ? serializeRow(result.anchor) : null,
        before: result.before.map(serializeRow),
        after: result.after.map(serializeRow),
        before_n: result.beforeN,
        after_n: result.afterN
      };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get("/api/messages/:rowId/media", async (request, reply) => {
    try {
      requireMedia(media);
      const payload = await media.fetchPreview(requiredRowId(param(request, "rowId")));
      return reply.type(payload.contentType).send(payload.data);
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get("/api/chats/:chatId/messages/:messageId/media", async (request, reply) => {
    try {
      requireMedia(media);
      const payload = await media.fetchChatMessage(
        decodeURIComponent(param(request, "chatId")),
        positiveInteger(param(request, "messageId"), "message id")
      );
      return reply.type(payload.contentType).send(payload.data);
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get("/api/messages/:rowId/album", async (request, reply) => {
    try {
      requireMedia(media);
      const items = await media.fetchAlbum(requiredRowId(param(request, "rowId")));
      return { items };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get("/api/media-files/:id", async (request, reply) => {
    try {
      requireMedia(media);
      const resolved = await media.resolveMediaFile(requiredRowId(param(request, "id")));
      if (!resolved) throw new HttpError(404, "media file not found");
      return reply.type(resolved.contentType).send(createReadStream(resolved.path));
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });
}

function requireMedia(media: LiveMediaService): void {
  if (!media.available) throw new HttpError(503, "message media service is unavailable");
}

function sendError(reply: FastifyReply, error: unknown, logger: RuntimeLogger): FastifyReply {
  if (isHttpError(error)) return reply.code(error.status).send({ error: error.message });
  if (isDatabaseError(error)) return reply.code(503).send({ error: "database temporarily unavailable" });
  logger.error("web console request failed", error);
  return reply.code(500).send({ error: "internal server error" });
}

function param(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, string | undefined>)[name];
  if (value === undefined) throw new HttpError(422, `${name} is required`);
  return value;
}