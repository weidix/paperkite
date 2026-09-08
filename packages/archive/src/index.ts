import { Action } from "@paperkite/sdk";
import { utils } from "telegram";
import { MessageArchiver, type ArchiveClient } from "./archiver.js";
import { buildTargets, coerceBool, coerceInt, type ArchiveConfig } from "./config.js";
import { createArchiveStore, resolveBackend } from "./storage/index.js";

export { ArchiveConsoleWebService } from "./console/service.js";

type PeerLike = Parameters<typeof utils.getPeerId>[0];

export class ArchiveSyncAction extends Action<ArchiveConfig> {
  protected async run(): Promise<void> {
    if (!this.config || typeof this.config !== "object") {
      throw new Error("archive config must be a mapping with chats");
    }
    const targets = buildTargets(this.config);
    if (!targets.length) throw new Error("archive config must include chats");
    if (!this.sessions || !this.session) throw new Error("archive sync needs a session");

    const store = createArchiveStore({
      url: this.config.url,
      schema: this.config.schema
    });
    const batchSize = Math.max(1, coerceInt(this.config.batchSize, 50));
    const archiver = new MessageArchiver({
      store,
      mediaDir: this.config.mediaDir ?? "data/downloads",
      downloadMedia: coerceBool(this.config.downloadMedia, true),
      batchSize,
      shouldStop: () => this.signal.aborted,
      submit: (operation) => this.sessions!.run((client: unknown) => operation(client as ArchiveClient)),
      chatIdOf: (entity) => String(utils.getPeerId(entity as PeerLike)),
      logger: this.context.logger
    });

    try {
      await store.init();
      const backend = resolveBackend(this.config.url);
      let totalMessages = 0;
      let totalMedia = 0;
      let totalSkipped = 0;
      for (const target of targets) {
        this.context.logger.info(
          `archive chat=${target.chat} daysBack=${target.daysBack} maxMessages=${target.maxMessages} ` +
          `downloadMedia=${target.downloadMedia} resume=${target.resume} batchSize=${batchSize} ` +
          `backend=${backend} media=${this.config.mediaDir ?? "data/downloads"}`
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