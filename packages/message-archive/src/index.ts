import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { Action, Service, definePlugin, type PluginContext } from "@paperkite/sdk";
import { utils } from "telegram";
import { MessageArchiver, type ArchiveClient } from "./archiver.js";
import { buildTargets, coerceBool, coerceInt, type ArchiveConfig } from "./config.js";
import { createConsoleServer } from "./console/server.js";
import { createArchiveStore } from "./storage/index.js";

type PeerLike = Parameters<typeof utils.getPeerId>[0];

class ArchiveSyncAction extends Action<ArchiveConfig> {
  protected async run(): Promise<void> {
    if (!this.payload || typeof this.payload !== "object") {
      throw new Error("archive payload must be a mapping with chats");
    }
    const targets = buildTargets(this.payload);
    if (!targets.length) throw new Error("archive payload must include chats");
    if (!this.sessions || !this.session) throw new Error("archive.sync needs a session");

    const store = createArchiveStore({
      backend: this.payload.backend,
      file: this.payload.file ?? this.payload.dbPath,
      url: this.payload.url,
      schema: this.payload.schema
    });
    const batchSize = Math.max(1, coerceInt(this.payload.batchSize, 50));
    const archiver = new MessageArchiver({
      store,
      mediaPath: this.payload.mediaPath ?? "data/downloads",
      downloadMedia: coerceBool(this.payload.downloadMedia, true),
      batchSize,
      shouldStop: () => this.signal.aborted,
      submit: (operation) => this.sessions!.run(this.session!, (client: unknown) => operation(client as ArchiveClient)),
      chatIdOf: (entity) => String(utils.getPeerId(entity as PeerLike)),
      logger: this.context.logger
    });

    try {
      await store.init();
      const backend = String(this.payload.backend ?? "sqlite").toLowerCase();
      let totalMessages = 0;
      let totalMedia = 0;
      let totalSkipped = 0;
      for (const target of targets) {
        this.context.logger.info(
          `archive chat=${target.chat} daysBack=${target.daysBack} maxMessages=${target.maxMessages} ` +
          `downloadMedia=${target.downloadMedia} resume=${target.resume} batchSize=${batchSize} ` +
          `backend=${backend} media=${this.payload.mediaPath ?? "data/downloads"}`
        );
        const result = await archiver.saveChatMessages(target.chat, {
          daysBack: target.daysBack,
          maxMessages: target.maxMessages,
          resume: target.resume,
          downloadMedia: target.downloadMedia
        });
        totalMessages += result.messages;
        totalMedia += result.media;
        totalSkipped += result.skipped;
      }
      this.context.logger.info(
        `archive summary chats=${targets.length} messages=${totalMessages} media=${totalMedia} skipped=${totalSkipped}`
      );
    } finally {
      await store.close();
    }
  }
}

interface ConsoleConfig {
  readonly backend?: string;
  readonly file?: string;
  readonly url?: string;
  readonly schema?: string;
  readonly host?: string;
  readonly port?: number;
  readonly publicDir?: string;
}

class ConsoleWebService extends Service<ConsoleConfig> {
  async run(): Promise<void> {
    const payload = this.payload ?? {};
    if (!payload.url && !payload.file) {
      throw new Error("archive.console_web needs url (postgres) or file (sqlite)");
    }
    const store = createArchiveStore({
      backend: payload.backend,
      file: payload.file,
      url: payload.url,
      schema: payload.schema
    });
    await store.init();
    const server = createConsoleServer(store, {
      sessionName: this.session,
      sessions: this.sessions,
      logger: this.context.logger
    });
    try {
      await server.register(fastifyStatic, {
        root: await publicDirectory(payload.publicDir),
        index: "index.html"
      });
      const host = payload.host ?? "127.0.0.1";
      const port = normalizePort(payload.port);
      await server.listen({ host, port });
      this.context.logger.info("web console listening", { host, port });
      await waitForAbort(this.signal);
    } finally {
      await server.close().catch(() => undefined);
      await store.close();
    }
  }
}

export const manifest = {
  name: "@paperkite/plugin-message-archive",
  version: "0.1.0",
  capabilities: [
    { kind: "action" as const, name: "archive.sync" },
    { kind: "service" as const, name: "archive.console_web" }
  ]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerAction("archive.sync", ArchiveSyncAction);
  context.registerService("archive.console_web", ConsoleWebService);
}

export default definePlugin({ manifest, register });

function normalizePort(value: number | undefined): number {
  const port = Number(value ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("archive.console_web port must be an integer between 1 and 65535");
  }
  return port;
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolvePromise) => {
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