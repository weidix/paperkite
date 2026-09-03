import { Action, definePlugin, type PluginContext } from "@paperkite/sdk";
import { utils } from "telegram";
import { MessageArchiver, type ArchiveClient } from "./archiver.js";
import { buildTargets, coerceBool, coerceInt, type ArchiveConfig } from "./config.js";
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

export const manifest = {
  name: "@paperkite/plugin-message-archive",
  version: "0.1.0",
  capabilities: [
    { kind: "action" as const, name: "archive.sync" }
  ]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerAction("archive.sync", ArchiveSyncAction);
}

export default definePlugin({ manifest, register });