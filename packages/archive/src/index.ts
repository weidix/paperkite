import type { ActionContext, ActionHandler } from "@paperkite/sdk";
import { utils } from "telegram";
import { MessageArchiver, type ArchiveClient } from "./archiver.js";
import { buildTargets, coerceBool, coerceInt, type ArchiveConfig } from "./config.js";
import { createArchiveStore, resolveBackend } from "./storage/index.js";

export { ArchiveConsoleWebService } from "./console/service.js";

type PeerLike = Parameters<typeof utils.getPeerId>[0];

export class ArchiveSyncAction implements ActionHandler<ArchiveConfig> {
  async run(ctx: ActionContext<ArchiveConfig>): Promise<void> {
    const config = ctx.config;
    if (!config || typeof config !== "object") {
      throw new Error("archive config must be a mapping with chats");
    }
    const targets = buildTargets(config);
    if (!targets.length) throw new Error("archive config must include chats");
    const sessions = ctx.sessions;
    if (!sessions || !ctx.session) throw new Error("archive sync needs a session");

    const store = createArchiveStore({
      url: config.url,
      schema: config.schema
    });
    const batchSize = Math.max(1, coerceInt(config.batchSize, 50));
    const archiver = new MessageArchiver({
      store,
      mediaDir: config.mediaDir ?? "data/downloads",
      downloadMedia: coerceBool(config.downloadMedia, true),
      batchSize,
      shouldStop: () => ctx.signal.aborted,
      submit: (operation) => sessions.run((client: unknown) => operation(client as ArchiveClient)),
      chatIdOf: (entity) => String(utils.getPeerId(entity as PeerLike)),
      logger: ctx.logger
    });

    try {
      await store.init();
      const backend = resolveBackend(config.url);
      let totalMessages = 0;
      let totalMedia = 0;
      let totalSkipped = 0;
      for (const target of targets) {
        ctx.logger.info(
          `archive chat=${target.chat} daysBack=${target.daysBack} maxMessages=${target.maxMessages} ` +
          `downloadMedia=${target.downloadMedia} resume=${target.resume} batchSize=${batchSize} ` +
          `backend=${backend} media=${config.mediaDir ?? "data/downloads"}`
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
      ctx.logger.info(
        `archive summary chats=${targets.length} messages=${totalMessages} media=${totalMedia} skipped=${totalSkipped}`
      );
    } finally {
      await store.close();
    }
  }
}
