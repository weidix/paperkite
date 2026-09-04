import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { Service, type RuntimeLogger } from "@paperkite/sdk";
import { createArchiveConsoleServer } from "./server.js";
import { createArchiveStore } from "../storage/index.js";

export interface ArchiveConsoleWebConfig {
  readonly backend?: string;
  readonly file?: string;
  readonly dbPath?: string;
  readonly url?: string;
  readonly schema?: string;
  /** 落盘媒体的解析根目录；相对路径的 file_path 以此为基准。 */
  readonly mediaRoot?: string;
  readonly host?: string;
  readonly port?: number;
  readonly publicDir?: string;
}

export class ArchiveConsoleWebService extends Service<ArchiveConsoleWebConfig> {
  async run(): Promise<void> {
    const payload = this.payload ?? {};
    const store = createArchiveStore({
      backend: payload.backend,
      file: payload.file ?? payload.dbPath,
      url: payload.url,
      schema: payload.schema
    });
    const server = createArchiveConsoleServer({
      store,
      backend: String(payload.backend ?? "sqlite").toLowerCase(),
      mediaRoot: payload.mediaRoot,
      session: this.session,
      sessions: this.sessions,
      logger: this.context.logger
    });
    try {
      await store.init();
      await server.register(fastifyStatic, {
        root: await publicDirectory(payload.publicDir),
        index: "index.html"
      });
      const host = payload.host ?? "127.0.0.1";
      const port = normalizeConsolePort(payload.port);
      await listenRetrying(server, host, port, this.context.logger);
      this.context.logger.info("archive console listening", { host, port });
      await waitForAbort(this.signal);
    } finally {
      await server.close().catch(() => undefined);
      await store.close();
    }
  }
}

function normalizeConsolePort(value: number | undefined): number {
  const port = Number(value ?? 3379);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("archive.console_web port must be an integer between 1 and 65535");
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
    return resolve(process.cwd(), "packages/message-archive/public");
  }
}