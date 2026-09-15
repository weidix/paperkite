import { test } from "node:test";
import assert from "node:assert/strict";
import { FavoritesRepostAction } from "@paperkite/plugin-favorites-repost";
import type { ActionContext, RuntimeLogger, SessionClient } from "@paperkite/sdk";

interface FakeMessage {
  readonly id: number;
  readonly fwdFrom?: unknown;
  readonly groupedId?: number;
  readonly media?: unknown;
  readonly message?: string;
}

interface RepostTestConfig {
  readonly maxMessages?: number;
  readonly scope?: "forwards" | "tail";
  readonly deleteOriginal?: boolean;
  readonly dryRun?: boolean;
  readonly adoptCopies?: boolean;
}

const COPY_ID_BASE = 1_000;

class FakeClient {
  readonly messages: FakeMessage[] = [];
  readonly forwarded: Array<Record<string, unknown>> = [];
  readonly deleted: number[] = [];
  readonly surviving = new Set<number>();
  forwardError: string | undefined;
  deleteError: string | undefined;
  lastLimit: number | undefined;
  private copySeq = COPY_ID_BASE;

  async *iterMessages(_entity: unknown, options: Record<string, unknown>): AsyncIterable<unknown> {
    const limit = options.limit as number | undefined;
    this.lastLimit = limit;
    const shown = limit === undefined ? this.messages : this.messages.slice(0, limit);
    for (const message of shown) yield message;
  }

  async forwardMessages(_entity: unknown, options: Record<string, unknown>): Promise<readonly unknown[]> {
    const ids = options.messages as number[];
    this.forwarded.push({ ...options, messages: [...ids] });
    if (this.forwardError) throw new Error(this.forwardError);
    const created = ids.map((id) => ({
      id: this.copySeq++,
      ...(this.surviving.has(id) ? { fwdFrom: { fromId: { userId: 7 } } } : {})
    }));
    // gramjs 的 forwardMessages 按来源会话分组返回，每组是一个消息数组
    return [created];
  }

  async deleteMessages(_entity: unknown, ids: readonly number[], _options: { revoke: boolean }): Promise<unknown> {
    if (this.deleteError) throw new Error(this.deleteError);
    this.deleted.push(...ids);
    return undefined;
  }
}

function contextFor(
  client: FakeClient,
  config: RepostTestConfig = {},
  signal?: AbortSignal
): ActionContext<RepostTestConfig> {
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
    id: "test-repost",
    abi: 0,
    config,
    session: "primary",
    signal: signal ?? new AbortController().signal,
    sessions: { run: async (operation) => operation(client as unknown as SessionClient) },
    logger,
    emission: undefined,
    spawn(): void {}
  };
}

function batchIds(client: FakeClient): unknown[] {
  return client.forwarded.map((batch) => batch.messages);
}

test("hides the sender of visible forwards in the original order", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 5 },
    { id: 3, fwdFrom: { fromId: { channelId: 9 } } },
    { id: 2, fwdFrom: { fromName: "已注销账号" } },
    { id: 1, fwdFrom: { fromId: { userId: 7 } } }
  );

  await new FavoritesRepostAction().run(contextFor(client));

  assert.deepEqual(batchIds(client), [[1], [2], [3]]);
  assert.deepEqual(client.deleted, [1, 2, 3]);
  assert.equal(client.forwarded[0]?.dropAuthor, true);
  assert.equal(client.forwarded[0]?.fromPeer, "me");
});

test("leaves messages without a visible sender untouched", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 3, fwdFrom: {} },
    { id: 2 },
    { id: 1, fwdFrom: { savedFromPeer: { userId: 7 } } }
  );

  await new FavoritesRepostAction().run(contextFor(client));

  assert.deepEqual(client.forwarded, []);
  assert.deepEqual(client.deleted, []);
});

test("reposts a whole album when a single member shows its sender", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 12, groupedId: 7, fwdFrom: { fromId: { channelId: 9 } } },
    { id: 11, groupedId: 7 },
    { id: 10, groupedId: 7 }
  );

  await new FavoritesRepostAction().run(contextFor(client));

  assert.deepEqual(batchIds(client), [[10, 11, 12]]);
  assert.deepEqual(client.deleted, [10, 11, 12]);
});

test("rolls back copies whose sender survives the hidden forward", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 2, fwdFrom: { fromId: { userId: 7 } } },
    { id: 1, fwdFrom: { fromId: { userId: 7 } } }
  );
  client.surviving.add(2);

  await new FavoritesRepostAction().run(contextFor(client));

  assert.deepEqual(batchIds(client), [[1], [2]]);
  assert.deepEqual(client.deleted, [1, COPY_ID_BASE + 1]);
});

test("keeps originals when the forward request fails", async () => {
  const client = new FakeClient();
  client.messages.push({ id: 1, fwdFrom: { fromId: { userId: 7 } } });
  client.forwardError = "FLOOD_WAIT_120";

  await new FavoritesRepostAction().run(contextFor(client));

  assert.equal(client.forwarded.length, 1);
  assert.deepEqual(client.deleted, []);
});

test("dry run reports the plan without touching the collection", async () => {
  const client = new FakeClient();
  client.messages.push({ id: 2, fwdFrom: { fromId: {} } }, { id: 1, fwdFrom: { fromId: {} } });

  await new FavoritesRepostAction().run(contextFor(client, { dryRun: true }));

  assert.deepEqual(client.forwarded, []);
  assert.deepEqual(client.deleted, []);
});

