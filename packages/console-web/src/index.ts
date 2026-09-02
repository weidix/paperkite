import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { Service, definePlugin, type PluginContext, type RuntimeLogger } from "@paperkite/sdk";
import { createRuntimeConsoleServer } from "./console/server.js";

interface ConsoleWebConfig {
  readonly host?: string;
  readonly port?: number;
  readonly publicDir?: string;
}

class RuntimeConsoleWebService extends Service<ConsoleWebConfig> {
  async run(): Promise<void> {
    if (!this.control) throw new Error("runtime.console_web needs the runtime control contract");
    const server = createRuntimeConsoleServer(this.control, { logger: this.context.logger });
    try {
      await server.register(fastifyStatic, {
        root: await publicDirectory(this.payload?.publicDir),
        index: "index.html"
      });
      const host = this.payload?.host ?? "127.0.0.1";
      const port = normalizePort(this.payload?.port);
      await listenRetrying(server, host, port, this.context.logger);
      this.context.logger.info("runtime web console listening", { host, port });
      await waitForAbort(this.signal);
    } finally {
      await server.close().catch(() => undefined);
    }
  }
}

export const manifest = {
  name: "@paperkite/plugin-console-web",
  version: "0.1.0",
  capabilities: [{ kind: "service" as const, name: "runtime.console_web" }]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerService("runtime.console_web", RuntimeConsoleWebService);
}

export default definePlugin({ manifest, register });

function normalizePort(value: number | undefined): number {
  const port = Number(value ?? 3378);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("runtime.console_web port must be an integer between 1 and 65535");
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
    return resolve(process.cwd(), "packages/console-web/public");
  }
}