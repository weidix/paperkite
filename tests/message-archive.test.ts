import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteArchiveStore, type ArchiveStore } from "../packages/message-archive/src/storage/index.js";
import { MessageArchiver, type ArchiveClient, type TelegramMessage } from "../packages/message-archive/src/archiver.js";
import { buildTargets } from "../packages/message-archive/src/config.js";
import type { RuntimeLogger } from "@paperkite/sdk";

const logger: RuntimeLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
const CHAT_ID = "100";
const EPOCH_MS = Date.now() - 10 * 86_400_000;

interface FakeMedia extends Record<string, unknown> {
  className?: string;
}

class FakeMessage implements TelegramMessage {
  downloads = 0;
  readonly sender = { id: 7, username: "tester", firstName: "F", lastName: "L" };
  readonly senderId = 7;

  constructor(
    readonly id: number,
    readonly media: FakeMedia | undefined = undefined,
    readonly groupedId: number | undefined = undefined,
    readonly message?: string,
    readonly entities?: readonly unknown[]
  ) {}

  get date(): number {
    return Math.floor((EPOCH_MS + this.id * 3_600_000) / 1_000);
  }

  get text(): string {
    return `m${this.id}`;
  }
}

class FakeClient implements ArchiveClient {
  messages = new Map<number, FakeMessage>();
  iterRequests: { limit: number; maxId: number }[] = [];

  async getEntity(identifier: string | number): Promise<unknown> {
    if (String(identifier).toLowerCase().includes("missing")) throw new Error("not found");
    return { id: 100, title: "Test Chat", username: "test_chat" };
  }

  async *iterDialogs(): AsyncGenerator<never> {}

  iterMessages(_entity: unknown, options: { limit: number; maxId: number }): AsyncIterable<TelegramMessage> {
    this.iterRequests.push(options);
    const ids = [...this.messages.keys()]
      .filter((id) => !options.maxId || id < options.maxId)
      .sort((a, b) => b - a)
      .slice(0, options.limit);
    const messages = this.messages;
    return {
      async *[Symbol.asyncIterator]() {
        for (const id of ids) yield messages.get(id)!;
      }
    };
  }

  async getMessages(_entity: unknown, options: { ids: readonly number[] }): Promise<readonly TelegramMessage[]> {
    return options.ids.map((id) => this.messages.get(id)).filter((message): message is FakeMessage => Boolean(message));
  }

  async downloadMedia(message: TelegramMessage, options: { outputFile?: string }): Promise<string | undefined> {
    (message as FakeMessage).downloads += 1;
    return options.outputFile;
  }
}

class CountingStore implements ArchiveStore {
  inserted = 0;

  constructor(private readonly inner: ArchiveStore) {}

  init(): Promise<void> { return this.inner.init(); }
  close(): Promise<void> { return this.inner.close(); }
  saveChat(chat: Parameters<ArchiveStore["saveChat"]>[0]): Promise<boolean> { return this.inner.saveChat(chat); }
  startSyncSession(chatId: string, startDate: string, endDate: string): Promise<number> {
    return this.inner.startSyncSession(chatId, startDate, endDate);
  }
  completeSyncSession(sessionId: number, messagesCount: number, mediaCount: number): Promise<void> {
    return this.inner.completeSyncSession(sessionId, messagesCount, mediaCount);
  }
  getLastMessageInfo(chatId: string) { return this.inner.getLastMessageInfo(chatId); }
  getChatUsername(chatId: string) { return this.inner.getChatUsername(chatId); }
  messageIdsExist(chatId: string, messageIds: readonly number[]) { return this.inner.messageIdsExist(chatId, messageIds); }
  async saveBatch(messages: Parameters<ArchiveStore["saveBatch"]>[0], media: Parameters<ArchiveStore["saveBatch"]>[1]) {
    const result = await this.inner.saveBatch(messages, media);
    this.inserted += result.messages;
    return result;
  }
  searchStructured(query: Parameters<ArchiveStore["searchStructured"]>[0]) { return this.inner.searchStructured(query); }
  listChatLedger(limit: number) { return this.inner.listChatLedger(limit); }
  getMessageContext(rowId: string, beforeN: number, afterN: number) { return this.inner.getMessageContext(rowId, beforeN, afterN); }
  getMessageByRowId(rowId: string) { return this.inner.getMessageByRowId(rowId); }
  getMediaFileById(id: string) { return this.inner.getMediaFileById(id); }
}