test("keeps originals when deleteOriginal is false", async () => {
  const client = new FakeClient();
  client.messages.push({ id: 1, fwdFrom: { fromId: {} } });

  await new FavoritesRepostAction().run(contextFor(client, { deleteOriginal: false }));

  assert.deepEqual(batchIds(client), [[1]]);
  assert.deepEqual(client.deleted, []);
});

test("keeps processing when deleting an original fails", async () => {
  const client = new FakeClient();
  client.messages.push({ id: 2, fwdFrom: { fromId: {} } }, { id: 1, fwdFrom: { fromId: {} } });
  client.deleteError = "MESSAGE_DELETE_FORBIDDEN";

  await new FavoritesRepostAction().run(contextFor(client));

  assert.deepEqual(batchIds(client), [[1], [2]]);
  assert.deepEqual(client.deleted, []);
});

test("tail scope reposts the collection from the oldest affected message", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 6 },
    { id: 5, fwdFrom: { fromId: {} } },
    { id: 4 },
    { id: 3 },
    { id: 2, fwdFrom: { fromId: {} } },
    { id: 1 }
  );

  await new FavoritesRepostAction().run(contextFor(client, { scope: "tail" }));

  assert.equal(client.lastLimit, undefined);
  assert.deepEqual(batchIds(client), [[2], [3], [4], [5], [6]]);
  assert.deepEqual(client.deleted, [2, 3, 4, 5, 6]);
});

test("adopts appended hidden copies by deleting the originals", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 13, media: { photo: { id: 66 } } },
    { id: 12, media: { document: { id: 77 } } },
    { id: 2, fwdFrom: { fromId: { userId: 7 } }, media: { photo: { id: 66 } } },
    { id: 1, fwdFrom: { fromId: { userId: 7 } }, media: { document: { id: 77 } } }
  );

  await new FavoritesRepostAction().run(contextFor(client, { adoptCopies: true }));

  assert.deepEqual(client.forwarded, []);
  assert.deepEqual(client.deleted, [1, 2]);
});

test("adopts a link preview whose copy keeps only the text", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 12, message: "小屋出品" },
    { id: 1, fwdFrom: { fromId: { userId: 7 } }, media: { webpage: { url: "https://t.me/x" } }, message: "小屋出品" }
  );

  await new FavoritesRepostAction().run(contextFor(client, { adoptCopies: true }));

  assert.deepEqual(client.deleted, [1]);
});

test("refuses to adopt when the newest messages do not mirror the forwards", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 12, media: { document: { id: 99 } } },
    { id: 1, fwdFrom: { fromId: { userId: 7 } }, media: { document: { id: 77 } } }
  );

  await assert.rejects(
    () => new FavoritesRepostAction().run(contextFor(client, { adoptCopies: true })),
    /do not mirror the forwarded messages/
  );
  assert.deepEqual(client.deleted, []);
});

test("keeps originals when the matching newest messages still show a sender", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 2, fwdFrom: { fromId: { userId: 9 } }, media: { document: { id: 77 } } },
    { id: 1, fwdFrom: { fromId: { userId: 7 } }, media: { document: { id: 77 } } }
  );

  await new FavoritesRepostAction().run(contextFor(client, { adoptCopies: true }));

  assert.deepEqual(client.deleted, []);
});

test("adopt dry run verifies without deleting", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 12, media: { document: { id: 77 } } },
    { id: 1, fwdFrom: { fromId: { userId: 7 } }, media: { document: { id: 77 } } }
  );

  await new FavoritesRepostAction().run(contextFor(client, { adoptCopies: true, dryRun: true }));

  assert.deepEqual(client.deleted, []);
});

test("scans at most maxMessages from the newest message", async () => {
  const client = new FakeClient();
  client.messages.push(
    { id: 3, fwdFrom: { fromId: {} } },
    { id: 2, fwdFrom: { fromId: {} } },
    { id: 1, fwdFrom: { fromId: {} } }
  );

  await new FavoritesRepostAction().run(contextFor(client, { maxMessages: 2 }));

  assert.equal(client.lastLimit, 2);
  assert.deepEqual(batchIds(client), [[2], [3]]);
});

test("defaults the scan limit to 500", async () => {
  const client = new FakeClient();
  await new FavoritesRepostAction().run(contextFor(client));
  assert.equal(client.lastLimit, 500);
});

test("rejects a negative scan limit", async () => {
  const client = new FakeClient();
  await assert.rejects(
    () => new FavoritesRepostAction().run(contextFor(client, { maxMessages: -1 })),
    /maxMessages must be a non-negative integer/
  );
});

test("rejects an unknown scope", async () => {
  const client = new FakeClient();
  await assert.rejects(
    () => new FavoritesRepostAction().run(contextFor(client, { scope: "everything" as never })),
    /scope must be "forwards" or "tail"/
  );
});

test("stops immediately when aborted", async () => {
  const client = new FakeClient();
  client.messages.push({ id: 1, fwdFrom: { fromId: {} } });
  const controller = new AbortController();
  controller.abort();

  await new FavoritesRepostAction().run(contextFor(client, {}, controller.signal));

  assert.deepEqual(client.forwarded, []);
  assert.deepEqual(client.deleted, []);
});
