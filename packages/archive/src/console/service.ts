import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { RuntimeLogger, ServiceContext, ServiceHandler } from "@paperkite/sdk";
import { createArchiveConsoleServer } from "./server.js";
import { createArchiveStore, resolveBackend } from "../storage/index.js";

export interface ArchiveConsoleWebConfig {
  readonly url?: string;
  readonly schema?: string;
  /** 落盘媒体的解析根目录；相对路径的 file_path 以此为基准。 */
  readonly mediaDir?: string;
  readonly host?: string;
  readonly port?: number;
  readonly publicDir?: string;
}

export class ArchiveConsoleWebService implements ServiceHandler<ArchiveConsoleWebConfig> {
  async run(ctx: ServiceContext<ArchiveConsoleWebConfig>): Promise<void> {
    const config = ctx.config ?? {};
    const store = createArchiveStore({
      url: config.url,
      schema: config.schema
    });
    const server = createArchiveConsoleServer({
      store,
      backend: resolveBackend(config.url),
      mediaDir: config.mediaDir,
      session: ctx.session,
      sessions: ctx.sessions,
      logger: ctx.logger
    });
    try {
      await store.init();
      await server.register(fastifyStatic, {
        root: await publicDirectory(config.publicDir),
        index: "index.html"
      });
      const host = config.host ?? "127.0.0.1";
      const port = normalizeConsolePort(config.port);
      await listenRetrying(server, host, port, ctx.logger);
      ctx.logger.info("archive console listening", { host, port });
      await waitForAbort(ctx.signal);
    } finally {
      await server.close().catch(() => undefined);
      await store.close();
    }
  }
}

function normalizeConsolePort(value: number | undefined): number {
  const port = Number(value ?? 3379);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("archive console port must be an integer between 1 and 65535");
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
        logger.warn("archive console port is still held by a stopping instance, retrying", { host, port });
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
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
    return resolve(process.cwd(), "packages/archive/public");
  }
}