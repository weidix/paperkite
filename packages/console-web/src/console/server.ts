import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastify from "fastify";
import type { ActionSpecInput, FlowPatch, RuntimeControl, RuntimeLogger } from "@paperkite/sdk";
import { HttpError, isHttpError } from "./errors.js";
import { tailFile } from "./logs.js";

export interface RuntimeConsoleServerOptions {
  readonly logger: RuntimeLogger;
}

export function createRuntimeConsoleServer(
  control: RuntimeControl,
  options: RuntimeConsoleServerOptions
): FastifyInstance {
  const server = fastify({ logger: false });
  server.setErrorHandler((error, _request, reply) => {
    const status = error instanceof Error ? (error as { statusCode?: number }).statusCode ?? 500 : 500;
    if (status >= 500) options.logger.error("runtime console request failed", error);
    if (!reply.sent) return reply.code(status).send({ error: error instanceof Error ? error.message : String(error) });
  });
  registerRoutes(server, control, options.logger);
  return server;
}

function registerRoutes(server: FastifyInstance, control: RuntimeControl, logger: RuntimeLogger): void {
  server.get("/api/snapshot", async () => control.snapshot);

  server.get("/api/plugins", async () => control.listPlugins());

  server.get("/api/logs", async () => ({ scopes: control.snapshot.logs }));

  server.get<{ Params: { scope: string }; Querystring: { lines?: string } }>("/api/logs/:scope", async (request, reply) => {
    try {
      const entry = control.snapshot.logs.find((item) => item.scope === decodeURIComponent(request.params.scope));
      if (!entry) throw new HttpError(404, "unknown log scope");
      const lines = await tailFile(entry.path, Number(request.query.lines ?? 200));
      return { scope: entry.scope, path: entry.path, lines };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.get("/api/events", async (request, reply) => streamEvents(request, reply, control));

  server.post<{ Body: { spec?: ActionSpecInput } }>("/api/action/run", async (request, reply) => {
    try {
      const spec = request.body?.spec;
      if (!spec || !String(spec.capability ?? "").trim()) throw new HttpError(422, "action.run needs spec.capability");
      await control.executeAction(spec);
      return { ok: true };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.post<{ Params: { id: string } }>("/api/flows/:id/run", async (request, reply) => {
    try {
      await control.runFlow(flowId(request));
      return { ok: true };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.post<{ Params: { id: string } }>("/api/flows/:id/reload", async (request, reply) => {
    try {
      await control.reloadFlow(flowId(request));
      return { ok: true };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.patch<{ Params: { id: string }; Body: FlowPatch }>("/api/flows/:id", async (request, reply) => {
    try {
      const changed = await control.updateFlow(flowId(request), request.body ?? {});
      return { ok: true, changed };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.post<{ Params: { id: string } }>("/api/services/:id/start", async (request, reply) => {
    try {
      await control.startService(flowId(request));
      return { ok: true };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.post<{ Params: { id: string } }>("/api/services/:id/stop", async (request, reply) => {
    try {
      await control.stopService(flowId(request));
      return { ok: true };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });

  server.post("/api/runtime/reload", async (request, reply) => {
    try {
      await control.reload();
      return { ok: true };
    } catch (error) {
      return sendError(reply, error, logger);
    }
  });
}

function flowId(request: FastifyRequest<{ Params: { id: string } }>): string {
  return decodeURIComponent(request.params.id);
}

function sendError(reply: FastifyReply, error: unknown, logger: RuntimeLogger): FastifyReply {
  if (isHttpError(error)) return reply.code(error.status).send({ error: error.message });
  const message = error instanceof Error ? error.message : String(error);
  logger.error("runtime console request failed", error);
  return reply.code(500).send({ error: message });
}

const EVENT_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no"
} as const;

async function streamEvents(request: FastifyRequest, reply: FastifyReply, control: RuntimeControl): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, EVENT_HEADERS);
  raw.write("retry: 3000\n\n");
  const unsubscribe = control.subscribe((event) => {
    raw.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => raw.write(": keep-alive\n\n"), 15_000);
  request.raw.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}