import type { ActionContext, ActionHandler, RuntimeLogger, SessionClient } from "@paperkite/sdk";

type RepostScope = "forwards" | "tail";

type BatchOutcome = "converted" | "blocked" | "failed";

interface RepostConfig {
  readonly maxMessages?: number;
  readonly scope?: RepostScope;
  readonly deleteOriginal?: boolean;
  readonly dryRun?: boolean;
  readonly adoptCopies?: boolean;
}

interface Entry {
  readonly id: number;
  readonly groupedId?: string;
  readonly visibleSender: boolean;
  readonly key: string;
}

interface NormalizedConfig {
  readonly scope: RepostScope;
  readonly deleteOriginal: boolean;
  readonly dryRun: boolean;
  readonly adoptCopies: boolean;
  readonly limit: number | undefined;
}

interface Counters {
  scanned: number;
  candidates: number;
  converted: number;
  blocked: number;
  failed: number;
  deleted: number;
}

export class FavoritesRepostAction implements ActionHandler<RepostConfig> {
  async run(ctx: ActionContext<RepostConfig>): Promise<void> {
    const sessions = ctx.sessions;
    if (!sessions || !ctx.session) throw new Error("favorites repost needs a session");
    const config = normalizeConfig(ctx.config);
    await sessions.run((client) => repost(ctx, client, config));
  }
}

async function repost(
  ctx: ActionContext<RepostConfig>,
  client: SessionClient,
  config: NormalizedConfig
): Promise<void> {
  if (config.adoptCopies) {
    await adoptCopies(ctx, client, config);
    return;
  }
  const entries = await collect(client, config.limit, ctx.signal);
  if (ctx.signal.aborted) return;
  const candidates = entries.filter((entry) => entry.visibleSender);
  const batches = planBatches(entries, candidates, config.scope);
  const counters: Counters = {
    scanned: entries.length,
    candidates: candidates.length,
    converted: 0,
    blocked: 0,
    failed: 0,
    deleted: 0
  };

  if (config.dryRun) {
    counters.converted = batches.reduce((total, ids) => total + ids.length, 0);
  } else {
    for (const ids of batches) {
      if (ctx.signal.aborted) return;
      const outcome = await convertBatch(client, ids, ctx.logger);
      if (outcome === "blocked") {
        counters.blocked += ids.length;
        continue;
      }
      if (outcome === "failed") {
        counters.failed += ids.length;
        continue;
      }
      counters.converted += ids.length;
      if (!config.deleteOriginal) continue;
      try {
        await client.deleteMessages("me", ids, { revoke: true });
      } catch (error) {
        ctx.logger.warn("favorites repost: deleting the original failed", { ids: ids.join(","), error: String(error) });
        continue;
      }
      counters.deleted += ids.length;
    }
  }

  ctx.logger.info(
    `favorites repost${config.dryRun ? " (dry run)" : ""}: scanned=${counters.scanned} ` +
    `candidates=${counters.candidates} converted=${counters.converted} blocked=${counters.blocked} ` +
    `failed=${counters.failed} deleted=${counters.deleted}` +
    (config.dryRun && batches.length > 0 ? ` plannedIds=${batches.flat().join(",")}` : "")
  );
}

async function collect(
  client: SessionClient,
  limit: number | undefined,
  signal: AbortSignal
): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const raw of client.iterMessages("me", { limit })) {
    if (signal.aborted) break;
    const message = recordOf(raw);
    const id = positiveId(message?.id);
    if (!message || id === undefined) continue;
    const groupedId = textOf(message.groupedId);
    entries.push({
      id,
      visibleSender: hasVisibleSender(message),
      key: contentKeyOf(message),
      ...(groupedId !== undefined ? { groupedId } : {})
    });
  }
  return entries.sort((left, right) => left.id - right.id);
}

async function convertBatch(
  client: SessionClient,
  ids: readonly number[],
  logger: RuntimeLogger
): Promise<BatchOutcome> {
  let sent: readonly unknown[];
  try {
    sent = await client.forwardMessages("me", { messages: [...ids], fromPeer: "me", dropAuthor: true });
  } catch (error) {
    logger.warn("favorites repost: forward failed, messages kept", { ids: ids.join(","), error: String(error) });
    return "failed";
  }
  const created = flattenSent(sent);
  const copies = created.map((message) => positiveId(recordOf(message)?.id)).filter(isNumber);
  if (copies.length === ids.length && !created.some(hasVisibleSender)) return "converted";
  if (copies.length > 0) {
    try {
      await client.deleteMessages("me", copies, { revoke: true });
    } catch (error) {
      logger.warn("favorites repost: rollback of hidden copies failed", { ids: copies.join(","), error: String(error) });
    }
  }
  if (copies.length === ids.length) {
    logger.warn("favorites repost: sender survived the hidden forward, messages kept", { ids: ids.join(",") });
    return "blocked";
  }
  logger.warn("favorites repost: forward returned no matching copies, messages kept", { ids: ids.join(",") });
  return "failed";
}