interface Harness {
  client: FakeClient;
  store: CountingStore;
  archiver: MessageArchiver;
  submissions: number;
  stopAfterBatch: boolean;
  tmp: string;
}

async function harness(options: {
  batchSize?: number;
  downloadMedia?: boolean;
  messages?: readonly FakeMessage[];
} = {}): Promise<Harness> {
  const tmp = await mkdtemp(join(tmpdir(), "paperkite-archive-"));
  const store = new CountingStore(new SqliteArchiveStore(join(tmp, "archive.db")));
  await store.init();
  const client = new FakeClient();
  for (const message of options.messages ?? []) client.messages.set(message.id, message);
  const result: Harness = {
    client,
    store,
    submissions: 0,
    tmp,
    stopAfterBatch: false,
    archiver: undefined as unknown as MessageArchiver
  };
  result.archiver = new MessageArchiver({
    store,
    mediaPath: join(tmp, "downloads"),
    downloadMedia: options.downloadMedia ?? false,
    batchSize: options.batchSize ?? 50,
    shouldStop: () => result.stopAfterBatch && store.inserted >= 50,
    submit: (operation) => {
      result.submissions += 1;
      return Promise.resolve(operation(client));
    },
    chatIdOf: (entity) => String((entity as { id: number }).id),
    logger
  });
  return result;
}

function mediaMessages(count: number): FakeMessage[] {
  return Array.from({ length: count }, (_, index) => new FakeMessage(index + 1, { className: "MessageMediaPhoto" }));
}

test("archive batches stay bounded and pages descend by exclusive max id", async () => {
  const h = await harness({
    messages: Array.from({ length: 120 }, (_, index) => new FakeMessage(index + 1))
  });
  try {
    const result = await h.archiver.saveChatMessages("@test_chat");
    assert.deepEqual(result, { messages: 120, media: 0, skipped: 0 });
    // findChat 一次 + 每批一次取页（50/50/20）
    assert.equal(h.submissions, 4);
    assert.deepEqual(h.client.iterRequests.map((request) => request.maxId), [0, 71, 21]);
    assert.deepEqual(h.client.iterRequests.map((request) => request.limit), [50, 50, 50]);
  } finally {
    await h.store.close();
  }
});

test("archive max_messages cap spans batches", async () => {
  const h = await harness({
    messages: Array.from({ length: 120 }, (_, index) => new FakeMessage(index + 1))
  });
  try {
    const result = await h.archiver.saveChatMessages("@test_chat", { maxMessages: 75 });
    assert.equal(result.messages, 75);
    const total = await h.store.searchStructured({});
    assert.equal(total.total, 75);
  } finally {
    await h.store.close();
  }
});

test("interrupted archive resumes incrementally without rescanning below the anchor", async () => {
  const h = await harness({
    messages: Array.from({ length: 120 }, (_, index) => new FakeMessage(index + 1))
  });
  try {
    h.stopAfterBatch = true;
    const first = await h.archiver.saveChatMessages("@test_chat");
    assert.equal(first.messages, 50);

    // 无新增消息时，增量只触及锚点行本身（跳过），更老的区域不再重扫
    h.stopAfterBatch = false;
    const second = await h.archiver.saveChatMessages("@test_chat");
    assert.deepEqual(second, { messages: 0, media: 0, skipped: 1 });

    // 新增消息 121..130 从最新尾部补齐
    for (const id of [121, 122, 123, 124, 125, 126, 127, 128, 129, 130]) {
      h.client.messages.set(id, new FakeMessage(id));
    }
    const third = await h.archiver.saveChatMessages("@test_chat");
    assert.deepEqual(third, { messages: 10, media: 0, skipped: 1 });
    const total = await h.store.searchStructured({});
    assert.equal(total.total, 60);
  } finally {
    await h.store.close();
  }
});

