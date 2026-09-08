import { Action, type RuntimeLogger } from "@paperkite/sdk";

interface CleanupConfig {
  readonly maxMessages?: number;
  readonly dryRun?: boolean;
}

interface FavoritesClient {
  iterMessages(entity: unknown, options: Record<string, unknown>): AsyncIterable<unknown>;
  downloadMedia(message: unknown, options: { outputFile?: unknown; thumb?: unknown }): Promise<unknown>;
  deleteMessages(entity: unknown, ids: readonly number[], options: { revoke: boolean }): Promise<unknown>;
}

interface Candidate {
  readonly id: number;
  readonly groupedId?: string;
  readonly raw: Record<string, unknown>;
}

type ProbeResult = "valid" | "expired" | "failed";

const EXPIRED_ERRORS = new Set(["FILE_REFERENCE_EXPIRED", "FILE_REFERENCES_EMPTY", "MEDIA_EMPTY"]);

class ProbeAbortedError extends Error {}

class ProbeWriter {
  satisfied = false;

  write(): void {
    this.satisfied = true;
    throw new ProbeAbortedError("probe satisfied");
  }

  close(): void {}
}

export class FavoritesCleanupAction extends Action<CleanupConfig> {
  protected async run(): Promise<void> {
    if (!this.sessions || !this.session) throw new Error("favorites cleanup needs a session");
    await this.sessions.run((client) => this.cleanup(client as FavoritesClient));
  }

  private async cleanup(client: FavoritesClient): Promise<void> {
    const dryRun = this.config.dryRun === true;
    const candidates: Candidate[] = [];
    const groups = new Map<string, number[]>();
    let scanned = 0;

    for await (const raw of client.iterMessages("me", { limit: scanLimit(this.config.maxMessages) })) {
      if (this.signal.aborted) return;
      scanned += 1;
      const message = recordOf(raw);
      const id = positiveId(message?.id);
      if (!message || id === undefined) continue;
      if (!forwardOf(message)) continue;
      const groupedId = groupedIdOf(message);
      candidates.push({ id, raw: message, ...(groupedId !== undefined ? { groupedId } : {}) });
      if (groupedId !== undefined) pushGroup(groups, groupedId, id);
    }

    const expired: number[] = [];
    const counts = { valid: 0, failed: 0, unavailable: 0 };
    for (const candidate of candidates) {
      if (this.signal.aborted) return;
      if (fileMediaOf(candidate.raw.media)) {
        const result = await probeFile(client, candidate.raw, this.context.logger);
        if (result === "expired") expired.push(candidate.id);
        else if (result === "valid") counts.valid += 1;
        else counts.failed += 1;
        continue;
      }
      if (unavailableOf(candidate.raw)) {
        counts.unavailable += 1;
        expired.push(candidate.id);
      }
    }

    const deleteIds = collectDeleteIds(expired, groups);
    if (!dryRun && deleteIds.length > 0) {
      await client.deleteMessages("me", deleteIds, { revoke: true });
    }

    this.context.logger.info(
      `favorites cleanup${dryRun ? " (dry run)" : ""}: scanned=${scanned} ` +
      `forwarded=${candidates.length} valid=${counts.valid} expired=${expired.length} ` +
      `unavailable=${counts.unavailable} failed=${counts.failed} deleted=${deleteIds.length}` +
      (expired.length > 0 ? ` expiredIds=${expired.join(",")}` : "")
    );
  }
}

async function probeFile(
  client: FavoritesClient,
  message: Record<string, unknown>,
  logger: RuntimeLogger
): Promise<ProbeResult> {
  if (!fileMediaOf(message.media)) return "failed";
  const writer = new ProbeWriter();
  try {
    await client.downloadMedia(message, { outputFile: writer, thumb: probeThumb(message.media) });
  } catch (error) {
    if (writer.satisfied) return "valid";
    if (isExpiredError(error)) return "expired";
    logger.warn("favorites cleanup: media probe failed, message kept", { error: String(error) });
    return "failed";
  }
  return "valid";
}

function collectDeleteIds(expired: readonly number[], groups: Map<string, number[]>): number[] {
  const expiredSet = new Set(expired);
  const result = new Set(expired);
  for (const members of groups.values()) {
    if (members.some((id) => expiredSet.has(id))) {
      members.forEach((id) => result.add(id));
    }
  }
  return [...result];
}

function scanLimit(value: number | undefined): number | undefined {
  if (value === undefined) return 500;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("maxMessages must be a non-negative integer");
  }
  return number === 0 ? undefined : number;
}

function forwardOf(message: Record<string, unknown>): boolean {
  return message.fwdFrom !== undefined && message.fwdFrom !== null;
}

const UNAVAILABLE_FORWARD_PATTERN = /^This (channel|message) can['\u2019]t be displayed/i;

function unavailableOf(message: Record<string, unknown>): boolean {
  const text = typeof message.message === "string" ? message.message : "";
  return UNAVAILABLE_FORWARD_PATTERN.test(text);
}

function fileMediaOf(media: unknown): boolean {
  const name = className(media);
  return name === "MessageMediaPhoto" || name === "MessageMediaDocument";
}

function probeThumb(media: unknown): unknown | undefined {
  if (className(media) !== "MessageMediaDocument") return undefined;
  const thumbs = recordArray(recordOf(recordOf(media)?.document), "thumbs");
  let best: unknown;
  let bestSize = -1;
  for (const thumb of thumbs) {
    const name = className(thumb);
    if (name !== "PhotoSize" && name !== "VideoSize") continue;
    const size = Number(recordOf(thumb)?.size ?? 0);
    if (size > bestSize) {
      bestSize = size;
      best = thumb;
    }
  }
  return best;
}

function isExpiredError(error: unknown): boolean {
  const record = recordOf(error);
  if (!record) return false;
  const message = typeof record.errorMessage === "string" ? record.errorMessage : record.message;
  if (typeof message !== "string" || !message) return false;
  if (/UPGRADE|MIGRATE/i.test(message)) return false;
  return EXPIRED_ERRORS.has(message) || /^FILE_REFERENCE/i.test(message);
}

function groupedIdOf(message: Record<string, unknown>): string | undefined {
  const value = message.groupedId;
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function positiveId(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function pushGroup(groups: Map<string, number[]>, groupedId: string, id: number): void {
  const members = groups.get(groupedId);
  if (members) members.push(id);
  else groups.set(groupedId, [id]);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function recordArray(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function className(value: unknown): string {
  const record = recordOf(value);
  if (record && typeof record.className === "string" && record.className) return record.className;
  return (value as { constructor?: { name?: string } })?.constructor?.name ?? "";
}