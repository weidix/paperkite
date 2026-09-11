import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RuntimeLogger, ServiceContext, ServiceHandler } from "@paperkite/sdk";
import { createRuntimeConsoleServer } from "./console/server.js";

interface ConsoleWebConfig {
  readonly host?: string;
  readonly port?: number;
  readonly publicDir?: string;
}

export class RuntimeConsoleWebService implements ServiceHandler<ConsoleWebConfig> {
  async run(ctx: ServiceContext<ConsoleWebConfig>): Promise<void> {
    if (!ctx.control) throw new Error("runtime console needs the runtime control contract");
    const config = ctx.config;
    const server = createRuntimeConsoleServer(ctx.control, { logger: ctx.logger });
    try {
      await server.register(fastifyStatic, {
        root: await publicDirectory(config?.publicDir),
        index: "index.html"
      });
      server.setNotFoundHandler(spaFallback);
      const host = config?.host ?? "127.0.0.1";
      const port = normalizePort(config?.port);
      await listenRetrying(server, host, port, ctx.logger);
      ctx.logger.info("runtime web console listening", { host, port });
      await waitForAbort(ctx.signal);
    } finally {
      await server.close().catch(() => undefined);
    }
  }
}

function normalizePort(value: number | undefined): number {
  const port = Number(value ?? 3378);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("runtime console port must be an integer between 1 and 65535");
  }
  return port;
}

async function listenRetrying(
  server: FastifyInstance,
  host: string,
  port: number,
  logger: RuntimeLogger
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await server.listen({ host, port });
      return;
    } catch (error) {
      if (attempt < 6 && isEaddrinuse(error)) {
        logger.warn("runtime web console port is still held by a stopping instance, retrying", { host, port });
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
}

function isEaddrinuse(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolvePromise) => {
    signal.addEventListener("abort", () => resolvePromise(), { once: true });
  });
}

async function publicDirectory(configured: string | undefined): Promise<string> {
  if (configured) return resolve(configured);
  const local = fileURLToPath(new URL("../public", import.meta.url));
  try {
    await access(local);
    return local;
  } catch {
    return resolve(process.cwd(), "packages/runtime-console/public");
  }
}

async function spaFallback(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply.code(405).send({ error: "method not allowed" });
  }
  if (request.url.startsWith("/api/")) {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.sendFile("index.html");
}