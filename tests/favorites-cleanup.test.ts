import { test } from "node:test";
import assert from "node:assert/strict";
import { FavoritesCleanupAction } from "@paperkite/plugin-favorites-cleanup";
import type { ActionContext, RuntimeLogger } from "@paperkite/sdk";

interface FakeMessage {
  readonly id: number;
  readonly fwdFrom?: unknown;
  readonly media?: unknown;
  readonly groupedId?: number;
  readonly message?: string;
}

type ProbeBehavior = "valid" | "expired" | "error";

class FakeClient {
  readonly messages: FakeMessage[] = [];
  readonly probes = new Map<number, ProbeBehavior>();
  readonly deleted: number[] = [];
  probeCount = 0;
  deleteCount = 0;
  lastLimit: number | undefined;

  async *iterMessages(_entity: unknown, options: Record<string, unknown>): AsyncIterable<unknown> {
    const limit = options.limit as number | undefined;
    this.lastLimit = limit;
    const shown = limit === undefined ? this.messages : this.messages.slice(0, limit);
    for (const message of shown) yield message;
  }

  async downloadMedia(message: unknown, options: { outputFile?: unknown }): Promise<unknown> {
    const id = (message as FakeMessage).id;
    const behavior = this.probes.get(id) ?? "valid";
    this.probeCount += 1;
    const writer = options.outputFile as { write(): void };
    if (behavior === "valid") {
      writer.write();
      throw new Error("unreachable");
    }
    if (behavior === "expired") throw { errorMessage: "FILE_REFERENCE_EXPIRED", code: 400 };
    throw new Error("connection reset");
  }

  async deleteMessages(_entity: unknown, ids: readonly number[], _options: { revoke: boolean }): Promise<unknown> {
    this.deleteCount += 1;
    this.deleted.push(...ids);
    return undefined;
  }
}

interface CleanupConfig {
  readonly maxMessages?: number;
  readonly dryRun?: boolean;
}

function contextFor(client: FakeClient, config: CleanupConfig = {}, signal?: AbortSignal): ActionContext<CleanupConfig> {
  const logger: RuntimeLogger = {
    debug(): void {},
    info(): void {},
    warn(): void {},
    error(): void {},
    child(): RuntimeLogger {
      return logger;
    }
  };
  return {
    id: "test-cleanup",
    abi: 0,
    config,
    session: "primary",
    signal: signal ?? new AbortController().signal,
    sessions: { run: async (operation) => operation(client) },
    logger,
    emission: undefined,
    spawn(): void {}
  };
}

function forwardedFile(id: number, mediaClassName: string, groupedId?: number): FakeMessage {
  return { id, fwdFrom: {}, media: { className: mediaClassName }, ...(groupedId !== undefined ? { groupedId } : {}) };
}

test("deletes only expired forwarded files and keeps everything else", async () => {
  const client = new FakeClient();
  client.messages.push(
    forwardedFile(1, "MessageMediaPhoto"),
    forwardedFile(2, "MessageMediaDocument"),
    forwardedFile(3, "MessageMediaDocument"),
    forwardedFile(4, "MessageMediaContact"),
    { id: 5, media: { className: "MessageMediaPhoto" } }
  );
  client.probes.set(2, "expired");
  client.probes.set(3, "error");

  await new FavoritesCleanupAction().run(contextFor(client));

  assert.equal(client.probeCount, 3);
  assert.equal(client.deleteCount, 1);
  assert.deepEqual(client.deleted, [2]);
});

test("deletes expired files together with their album group", async () => {
  const client = new FakeClient();
  client.messages.push(forwardedFile(10, "MessageMediaDocument", 7), forwardedFile(11, "MessageMediaDocument", 7), forwardedFile(12, "MessageMediaDocument", 7));
  client.probes.set(10, "expired");

  await new FavoritesCleanupAction().run(contextFor(client));

  assert.deepEqual(client.deleted, [10, 11, 12]);
});

test("deletes forwarded placeholders of banned channels", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 20, fwdFrom: {}, message: "This channel can't be displayed because it violated Telegram's Terms of Service." },
    { id: 21, fwdFrom: {}, message: "This channel can’t be displayed because it violated Telegram's Terms of Service." },
    { id: 22, fwdFrom: {}, message: "This channel CAN'T be displayed because it violated Telegram's Terms of Service." }
  );

  await new FavoritesCleanupAction().run(contextFor(client));

  assert.equal(client.probeCount, 0);
  assert.equal(client.deleteCount, 1);
  assert.deepEqual(client.deleted, [20, 21, 22]);
});

test("keeps ordinary forwarded text", async () => {
  const client = new FakeClient();
  client.messages.push({ id: 31, fwdFrom: {}, message: "普通文字转发" });

  await new FavoritesCleanupAction().run(contextFor(client));

  assert.equal(client.probeCount, 0);
  assert.equal(client.deleteCount, 0);
  assert.deepEqual(client.deleted, []);
});

test("dry run reports expired files without deleting", async () => {
  const client = new FakeClient();
  client.messages.push(forwardedFile(2, "MessageMediaDocument"));
  client.probes.set(2, "expired");

  await new FavoritesCleanupAction().run(contextFor(client, { dryRun: true }));

  assert.equal(client.probeCount, 1);
  assert.equal(client.deleteCount, 0);
  assert.deepEqual(client.deleted, []);
});

test("scans at most maxMessages from the newest message", async () => {
  const client = new FakeClient();
  client.messages.push(forwardedFile(1, "MessageMediaDocument"), forwardedFile(2, "MessageMediaDocument"), forwardedFile(3, "MessageMediaDocument"));

  await new FavoritesCleanupAction().run(contextFor(client, { maxMessages: 2 }));

  assert.equal(client.lastLimit, 2);
  assert.equal(client.probeCount, 2);
});

test("defaults the scan limit to 500", async () => {
  const client = new FakeClient();
  await new FavoritesCleanupAction().run(contextFor(client));
  assert.equal(client.lastLimit, 500);
});

test("rejects a negative scan limit", async () => {
  const client = new FakeClient();
  await assert.rejects(
    () => new FavoritesCleanupAction().run(contextFor(client, { maxMessages: -1 })),
    /maxMessages must be a non-negative integer/
  );
});

test("stops immediately when aborted", async () => {
  const client = new FakeClient();
  client.messages.push(forwardedFile(1, "MessageMediaDocument"));
  client.probes.set(1, "expired");
  const controller = new AbortController();
  controller.abort();

  await new FavoritesCleanupAction().run(contextFor(client, {}, controller.signal));

  assert.equal(client.probeCount, 0);
  assert.equal(client.deleteCount, 0);
});