test("archive downloads media only for newly saved messages", async () => {
  const h = await harness({
    messages: mediaMessages(80),
    downloadMedia: true
  });
  try {
    const first = await h.archiver.saveChatMessages("@test_chat");
    assert.deepEqual(first, { messages: 80, media: 80, skipped: 0 });
    assert.equal(sumDownloads(h.client), 80);

    for (let id = 81; id <= 90; id++) {
      h.client.messages.set(id, new FakeMessage(id, { className: "MessageMediaPhoto" }));
    }
    const second = await h.archiver.saveChatMessages("@test_chat");
    assert.equal(second.messages, 10);
    assert.equal(second.media, 10);
    assert.equal(second.skipped, 1);
    assert.equal(sumDownloads(h.client), 90);
  } finally {
    await h.store.close();
  }
});

test("archive grouped id is preserved on stored rows", async () => {
  const h = await harness({
    messages: [
      new FakeMessage(1, { className: "MessageMediaPhoto" }, 777),
      new FakeMessage(2, { className: "MessageMediaPhoto" }, 777),
      new FakeMessage(3)
    ]
  });
  try {
    await h.archiver.saveChatMessages("@test_chat");
    const rows = await h.store.searchStructured({});
    // 同组消息折叠为相册条目，total 按条目计
    assert.equal(rows.total, 2);
    const album = rows.items.find((entry) => entry.kind === "album");
    assert.equal(album?.kind, "album");
    if (album?.kind !== "album") throw new Error("expected album entry");
    assert.deepEqual(album.rows.map((row) => row.messageId).sort(), [1, 2]);
    assert.ok(album.rows.every((row) => row.groupedId === "777"));
    assert.equal(rows.items.filter((entry) => entry.kind === "message").length, 1);
  } finally {
    await h.store.close();
  }
});

test("archive returns zeros for a missing chat without touching the store", async () => {
  const h = await harness();
  try {
    const result = await h.archiver.saveChatMessages("missing");
    assert.deepEqual(result, { messages: 0, media: 0, skipped: 0 });
    assert.equal(h.submissions, 1);
    const total = await h.store.searchStructured({});
    assert.equal(total.total, 0);
  } finally {
    await h.store.close();
  }
});

test("archive rejects when both date and message limits are unlimited", async () => {
  const h = await harness({ messages: [new FakeMessage(1)] });
  try {
    await assert.rejects(
      h.archiver.saveChatMessages("@test_chat", { daysBack: 0, maxMessages: 0 }),
      /cannot both be unlimited/
    );
  } finally {
    await h.store.close();
  }
});

test("archive embeds text-url entity targets into stored text", async () => {
  const h = await harness({
    messages: [
      new FakeMessage(1, undefined, undefined, "点这里 查看详情", [
        { className: "MessageEntityTextUrl", offset: 1, length: 2, url: "https://t.me/invite" }
      ])
    ]
  });
  try {
    await h.archiver.saveChatMessages("@test_chat");
    const rows = (await h.store.searchStructured({})).items;
    assert.equal(rows[0]!.kind, "message");
    assert.equal(rows[0]!.kind === "message" ? rows[0]!.record.text : null, "点这里 (https://t.me/invite) 查看详情");
  } finally {
    await h.store.close();
  }
});

test("buildTargets applies defaults and per-chat overrides", () => {
  const targets = buildTargets({
    daysBack: 7,
    maxMessages: 500,
    downloadMedia: false,
    resume: false,
    chats: [
      "@one",
      { chat: 42, daysBack: 2, maxMessages: 10, downloadMedia: true }
    ]
  });
  assert.deepEqual(targets, [
    { chat: "@one", daysBack: 7, maxMessages: 500, downloadMedia: false, resume: false },
    { chat: 42, daysBack: 2, maxMessages: 10, downloadMedia: true, resume: false }
  ]);
});

function sumDownloads(client: FakeClient): number {
  return [...client.messages.values()].reduce((sum, message) => sum + message.downloads, 0);
}