/** 一次性清理：收藏里已有本插件追加的隐藏副本时，核对最新一批消息与转发原消息逐条对应，通过后只删除原消息。 */
async function adoptCopies(
  ctx: ActionContext<RepostConfig>,
  client: SessionClient,
  config: NormalizedConfig
): Promise<void> {
  const entries = await collect(client, undefined, ctx.signal);
  if (ctx.signal.aborted) return;
  const candidates = entries.filter((entry) => entry.visibleSender);
  const counters = { scanned: entries.length, candidates: candidates.length, adopted: 0, kept: 0, deleted: 0 };
  if (candidates.length > 0) {
    const block = entries.slice(-candidates.length);
    const mirrored =
      block.length === candidates.length &&
      candidates.every((entry, index) => block[index]?.key === entry.key);
    if (!mirrored) {
      throw new Error("adoptCopies: the newest messages do not mirror the forwarded messages, nothing deleted");
    }
    const adopted = candidates.filter((entry, index) => !block[index]?.visibleSender);
    counters.kept = candidates.length - adopted.length;
    counters.adopted = adopted.length;
    if (!config.dryRun && adopted.length > 0) {
      await client.deleteMessages("me", adopted.map((entry) => entry.id), { revoke: true });
      counters.deleted = adopted.length;
    }
  }
  ctx.logger.info(
    `favorites repost adopt${config.dryRun ? " (dry run)" : ""}: scanned=${counters.scanned} ` +
    `candidates=${counters.candidates} adopted=${counters.adopted} kept=${counters.kept} deleted=${counters.deleted}`
  );
}

/** forwardMessages 按来源会话分组返回，每组是一个消息数组；展平一层得到本次创建的消息。 */
function flattenSent(sent: readonly unknown[]): readonly unknown[] {
  return sent.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

function planBatches(entries: readonly Entry[], candidates: readonly Entry[], scope: RepostScope): number[][] {
  if (candidates.length === 0) return [];
  const albums = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.groupedId === undefined) continue;
    const members = albums.get(entry.groupedId);
    if (members) members.push(entry);
    else albums.set(entry.groupedId, [entry]);
  }
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const firstCandidateId = candidates[0]?.id ?? 0;
  const affects = (entry: Entry): boolean =>
    scope === "tail" ? entry.id >= firstCandidateId : candidateIds.has(entry.id);
  const batches: number[][] = [];
  const grouped = new Set<string>();
  for (const entry of entries) {
    if (entry.groupedId !== undefined) {
      if (grouped.has(entry.groupedId)) continue;
      grouped.add(entry.groupedId);
      const members = albums.get(entry.groupedId) ?? [];
      if (members.some(affects)) batches.push(members.map((member) => member.id));
      continue;
    }
    if (affects(entry)) batches.push([entry.id]);
  }
  return batches;
}

function normalizeConfig(config: RepostConfig): NormalizedConfig {
  const scope = config.scope ?? "forwards";
  if (scope !== "forwards" && scope !== "tail") throw new Error('scope must be "forwards" or "tail"');
  return {
    scope,
    deleteOriginal: config.deleteOriginal !== false,
    dryRun: config.dryRun === true,
    adoptCopies: config.adoptCopies === true,
    limit: scope === "tail" ? undefined : scanLimit(config.maxMessages)
  };
}

function scanLimit(value: number | undefined): number | undefined {
  if (value === undefined) return 500;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("maxMessages must be a non-negative integer");
  }
  return number === 0 ? undefined : number;
}

/** 转发头带发送者，说明本条转发在收藏里显示发送者姓名。 */
function hasVisibleSender(value: unknown): boolean {
  const forward = recordOf(recordOf(value)?.fwdFrom);
  if (!forward) return false;
  return (forward.fromId !== undefined && forward.fromId !== null) || textOf(forward.fromName) !== undefined;
}

/** 内容的稳定标识：媒体文件 ID 或文本，用来核对副本与原消息逐条对应。 */
function contentKeyOf(message: Record<string, unknown>): string {
  const media = recordOf(message.media);
  const photo = recordOf(media?.photo);
  if (photo?.id !== undefined && photo.id !== null) return "photo:" + String(photo.id);
  const document = recordOf(media?.document);
  if (document?.id !== undefined && document.id !== null) return "document:" + String(document.id);
  return "text:" + (textOf(message.message) ?? "");
}

function positiveId(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}

function textOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}
