import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Api } from "telegram";
import type { RuntimeLogger, ServiceContext, SessionAccess } from "@paperkite/sdk";
import type { DialogEntry, TelegramMessage } from "../packages/message-archive/src/archiver.js";
import { createArchiveConsoleServer } from "../packages/message-archive/src/console/server.js";
import { ArchiveConsoleWebService } from "../packages/message-archive/src/console/service.js";
import { SqliteArchiveStore, type MediaRow, type MessageRow } from "../packages/message-archive/src/storage/index.js";

const logger: RuntimeLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };

/** 与归档 chatId "100" 匹配的实体（用户无标记 peer id）。 */
function userEntity(id = 100): Api.User {
  return new Api.User({
    id,
    accessHash: 1,
    username: "test_chat",
    firstName: "测"
  } as unknown as ConstructorParameters<typeof Api.User>[0]);
}

class FakeLiveClient {
  calls: string[] = [];
  message: TelegramMessage | undefined;
  /** 最近一次 downloadMedia 收到的 thumb 参数（实例型）。 */
  lastThumb: unknown;
  missingIds: readonly number[] = [];
  /** 用户名解析失败时置为空串；解析到不匹配实体时置为错 id。 */
  username = "test_chat";
  entityId = 100;
  /** 冷启动模拟：首次 getMessages 抛实体缺失错误；置 always 时每次均抛。 */
  entityErrorFirst = false;
  entityErrorAlways = false;
  /** 已删除消息：getMessages 返回空槽（gramjs 对 MessageEmpty 的行为）。 */
  deletedIds: readonly number[] = [];
  dialogs: DialogEntry[] = [];
  /** 文档型媒体逐块产出的字节。 */
  chunks: readonly Buffer[] = [Buffer.from("LIVE-VIDEO-CHUNK")];

  async getMessages(_chatId: string, options: { ids: readonly number[] }): Promise<readonly (TelegramMessage | undefined)[]> {
    this.calls.push("getMessages:" + options.ids.join(","));
    if (options.ids.some((id) => this.missingIds.includes(id))) {
      throw new Error('Could not find the input entity for {"channelId":2614030056,"className":"PeerChannel"}');
    }
    if (this.entityErrorFirst || this.entityErrorAlways) {
      this.entityErrorFirst = false;
      throw new Error('Could not find the input entity for {"channelId":2614030056,"className":"PeerChannel"}');
    }
    if (options.ids.some((id) => this.deletedIds.includes(id))) {
      return [undefined];
    }
    return this.message && options.ids.includes(this.message.id) ? [this.message] : [];
  }

  async getEntity(identifier: string | number): Promise<unknown> {
    this.calls.push("getEntity:" + identifier);
    if (this.username === "") throw new Error("USERNAME_NOT_OCCUPIED");
    return userEntity(this.entityId);
  }

  async *iterDialogs(): AsyncIterable<DialogEntry> {
    this.calls.push("iterDialogs");
    for (const dialog of this.dialogs) yield dialog;
  }

  async downloadMedia(message: TelegramMessage, options?: { thumb?: unknown }): Promise<Buffer | undefined> {
    const thumb = options?.thumb;
    this.lastThumb = thumb;
    const marker = thumb === undefined ? "" : typeof thumb === "string" ? ":" + thumb : ":size";
    this.calls.push("downloadMedia:" + message.id + marker);
    return Buffer.from("LIVE-PHOTO-BYTES");
  }

  iterMediaChunks(media: unknown, options?: { offset?: number; limit?: number }): AsyncIterable<Buffer> | undefined {
    if (media === undefined || (media as { className?: string }).className !== "MessageMediaDocument") {
      return undefined;
    }
    this.calls.push("iterMediaChunks:" + (options?.offset ?? 0));
    const flat = Buffer.concat(this.chunks);
    const slice = flat.subarray(Math.min(options?.offset ?? 0, flat.length));
    return chunkIterable(slice.length > 0 ? [slice] : []);
  }
}

function chunkIterable(chunks: readonly Buffer[]): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  };
}

function fakeSessions(client: FakeLiveClient): SessionAccess {
  return {
    run: async <T>(operation: (client: unknown) => T | Promise<T>) => operation(client)
  };
}

interface Harness {
  store: SqliteArchiveStore;
  mediaDir: string;
  session: SessionAccess | undefined;
  client: FakeLiveClient;
  server: ReturnType<typeof createArchiveConsoleServer>;
  close(): Promise<void>;
}

async function harness(options: {
  session?: boolean;
  message?: TelegramMessage;
  missingIds?: readonly number[];
  username?: string;
  entityId?: number;
  entityErrorFirst?: boolean;
  entityErrorAlways?: boolean;
  deletedIds?: readonly number[];
  dialogs?: DialogEntry[];
  chunks?: readonly Buffer[];
  seedVideo?: boolean;
} = {}): Promise<Harness> {
  const tmp = await mkdtemp(join(tmpdir(), "paperkite-archive-console-"));
  const mediaDir = join(tmp, "media");
  await mkdir(mediaDir, { recursive: true });
  const store = new SqliteArchiveStore(join(tmp, "archive.db"));
  await store.init();
  await seed(store, mediaDir, options.seedVideo ?? false);

  const client = new FakeLiveClient();
  client.message = options.message ?? { id: 3, date: 0, media: { className: "MessageMediaPhoto" } };
  client.missingIds = options.missingIds ?? [];
  client.username = options.username ?? "test_chat";
  client.entityId = options.entityId ?? 100;
  client.entityErrorFirst = options.entityErrorFirst ?? false;
  client.entityErrorAlways = options.entityErrorAlways ?? false;
  client.deletedIds = options.deletedIds ?? [];
  client.dialogs = options.dialogs ?? [];
  client.chunks = options.chunks ?? client.chunks;
  const session = options.session ? fakeSessions(client) : undefined;

  const server = createArchiveConsoleServer({
    store,
    backend: "sqlite",
    mediaRoot: mediaDir,
    session: options.session ? "primary" : undefined,
    sessions: session,
    logger
  });
  return {
    store,
    mediaDir,
    client,
    session,
    server,
    async close(): Promise<void> {
      await server.close().catch(() => undefined);
      await store.close();
    }
  };
}

async function seed(store: SqliteArchiveStore, mediaDir: string, video = false): Promise<void> {
  await store.saveChat({ chatId: "100", title: "测试群", username: "test_chat", type: "group" });
  await store.saveChat({ chatId: "200", title: "重要通知", type: "channel" });
  const photoPath = join(mediaDir, "photo1.jpg");
  await writeFile(photoPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]));
  const messages: MessageRow[] = [
    {
      messageId: 1, chatId: "100", chatTitle: "测试群", date: "2025-03-01T10:00:00.000Z",
      text: "你好，今天天气不错", messageType: "text", hasMedia: false, senderId: "7",
      senderUsername: "tester", senderFirstName: "测", senderLastName: "试"
    },
    {
      messageId: 2, chatId: "200", chatTitle: "重要通知", date: "2025-03-01T11:00:00.000Z",
      text: "维护通告", messageType: "text", hasMedia: false
    },
    {
      messageId: 3, chatId: "100", chatTitle: "测试群", date: "2025-03-02T12:00:00.000Z",
      text: "附上截图看看效果", messageType: "photo", hasMedia: true, mediaType: "photo",
      replyToMsgId: 1, senderId: "7", senderUsername: "tester"
    },
    {
      messageId: 4, chatId: "100", chatTitle: "测试群", date: "2025-03-02T13:00:00.000Z",
      text: "好的收到", messageType: "text", hasMedia: false, forwardFromId: "9", forwardFromName: "转发人"
    },
    {
      messageId: 5, chatId: "100", chatTitle: "测试群", date: "2025-03-03T09:00:00.000Z",
      text: "维护", messageType: "text", hasMedia: false
    }
  ];
  const media: MediaRow[] = [
    {
      messageId: 3, chatId: "100", mediaType: "photo", fileName: "photo1.jpg",
      filePath: join(mediaDir, "photo1.jpg"), fileSize: 8, mimeType: "image/jpeg"
    },
    {
      messageId: 3, chatId: "100", mediaType: "photo", fileName: "photo2.jpg",
      filePath: join(mediaDir, "missing.jpg"), fileSize: 4, mimeType: "image/jpeg"
    },
    {
      messageId: 4, chatId: "100", mediaType: "photo", fileName: "stray.jpg",
      filePath: join(mediaDir, "stray.jpg"), fileSize: 4, mimeType: "image/jpeg"
    }
  ];
  await store.startSyncSession("100", "2025-03-01T00:00:00.000Z", "2025-03-04T00:00:00.000Z");
  await store.saveBatch(messages, media);
  await store.completeSyncSession(1, messages.length, media.length);
  if (video) {
    await store.saveBatch(
      [{
        messageId: 6, chatId: "100", chatTitle: "测试群", date: "2025-03-03T10:00:00.000Z",
        text: "视频片段", messageType: "video", hasMedia: true, mediaType: "video"
      }],
      [{
        messageId: 6, chatId: "100", mediaType: "video", fileName: "clip.mp4",
        filePath: join(mediaDir, "missing-clip.mp4"), fileSize: 20, mimeType: "video/mp4"
      }]
    );
  }
}

/** 文档型消息夹具：真实 gramjs 对象，供 getFileInfo/iterMediaChunks 走构造。 */
function videoMessage(id: number, size: number, mime = "video/mp4"): TelegramMessage {
  return {
    id,
    date: 0,
    media: new Api.MessageMediaDocument({
      document: new Api.Document({
        id: 1n,
        accessHash: 1n,
        dcId: 1,
        mimeType: mime,
        size,
        fileReference: Buffer.from("ref"),
        date: 0,
        attributes: [],
        thumbs: [],
        videoThumbs: []
      } as unknown as ConstructorParameters<typeof Api.Document>[0])
    } as unknown as ConstructorParameters<typeof Api.MessageMediaDocument>[0])
  };
}

test("archive console search returns items, total and filters", async () => {
  const h = await harness();
  try {
    const all = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(all.statusCode, 200);
    const body = all.json();
    assert.equal(body.total, 5);
    assert.equal(body.totalMessages, 5);
    assert.equal(body.items.length, 5);
    assert.equal(body.items[0]!.kind, "message");
    assert.equal(body.items[0]!.kind === "message" ? body.items[0]!.record.text : null, "维护");

    const keyword = await h.server.inject({ method: "GET", url: "/api/search?q=%E7%BB%B4%E6%8A%A4" });
    assert.equal(keyword.statusCode, 200);
    assert.equal(keyword.json().total, 2);

    const multi = await h.server.inject({ method: "GET", url: "/api/search?q=%E7%BB%B4%E6%8A%A4%20%E9%80%9A%E5%91%8A" });
    assert.equal(multi.statusCode, 200);
    assert.equal(multi.json().total, 1);
    assert.equal(multi.json().items[0]!.kind === "message" ? multi.json().items[0]!.record.text : null, "维护通告");

    const chat = await h.server.inject({ method: "GET", url: "/api/search?chat=200" });
    assert.equal(chat.statusCode, 200);
    assert.equal(chat.json().total, 1);

    const multiChat = await h.server.inject({ method: "GET", url: "/api/search?chat=100%2C200" });
    assert.equal(multiChat.statusCode, 200);
    assert.equal(multiChat.json().total, 5);
    assert.equal(multiChat.json().totalMessages, 5);

    const partialChat = await h.server.inject({ method: "GET", url: "/api/search?chat=200,999" });
    assert.equal(partialChat.json().total, 1);

    const dated = await h.server.inject({
      method: "GET",
      url: "/api/search?from=2025-03-02T00%3A00%3A00.000Z&to=2025-03-02T23%3A59%3A59.999Z"
    });
    assert.equal(dated.statusCode, 200);
    assert.equal(dated.json().total, 2);

    const paged = await h.server.inject({ method: "GET", url: "/api/search?limit=2&offset=2" });
    assert.equal(paged.statusCode, 200);
    assert.equal(paged.json().items.length, 2);
    assert.equal(paged.json().offset, 2);
  } finally {
    await h.close();
  }
});

test("archive console search rejects invalid filters with error body", async () => {
  const h = await harness();
  try {
    const mode = await h.server.inject({ method: "GET", url: "/api/search?timeMode=bogus" });
    assert.equal(mode.statusCode, 400);
    assert.deepEqual(mode.json(), { error: "invalid time mode: bogus" });

    const date = await h.server.inject({ method: "GET", url: "/api/search?from=not-a-date" });
    assert.equal(date.statusCode, 400);
    assert.equal(typeof date.json().error, "string");
  } finally {
    await h.close();
  }
});

test("archive console message and context endpoints return records", async () => {
  const h = await harness();
  try {
    const record = await h.server.inject({ method: "GET", url: "/api/messages/3" });
    assert.equal(record.statusCode, 200);
    const body = record.json();
    assert.equal(body.messageId, 3);
    assert.equal(body.chatTitle, "测试群");
    assert.equal(body.mediaFiles.length, 2);
    assert.equal(body.albumRows.length, 0);

    const missing = await h.server.inject({ method: "GET", url: "/api/messages/999" });
    assert.equal(missing.statusCode, 404);
    assert.equal(typeof missing.json().error, "string");

    const invalid = await h.server.inject({ method: "GET", url: "/api/messages/abc" });
    assert.equal(invalid.statusCode, 400);

    const context = await h.server.inject({ method: "GET", url: "/api/messages/4/context?before=2&after=2" });
    assert.equal(context.statusCode, 200);
    const ctx = context.json();
    const flat = (items: { kind: string; record?: { messageId: number } }[]): (number | null)[] =>
      items.map((item) => (item.kind === "message" ? (item.record?.messageId ?? null) : null));
    assert.equal(ctx.anchor?.kind, "message");
    assert.equal(ctx.anchor?.kind === "message" && ctx.anchor.record.messageId, 4);
    assert.deepEqual(flat(ctx.before), [1, 3]);
    assert.deepEqual(flat(ctx.after), [5]);
    assert.equal(ctx.beforeN, 2);
    assert.equal(ctx.afterN, 1);

    const paged = await h.server.inject({ method: "GET", url: "/api/messages/4/context?before=1&after=1&beforeOffset=1&afterOffset=1" });
    assert.equal(paged.statusCode, 200);
    assert.deepEqual(flat(paged.json().before), [1]);
    assert.deepEqual(flat(paged.json().after), []);
  } finally {
    await h.close();
  }
});

test("archive console live text appends url entities from telegram", async () => {
  const h = await harness();
  try {
    const without = await h.server.inject({ method: "GET", url: "/api/messages/3/live-text" });
    assert.equal(without.statusCode, 503);

    const withSession = await harness({
      session: true,
      message: {
        id: 3,
        date: 0,
        message: "测评 评测链接",
        entities: [
          { className: "MessageEntityTextUrl", offset: 0, length: 2, url: "https://t.me/x/7" }
        ]
      }
    });
    try {
      const res = await withSession.server.inject({ method: "GET", url: "/api/messages/3/live-text" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), {
        text: "测评 评测链接",
        entities: [{ className: "MessageEntityTextUrl", offset: 0, length: 2, url: "https://t.me/x/7" }]
      });
      assert.deepEqual(withSession.client.calls, ["getEntity:@test_chat", "getMessages:3"]);
    } finally {
      await withSession.close();
    }
  } finally {
    await h.close();
  }
});

test("archive console keeps native text and entity links apart", async () => {
  const h = await harness();
  try {
    await h.store.saveBatch(
      [{
        messageId: 42, chatId: "100", chatTitle: "测试群", date: "2025-03-04T12:00:00.000Z",
        text: "看看频道 测评", messageType: "text", hasMedia: false,
        entities: [
          { className: "MessageEntityTextUrl", offset: 2, length: 2, url: "https://t.me/x/7" },
          { className: "MessageEntityBold", offset: 2, length: 2 }
        ]
      }],
      []
    );
    const res = await h.server.inject({ method: "GET", url: "/api/messages/6" });
    assert.equal(res.statusCode, 200);
    const record = res.json();
    assert.equal(record.text, "看看频道 测评");
    assert.deepEqual(record.entities, [
      { className: "MessageEntityTextUrl", offset: 2, length: 2, url: "https://t.me/x/7" },
      { className: "MessageEntityBold", offset: 2, length: 2 }
    ]);
  } finally {
    await h.close();
  }
});

test("archive console chats ledger joins the chats table with per-chat aggregates", async () => {
  const h = await harness();
  try {
    const res = await h.server.inject({ method: "GET", url: "/api/chats" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.capped, false);
    assert.equal(body.chats.length, 2);
    const testChat = body.chats.find((item: { chatId: string }) => item.chatId === "100");
    assert.equal(testChat.count, 4);
    assert.equal(testChat.title, "测试群");
    assert.equal(testChat.username, "test_chat");
    assert.equal(testChat.type, "group");
    assert.match(testChat.lastDate ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  } finally {
    await h.close();
  }
});

test("archive console serves on-disk media with range support and 404s missing files", async () => {
  const h = await harness();
  try {
    const meta = await h.server.inject({ method: "GET", url: "/api/mediafiles/1" });
    assert.equal(meta.statusCode, 200);
    const metaBody = meta.json();
    assert.equal(metaBody.onDisk, true);
    assert.equal(metaBody.file.fileName, "photo1.jpg");
    assert.equal(metaBody.file.id, "1");

    const missingMeta = await h.server.inject({ method: "GET", url: "/api/mediafiles/2" });
    assert.equal(missingMeta.json().onDisk, false);

    const bytes = await h.server.inject({ method: "GET", url: "/api/mediafiles/1/file" });
    assert.equal(bytes.statusCode, 200);
    assert.equal(bytes.headers["content-type"], "image/jpeg");
    assert.equal(bytes.headers["content-length"], "8");
    assert.deepEqual([...bytes.rawPayload], [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    const range = await h.server.inject({ method: "GET", url: "/api/mediafiles/1/file", headers: { range: "bytes=2-5" } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers["content-range"], "bytes 2-5/8");
    assert.deepEqual([...range.rawPayload], [0xff, 0xe0, 0x00, 0x10]);

    const badRange = await h.server.inject({ method: "GET", url: "/api/mediafiles/1/file", headers: { range: "bytes=99-" } });
    assert.equal(badRange.statusCode, 416);

    const download = await h.server.inject({ method: "GET", url: "/api/mediafiles/1/file?download=1" });
    assert.equal(download.headers["content-disposition"], 'attachment; filename="photo1.jpg"');

    const missing = await h.server.inject({ method: "GET", url: "/api/mediafiles/2/file" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "媒体文件未落盘");
  } finally {
    await h.close();
  }
});

test("archive console live media needs a session and streams telegram bytes", async () => {
  const h = await harness();
  try {
    const without = await h.server.inject({ method: "GET", url: "/api/mediafiles/1/live" });
    assert.equal(without.statusCode, 503);

    const withSession = await harness({ session: true });
    try {
      const res = await withSession.server.inject({ method: "GET", url: "/api/mediafiles/1/live" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["content-type"], "image/jpeg");
      assert.equal(res.rawPayload.toString(), "LIVE-PHOTO-BYTES");
      assert.deepEqual(withSession.client.calls, ["getMessages:3", "downloadMedia:3"]);

      const deleted = await withSession.server.inject({ method: "GET", url: "/api/mediafiles/3/live" });
      assert.equal(deleted.statusCode, 410);
      assert.equal(deleted.json().error, "消息已从 Telegram 删除或会话无法访问");
    } finally {
      await withSession.close();
    }
  } finally {
    await h.close();
  }
});

test("archive console live media resolves cold-start entity via chat username", async () => {
  const withSession = await harness({ session: true, entityErrorFirst: true });
  try {
    const res = await withSession.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/jpeg");
    assert.equal(res.rawPayload.toString(), "LIVE-PHOTO-BYTES");
    assert.deepEqual(withSession.client.calls, [
      "getMessages:3",
      "getEntity:@test_chat",
      "getMessages:3",
      "downloadMedia:3"
    ]);

    const live = await withSession.server.inject({ method: "GET", url: "/api/mediafiles/1/live" });
    assert.equal(live.statusCode, 200);
    assert.equal(live.rawPayload.toString(), "LIVE-PHOTO-BYTES");
  } finally {
    await withSession.close();
  }
});

test("archive console live media falls back to dialog scan when username is unresolvable or mismatched", async () => {
  const withDialogs = await harness({
    session: true,
    entityErrorFirst: true,
    username: "",
    dialogs: [{ entity: userEntity() }]
  });
  try {
    const res = await withDialogs.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.rawPayload.toString(), "LIVE-PHOTO-BYTES");
    assert.deepEqual(withDialogs.client.calls, [
      "getMessages:3",
      "getEntity:@test_chat",
      "iterDialogs",
      "getMessages:3",
      "downloadMedia:3"
    ]);
  } finally {
    await withDialogs.close();
  }

  const withMismatch = await harness({ session: true, entityErrorFirst: true, entityId: 999 });
  try {
    const res = await withMismatch.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(res.statusCode, 410);
    assert.equal(res.json().error, "消息已从 Telegram 删除或会话无法访问");
    assert.deepEqual(withMismatch.client.calls, ["getMessages:3", "getEntity:@test_chat", "iterDialogs"]);
  } finally {
    await withMismatch.close();
  }
});

test("archive console live routes report 410 when chat cannot be resolved at all", async () => {
  const withSession = await harness({ session: true, username: "", entityErrorAlways: true });
  try {
    const thumb = await withSession.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(thumb.statusCode, 410);
    assert.equal(thumb.json().error, "消息已从 Telegram 删除或会话无法访问");
    assert.deepEqual(withSession.client.calls, ["getMessages:3", "getEntity:@test_chat", "iterDialogs"]);

    const live = await withSession.server.inject({ method: "GET", url: "/api/mediafiles/1/live" });
    assert.equal(live.statusCode, 410);
    assert.equal(live.json().error, "消息已从 Telegram 删除或会话无法访问");
    assert.deepEqual(withSession.client.calls, [
      "getMessages:3",
      "getEntity:@test_chat",
      "iterDialogs",
      "getMessages:3",
      "getEntity:@test_chat",
      "iterDialogs"
    ]);
  } finally {
    await withSession.close();
  }
});

test("archive console live routes report 410 when the message was deleted on telegram", async () => {
  const withSession = await harness({ session: true, deletedIds: [3] });
  try {
    const thumb = await withSession.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(thumb.statusCode, 410);
    assert.equal(thumb.json().error, "消息已从 Telegram 删除或会话无法访问");
    assert.deepEqual(withSession.client.calls, ["getMessages:3"]);

    const live = await withSession.server.inject({ method: "GET", url: "/api/mediafiles/1/live" });
    assert.equal(live.statusCode, 410);
    assert.equal(live.json().error, "消息已从 Telegram 删除或会话无法访问");
  } finally {
    await withSession.close();
  }
});

test("archive console live thumb fetches media by message row for chats without stored media", async () => {
  const h = await harness();
  try {
    const without = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(without.statusCode, 503);

    const withSession = await harness({ session: true });
    try {
      const res = await withSession.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["content-type"], "image/jpeg");
      assert.equal(res.rawPayload.toString(), "LIVE-PHOTO-BYTES");
      assert.deepEqual(withSession.client.calls, ["getMessages:3", "downloadMedia:3"]);

      const download = await withSession.server.inject({ method: "GET", url: "/api/messages/3/thumb?download=1" });
      assert.equal(download.statusCode, 200);
      assert.match(download.headers["content-disposition"] ?? "", /attachment/);

      const noMedia = await withSession.server.inject({ method: "GET", url: "/api/messages/1/thumb" });
      assert.equal(noMedia.statusCode, 400);

      const missing = await withSession.server.inject({ method: "GET", url: "/api/messages/999/thumb" });
      assert.equal(missing.statusCode, 404);

      const deleted = await harness({ session: true, missingIds: [3] });
      try {
        const gone = await deleted.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
        assert.equal(gone.statusCode, 410);
        assert.match(String(gone.json().error), /删除/);
      } finally {
        await deleted.close();
      }
    } finally {
      await withSession.close();
    }
  } finally {
    await h.close();
  }
});

test("archive console thumb prefers smallest photo sizeType and caches per row", async () => {
  const h = await harness({
    session: true,
    message: {
      id: 3,
      date: 0,
      media: {
        className: "MessageMediaPhoto",
        photo: {
          className: "Photo",
          sizes: [
            { className: "PhotoSize", type: "m", size: 99_999 },
            { className: "PhotoSize", type: "s", size: 320 },
            { className: "PhotoStrippedSize", type: "i", bytes: Buffer.alloc(100) }
          ]
        }
      }
    }
  });
  try {
    const first = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["content-type"], "image/jpeg");
    assert.match(first.headers["cache-control"] ?? "", /max-age=3600/);
    assert.deepEqual(h.client.calls, ["getMessages:3", "downloadMedia:3:s"]);

    const again = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(h.client.calls, ["getMessages:3", "downloadMedia:3:s"]);

    const full = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb?size=full" });
    assert.equal(full.statusCode, 200);
    assert.equal(full.rawPayload.toString(), "LIVE-PHOTO-BYTES");
    assert.deepEqual(h.client.calls, [
      "getMessages:3",
      "downloadMedia:3:s",
      "getMessages:3",
      "downloadMedia:3"
    ]);
  } finally {
    await h.close();
  }
});

test("archive console thumb falls back to full media for photo without sizes", async () => {
  const h = await harness({
    session: true,
    message: {
      id: 3,
      date: 0,
      media: { className: "MessageMediaPhoto", photo: { className: "Photo", sizes: [] } }
    }
  });
  try {
    const res = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.rawPayload.toString(), "LIVE-PHOTO-BYTES");
    assert.deepEqual(h.client.calls, ["getMessages:3", "downloadMedia:3"]);
  } finally {
    await h.close();
  }
});

test("archive console thumb passes videoThumbs instance for video documents", async () => {
  const videoSize = { className: "VideoSize", type: "m", size: 20 };
  const h = await harness({
    session: true,
    message: {
      id: 3,
      date: 0,
      media: {
        className: "MessageMediaDocument",
        document: { className: "Document", thumbs: [], videoThumbs: [videoSize] }
      }
    }
  });
  try {
    const res = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(h.client.calls, ["getMessages:3", "downloadMedia:3:size"]);
    assert.equal(h.client.lastThumb, videoSize);
  } finally {
    await h.close();
  }
});

test("archive console thumb reports 404 and negative-caches documents without thumbs", async () => {
  const h = await harness({
    session: true,
    message: {
      id: 3,
      date: 0,
      media: {
        className: "MessageMediaDocument",
        document: { className: "Document", thumbs: [], videoThumbs: [] }
      }
    }
  });
  try {
    const first = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(first.statusCode, 404);
    assert.equal(first.json().error, "该媒体没有可用的缩略图");

    const again = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb" });
    assert.equal(again.statusCode, 404);
    assert.deepEqual(h.client.calls, ["getMessages:3"]);
  } finally {
    await h.close();
  }
});

test("archive console service boots over http and stops on abort", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "paperkite-archive-service-"));
  const publicDir = join(tmp, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "index.html"), "<h1>归档台</h1>");
  const port = await freePort();
  const controller = new AbortController();
  const context: ServiceContext<Record<string, unknown>> = {
    id: "archive-console",
    capability: "archive.console_web",
    config: { file: join(tmp, "archive.db"), host: "127.0.0.1", port, publicDir },
    signal: controller.signal,
    logger
  };
  const service = new ArchiveConsoleWebService(context);
  const running = service.run();

  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(base + "/api/state");
  const state = await (await fetch(base + "/api/state")).json();
  assert.deepEqual(state, {
    backend: "sqlite",
    session: null,
    mediaRoot: null,
    blockwords: { version: 0, count: 0 },
    blockedUsers: { version: 0, count: 0 }
  });
  const page = await (await fetch(base + "/")).text();
  assert.match(page, /归档台/);

  controller.abort();
  await running;
  await assert.rejects(fetch(base + "/api/state"));
});

test("archive console blockwords hide matching messages across all surfaces", async () => {
  const h = await harness();
  try {
    const before = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(before.json().total, 5);

    let res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "维护" } });
    assert.equal(res.statusCode, 201);
    let body = res.json();
    assert.deepEqual(body.words, ["维护"]);
    assert.equal(body.version, 1);

    res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "维护" } });
    assert.equal(res.statusCode, 409);
    res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "   " } });
    assert.equal(res.statusCode, 400);
    res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "x".repeat(65) } });
    assert.equal(res.statusCode, 400);
    res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: 7 } });
    assert.equal(res.statusCode, 400);

    const all = await h.server.inject({ method: "GET", url: "/api/search" });
    body = all.json();
    assert.equal(body.total, 3);
    assert.equal(body.totalMessages, 3);

    const keyword = await h.server.inject({ method: "GET", url: "/api/search?q=%E7%BB%B4%E6%8A%A4" });
    assert.equal(keyword.json().total, 0);
    assert.equal(keyword.json().totalMessages, 0);

    const chat = await h.server.inject({ method: "GET", url: "/api/search?chat=200" });
    assert.equal(chat.json().total, 0);

    res = await h.server.inject({ method: "GET", url: "/api/messages/5" });
    assert.equal(res.statusCode, 404);
    res = await h.server.inject({ method: "GET", url: "/api/messages/5/context" });
    assert.equal(res.statusCode, 404);

    const context = await h.server.inject({ method: "GET", url: "/api/messages/1/context?before=10&after=10" });
    body = context.json();
    assert.equal(body.beforeN, 0);
    assert.equal(body.afterN, 2);
    const afterTexts = body.after.map((entry: { record: { text: string } }) => entry.record.text);
    assert.deepEqual(afterTexts, ["附上截图看看效果", "好的收到"]);

    const chats = await h.server.inject({ method: "GET", url: "/api/chats" });
    const ledger = chats.json().chats as { chatId: string; count: number; lastText?: string }[];
    assert.equal(ledger.find((item) => item.chatId === "100")?.count, 3);
    assert.equal(ledger.find((item) => item.chatId === "100")?.lastText, "好的收到");
    assert.equal(ledger.find((item) => item.chatId === "200")?.count, 0);
    assert.equal(ledger.find((item) => item.chatId === "200")?.lastText, undefined);

    res = await h.server.inject({ method: "DELETE", url: "/api/blockwords/%E7%BB%B4%E6%8A%A4" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().version, 2);
    res = await h.server.inject({ method: "DELETE", url: "/api/blockwords/%E7%BB%B4%E6%8A%A4" });
    assert.equal(res.statusCode, 404);

    const restored = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(restored.json().total, 5);
    const state = await h.server.inject({ method: "GET", url: "/api/state" });
    assert.equal(state.json().blockwords.count, 0);
    assert.equal(state.json().blockwords.version, 2);
  } finally {
    await h.close();
  }
});

test("archive console blockwords drop album members and block their media", async () => {
  const h = await harness();
  try {
    await h.store.saveBatch(
      [
        {
          messageId: 7, chatId: "100", chatTitle: "测试群", groupedId: "album-1",
          date: "2025-03-04T10:00:00.000Z", text: "相册第一条", messageType: "photo",
          hasMedia: true, mediaType: "photo"
        },
        {
          messageId: 8, chatId: "100", chatTitle: "测试群", groupedId: "album-1",
          date: "2025-03-04T10:01:00.000Z", text: "这里有可疑词", messageType: "photo",
          hasMedia: true, mediaType: "photo"
        }
      ],
      [
        { messageId: 7, chatId: "100", mediaType: "photo", fileName: "a.jpg", filePath: "/tmp/a.jpg" },
        { messageId: 8, chatId: "100", mediaType: "photo", fileName: "b.jpg", filePath: "/tmp/b.jpg" }
      ]
    );

    let res = await h.server.inject({ method: "GET", url: "/api/search?q=%E7%9B%B8%E5%86%8C" });
    let body = res.json();
    assert.equal(body.total, 1);
    assert.equal(body.totalMessages, 1);
    assert.equal(body.items[0].kind, "album");
    assert.equal(body.items[0]!.rows.length, 2);

    res = await h.server.inject({ method: "GET", url: "/api/mediafiles/4" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/mediafiles/5" });
    assert.equal(res.statusCode, 200);

    res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "可疑词" } });
    assert.equal(res.statusCode, 201);

    res = await h.server.inject({ method: "GET", url: "/api/search?q=%E7%9B%B8%E5%86%8C" });
    body = res.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].kind, "message");
    assert.equal(body.items[0].record.text, "相册第一条");

    res = await h.server.inject({ method: "GET", url: "/api/mediafiles/5" });
    assert.equal(res.statusCode, 404);
    res = await h.server.inject({ method: "GET", url: "/api/mediafiles/4" });
    assert.equal(res.statusCode, 200);

    res = await h.server.inject({ method: "DELETE", url: "/api/blockwords/%E5%8F%AF%E7%96%91%E8%AF%8D" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/mediafiles/5" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/search?q=%E7%9B%B8%E5%86%8C" });
    assert.equal(res.json().items[0].kind, "album");
  } finally {
    await h.close();
  }
});

test("archive console album with blocked first member lists the earliest visible member", async () => {
  const h = await harness();
  try {
    await h.store.saveBatch(
      [
        {
          messageId: 21, chatId: "100", chatTitle: "测试群", groupedId: "album-b", date: "2025-03-07T10:00:00.000Z",
          text: "相册首图含可疑词", messageType: "photo", hasMedia: true, mediaType: "photo"
        },
        {
          messageId: 22, chatId: "100", chatTitle: "测试群", groupedId: "album-b", date: "2025-03-07T10:00:01.000Z",
          text: "相册次图", messageType: "photo", hasMedia: true, mediaType: "photo"
        },
        {
          messageId: 23, chatId: "100", chatTitle: "测试群", groupedId: "album-b", date: "2025-03-07T10:00:02.000Z",
          text: "相册第三图", messageType: "photo", hasMedia: true, mediaType: "photo"
        }
      ],
      [
        { messageId: 21, chatId: "100", mediaType: "photo", fileName: "b1.jpg", filePath: "/tmp/b1.jpg" },
        { messageId: 22, chatId: "100", mediaType: "photo", fileName: "b2.jpg", filePath: "/tmp/b2.jpg" },
        { messageId: 23, chatId: "100", mediaType: "photo", fileName: "b3.jpg", filePath: "/tmp/b3.jpg" }
      ]
    );
    let res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "可疑词" } });
    assert.equal(res.statusCode, 201);

    res = await h.server.inject({ method: "GET", url: "/api/search" });
    const album = res.json().items.find((item: { kind: string }) => item.kind === "album");
    assert.ok(album !== undefined);
    const memberIds = (album.rows as { rowId: string }[]).map((row) => row.rowId);
    assert.ok(!memberIds.includes("6"), "blocked first member must not be listed");
    assert.ok(memberIds.includes("7") && memberIds.includes("8"), "visible members still listed");

    const listed = await h.server.inject({ method: "GET", url: `/api/messages/${album.rowId}/context?before=2&after=2` });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().anchor.kind, "album");
    assert.equal(listed.json().anchor.rows.length, 2);

    const blockedFirst = await h.server.inject({ method: "GET", url: "/api/messages/6" });
    assert.equal(blockedFirst.statusCode, 404);
  } finally {
    await h.close();
  }
});

test("archive console blockwords are case-insensitive and cover new writes", async () => {
  const h = await harness();
  try {
    await h.store.saveBatch(
      [{ messageId: 9, chatId: "100", chatTitle: "测试群", date: "2025-03-05T09:00:00.000Z", text: "Check the VIP channel", messageType: "text", hasMedia: false }],
      []
    );
    let res = await h.server.inject({ method: "GET", url: "/api/search?q=check" });
    assert.equal(res.json().total, 1);

    res = await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "vip" } });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().words[0], "vip");

    res = await h.server.inject({ method: "GET", url: "/api/search?q=check" });
    assert.equal(res.json().total, 0);

    await h.store.saveBatch(
      [{ messageId: 10, chatId: "100", chatTitle: "测试群", date: "2025-03-05T10:00:00.000Z", text: "vip only for members", messageType: "text", hasMedia: false }],
      []
    );
    res = await h.server.inject({ method: "GET", url: "/api/search?q=only" });
    assert.equal(res.json().total, 0);

    res = await h.server.inject({ method: "DELETE", url: "/api/blockwords/vip" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/search?q=check" });
    assert.equal(res.json().total, 1);
    res = await h.server.inject({ method: "GET", url: "/api/search?q=only" });
    assert.equal(res.json().total, 1);
  } finally {
    await h.close();
  }
});

test("archive console streams live video directly from telegram with byte-range support", async () => {
  const chunks = [Buffer.from("0123456789"), Buffer.from("abcdefghij")];
  const h = await harness({ session: true, seedVideo: true, chunks, message: videoMessage(6, 20) });
  try {
    const full = await h.server.inject({ method: "GET", url: "/api/mediafiles/4/live" });
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers["content-type"], "video/mp4");
    assert.equal(full.headers["content-length"], "20");
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.equal(full.rawPayload.toString(), "0123456789abcdefghij");
    assert.deepEqual(h.client.calls, ["getMessages:6", "iterMediaChunks:0"]);

    const range = await h.server.inject({ method: "GET", url: "/api/mediafiles/4/live", headers: { range: "bytes=5-9" } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers["content-range"], "bytes 5-9/20");
    assert.equal(range.rawPayload.toString(), "56789");
    assert.deepEqual(h.client.calls, ["getMessages:6", "iterMediaChunks:0", "getMessages:6", "iterMediaChunks:5"]);

    const suffix = await h.server.inject({ method: "GET", url: "/api/mediafiles/4/live", headers: { range: "bytes=-5" } });
    assert.equal(suffix.statusCode, 206);
    assert.equal(suffix.headers["content-range"], "bytes 15-19/20");
    assert.equal(suffix.rawPayload.toString(), "fghij");
    assert.deepEqual(h.client.calls, [
      "getMessages:6", "iterMediaChunks:0",
      "getMessages:6", "iterMediaChunks:5",
      "getMessages:6", "iterMediaChunks:15"
    ]);

    const bad = await h.server.inject({ method: "GET", url: "/api/mediafiles/4/live", headers: { range: "bytes=99-" } });
    assert.equal(bad.statusCode, 416);
    assert.equal(bad.headers["content-range"], "bytes */20");

    const download = await h.server.inject({ method: "GET", url: "/api/mediafiles/4/live?download=1" });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-disposition"], 'attachment; filename="clip.mp4"');
  } finally {
    await h.close();
  }
});

test("archive console streams video by message row without stored media", async () => {
  const chunks = [Buffer.from("0123456789")];
  const h = await harness({ session: true, chunks, message: videoMessage(6, 10) });
  try {
    await h.store.saveBatch(
      [{
        messageId: 6, chatId: "100", chatTitle: "测试群", date: "2025-03-03T10:00:00.000Z",
        text: "视频片段", messageType: "video", hasMedia: true, mediaType: "video"
      }],
      []
    );
    const full = await h.server.inject({ method: "GET", url: "/api/messages/6/thumb?size=full" });
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers["content-type"], "video/mp4");
    assert.equal(full.headers["content-length"], "10");
    assert.equal(full.rawPayload.toString(), "0123456789");
    assert.deepEqual(h.client.calls, ["getMessages:6", "iterMediaChunks:0"]);

    const download = await h.server.inject({ method: "GET", url: "/api/messages/6/thumb?size=full&download=1" });
    assert.equal(download.headers["content-disposition"], 'attachment; filename="6.mp4"');
  } finally {
    await h.close();
  }
});

test("archive console streaming live media keeps photo rows on the full-fetch path", async () => {
  const h = await harness({ session: true });
  try {
    const full = await h.server.inject({ method: "GET", url: "/api/messages/3/thumb?size=full" });
    assert.equal(full.statusCode, 200);
    assert.equal(full.rawPayload.toString(), "LIVE-PHOTO-BYTES");
    assert.deepEqual(h.client.calls, ["getMessages:3", "downloadMedia:3"]);

    const live = await h.server.inject({ method: "GET", url: "/api/mediafiles/1/live" });
    assert.equal(live.statusCode, 200);
    assert.equal(live.rawPayload.toString(), "LIVE-PHOTO-BYTES");
    assert.deepEqual(h.client.calls, ["getMessages:3", "downloadMedia:3", "getMessages:3", "downloadMedia:3"]);
  } finally {
    await h.close();
  }
});

test("archive console streaming live media reports 410 when the message is gone", async () => {
  const h = await harness({ session: true, seedVideo: true, missingIds: [6] });
  try {
    const res = await h.server.inject({ method: "GET", url: "/api/mediafiles/4/live" });
    assert.equal(res.statusCode, 410);
    assert.equal(res.json().error, "消息已从 Telegram 删除或会话无法访问");
  } finally {
    await h.close();
  }
});

test("archive console blocked users hide messages from that sender", async () => {
  const h = await harness();
  try {
    let res = await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "7" } });
    assert.equal(res.statusCode, 201);
    let body = res.json();
    assert.deepEqual(body.users, [{ userId: "7" }]);
    assert.equal(body.version, 1);

    res = await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "7" } });
    assert.equal(res.statusCode, 409);
    res = await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "   " } });
    assert.equal(res.statusCode, 400);
    res = await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "x".repeat(65) } });
    assert.equal(res.statusCode, 400);
    res = await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: 7 } });
    assert.equal(res.statusCode, 400);

    const all = await h.server.inject({ method: "GET", url: "/api/search" });
    body = all.json();
    assert.equal(body.total, 3);
    assert.equal(body.totalMessages, 3);

    res = await h.server.inject({ method: "GET", url: "/api/messages/1" });
    assert.equal(res.statusCode, 404);
    res = await h.server.inject({ method: "GET", url: "/api/messages/1/context" });
    assert.equal(res.statusCode, 404);

    const chats = await h.server.inject({ method: "GET", url: "/api/chats" });
    const ledger = chats.json().chats as { chatId: string; count: number; lastText?: string }[];
    assert.equal(ledger.find((item) => item.chatId === "100")?.count, 2);
    assert.equal(ledger.find((item) => item.chatId === "100")?.lastText, "维护");

    res = await h.server.inject({ method: "DELETE", url: "/api/blockedusers/7" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().version, 2);
    res = await h.server.inject({ method: "DELETE", url: "/api/blockedusers/7" });
    assert.equal(res.statusCode, 404);

    const restored = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(restored.json().total, 5);
    const state = await h.server.inject({ method: "GET", url: "/api/state" });
    assert.equal(state.json().blockedUsers.count, 0);
    assert.equal(state.json().blockedUsers.version, 2);
  } finally {
    await h.close();
  }
});

test("archive console blocked users and blockwords keep each other's rows blocked", async () => {
  const h = await harness();
  try {
    await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "7", name: "测", username: "tester" } });
    let res = await h.server.inject({ method: "GET", url: "/api/blockedusers" });
    assert.deepEqual(res.json().users, [{ userId: "7", name: "测", username: "tester" }]);

    await h.server.inject({ method: "POST", url: "/api/blockwords", payload: { word: "维护" } });
    res = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(res.json().total, 1);
    assert.equal(res.json().items[0].record.text, "好的收到");

    // 删用户不影响词命中的行
    res = await h.server.inject({ method: "DELETE", url: "/api/blockedusers/7" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(res.json().total, 3);
    const visible = res.json().items.map((item: { record: { text: string } }) => item.record.text).sort();
    assert.deepEqual(visible, ["你好，今天天气不错", "好的收到", "附上截图看看效果"]);

    // 删词不影响用户命中的行
    await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "7" } });
    res = await h.server.inject({ method: "DELETE", url: "/api/blockwords/%E7%BB%B4%E6%8A%A4" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/search" });
    assert.equal(res.json().total, 3);
    const stillHidden = res.json().items.map((item: { record: { text: string } }) => item.record.text).sort();
    assert.deepEqual(stillHidden, ["好的收到", "维护", "维护通告"]);

    // 新落库行按当前名单即时判定
    await h.store.saveBatch(
      [{ messageId: 11, chatId: "100", chatTitle: "测试群", date: "2025-03-06T09:00:00.000Z", text: "新消息", messageType: "text", hasMedia: false, senderId: "7" }],
      []
    );
    res = await h.server.inject({ method: "GET", url: "/api/search?q=%E6%96%B0%E6%B6%88%E6%81%AF" });
    assert.equal(res.json().total, 0);

    res = await h.server.inject({ method: "DELETE", url: "/api/blockedusers/7" });
    assert.equal(res.statusCode, 200);
    res = await h.server.inject({ method: "GET", url: "/api/search?q=%E6%96%B0%E6%B6%88%E6%81%AF" });
    assert.equal(res.json().total, 1);
  } finally {
    await h.close();
  }
});

test("archive console sender search matches by name, username and id", async () => {
  const h = await harness();
  try {
    const byName = await h.server.inject({ method: "GET", url: "/api/senders?q=%E6%B5%8B" });
    assert.equal(byName.statusCode, 200);
    const byNameBody = byName.json();
    assert.equal(byNameBody.total, 1);
    assert.deepEqual(byNameBody.items, [{ senderId: "7", username: "tester", firstName: "测", lastName: "试" }]);

    const byHandle = await h.server.inject({ method: "GET", url: "/api/senders?q=%40tester" });
    assert.equal(byHandle.json().total, 1);
    assert.equal(byHandle.json().items[0].senderId, "7");

    const byId = await h.server.inject({ method: "GET", url: "/api/senders?q=7" });
    assert.equal(byId.json().total, 1);
    assert.equal(byId.json().items[0].senderId, "7");

    const scoped = await h.server.inject({ method: "GET", url: "/api/senders?q=test&chat=200" });
    assert.deepEqual(scoped.json(), { items: [], total: 0 });

    const none = await h.server.inject({ method: "GET", url: "/api/senders?q=zzz" });
    assert.deepEqual(none.json(), { items: [], total: 0 });
  } finally {
    await h.close();
  }
});

test("archive console multi-user search combines users with other filters", async () => {
  const h = await harness();
  try {
    const empty = await h.server.inject({ method: "GET", url: "/api/search?users=" });
    assert.equal(empty.json().total, 5);

    const single = await h.server.inject({ method: "GET", url: "/api/search?users=7" });
    assert.equal(single.json().total, 2);
    assert.equal(single.json().totalMessages, 2);

    const wrongChat = await h.server.inject({ method: "GET", url: "/api/search?users=7&chat=200" });
    assert.equal(wrongChat.json().total, 0);

    const keyword = await h.server.inject({ method: "GET", url: "/api/search?users=7&q=%E5%A4%A9%E6%B0%94" });
    assert.equal(keyword.json().total, 1);
    assert.equal(keyword.json().items[0].record.text, "你好，今天天气不错");

    await h.store.saveBatch(
      [{ messageId: 6, chatId: "100", chatTitle: "测试群", date: "2025-03-04T11:00:00.000Z", text: "第八号用户的消息", messageType: "text", hasMedia: false, senderId: "8" }],
      []
    );
    const pair = await h.server.inject({ method: "GET", url: "/api/search?users=7,8" });
    assert.equal(pair.json().total, 3);

    const tooMany = Array.from({ length: 51 }, (_, index) => index + 1).join(",");
    const rejected = await h.server.inject({ method: "GET", url: `/api/search?users=${tooMany}` });
    assert.equal(rejected.statusCode, 400);
  } finally {
    await h.close();
  }
});

test("archive console sender summary aggregates counts, dates and per-chat stats", async () => {
  const h = await harness();
  try {
    const res = await h.server.inject({ method: "GET", url: "/api/senders/7/summary" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.sender.senderId, "7");
    assert.equal(body.total, 2);
    assert.equal(body.firstDate, "2025-03-01T10:00:00.000Z");
    assert.equal(body.lastDate, "2025-03-02T12:00:00.000Z");
    assert.equal(body.chats.length, 1);
    assert.equal(body.chats[0].chatId, "100");
    assert.equal(body.chats[0].count, 2);
    assert.equal(body.chats[0].lastText, "附上截图看看效果");

    const scoped = await h.server.inject({ method: "GET", url: "/api/senders/7/summary?chat=200" });
    assert.equal(scoped.statusCode, 200);
    assert.equal(scoped.json().total, 0);
    assert.deepEqual(scoped.json().chats, []);

    const missing = await h.server.inject({ method: "GET", url: "/api/senders/999/summary" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "没有该发送者的记录");
  } finally {
    await h.close();
  }
});

test("archive console reply chain resolves parent and children from replies", async () => {
  const h = await harness();
  try {
    const root = await h.server.inject({ method: "GET", url: "/api/messages/1/replies" });
    assert.equal(root.statusCode, 200);
    const rootBody = root.json();
    assert.equal(rootBody.parent, undefined);
    assert.equal(rootBody.replyToMsgId, undefined);
    assert.equal(rootBody.children.length, 1);
    assert.equal(rootBody.children[0].kind, "message");
    assert.equal(rootBody.children[0].record.messageId, 3);

    const reply = await h.server.inject({ method: "GET", url: "/api/messages/3/replies" });
    assert.equal(reply.statusCode, 200);
    const replyBody = reply.json();
    assert.equal(replyBody.replyToMsgId, 1);
    assert.equal(replyBody.parent.kind, "message");
    assert.equal(replyBody.parent.record.messageId, 1);
    assert.equal(replyBody.children.length, 0);

    const listed = await h.server.inject({ method: "GET", url: "/api/search" });
    const m3 = listed.json().items.find(
      (item: { kind: string; record?: { messageId: number } }) =>
        item.kind === "message" && item.record?.messageId === 3
    )?.record;
    assert.equal(m3?.replyToMsgId, 1);
    assert.equal(m3?.replyToText, "你好，今天天气不错");

    const missing = await h.server.inject({ method: "GET", url: "/api/messages/999/replies" });
    assert.equal(missing.statusCode, 404);
  } finally {
    await h.close();
  }
});

test("archive console forward filter matches by id or name", async () => {
  const h = await harness();
  try {
    const byName = await h.server.inject({ method: "GET", url: "/api/search?forwardFrom=%E8%BD%AC%E5%8F%91%E4%BA%BA" });
    const byNameBody = byName.json();
    assert.equal(byNameBody.total, 1);
    assert.equal(byNameBody.items[0].record.text, "好的收到");
    assert.equal(byNameBody.items[0].record.forwardFromId, "9");

    const byId = await h.server.inject({ method: "GET", url: "/api/search?forwardFrom=9" });
    assert.equal(byId.json().total, 1);
    assert.equal(byId.json().items[0].record.text, "好的收到");

    const none = await h.server.inject({ method: "GET", url: "/api/search?forwardFrom=%E6%97%A0%E5%85%B3" });
    assert.equal(none.json().total, 0);
  } finally {
    await h.close();
  }
});

test("archive console blocking a user hides them from sender queries too", async () => {
  const h = await harness();
  try {
    await h.server.inject({ method: "POST", url: "/api/blockedusers", payload: { userId: "7" } });

    const search = await h.server.inject({ method: "GET", url: "/api/search?users=7" });
    assert.equal(search.json().total, 0);

    const senders = await h.server.inject({ method: "GET", url: "/api/senders?q=tester" });
    assert.deepEqual(senders.json(), { items: [], total: 0 });

    const summary = await h.server.inject({ method: "GET", url: "/api/senders/7/summary" });
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.json().total, 0);
    assert.deepEqual(summary.json().chats, []);

    const replies = await h.server.inject({ method: "GET", url: "/api/messages/3/replies" });
    assert.equal(replies.statusCode, 404);
  } finally {
    await h.close();
  }
});

test("archive console album of one sender folds into a single entry for user search", async () => {
  const h = await harness();
  try {
    await h.store.saveBatch(
      [
        {
          messageId: 7, chatId: "100", chatTitle: "测试群", groupedId: "album-7",
          date: "2025-03-04T10:00:00.000Z", text: "用户相册一", messageType: "photo",
          hasMedia: true, mediaType: "photo", senderId: "7"
        },
        {
          messageId: 8, chatId: "100", chatTitle: "测试群", groupedId: "album-7",
          date: "2025-03-04T10:01:00.000Z", text: "用户相册二", messageType: "photo",
          hasMedia: true, mediaType: "photo", senderId: "7"
        }
      ],
      [
        { messageId: 7, chatId: "100", mediaType: "photo", fileName: "a.jpg", filePath: "/tmp/a.jpg" },
        { messageId: 8, chatId: "100", mediaType: "photo", fileName: "b.jpg", filePath: "/tmp/b.jpg" }
      ]
    );

    const search = await h.server.inject({ method: "GET", url: "/api/search?users=7" });
    const body = search.json();
    assert.equal(body.total, 3);
    assert.equal(body.totalMessages, 4);
    assert.equal(body.items[0].kind, "album");
    assert.equal(body.items[0].rows.length, 2);

    const summary = await h.server.inject({ method: "GET", url: "/api/senders/7/summary" });
    assert.equal(summary.json().total, 4);
    assert.equal(summary.json().lastDate, "2025-03-04T10:01:00.000Z");
    const chat = summary.json().chats.find((item: { chatId: string }) => item.chatId === "100");
    assert.equal(chat.lastText, "用户相册二");
  } finally {
    await h.close();
  }
});

test("archive console album folds the whole group when only one member matches", async () => {
  const h = await harness();
  try {
    await h.store.saveBatch(
      [
        {
          messageId: 9, chatId: "100", chatTitle: "测试群", groupedId: "album-9",
          date: "2025-03-04T10:00:00.000Z", text: "混合相册一", messageType: "photo",
          hasMedia: true, mediaType: "photo", senderId: "8"
        },
        {
          messageId: 10, chatId: "100", chatTitle: "测试群", groupedId: "album-9",
          date: "2025-03-04T10:01:00.000Z", text: "混合相册二", messageType: "photo",
          hasMedia: true, mediaType: "photo", senderId: "7"
        }
      ],
      [
        { messageId: 9, chatId: "100", mediaType: "photo", fileName: "c.jpg", filePath: "/tmp/c.jpg" },
        { messageId: 10, chatId: "100", mediaType: "photo", fileName: "d.jpg", filePath: "/tmp/d.jpg" }
      ]
    );

    const search = await h.server.inject({ method: "GET", url: "/api/search?users=7" });
    const body = search.json();
    assert.equal(body.total, 3);
    assert.equal(body.totalMessages, 3);
    const album = body.items.find((item: { kind: string }) => item.kind === "album");
    assert.equal(album.rows.length, 2);
  } finally {
    await h.close();
  }
});

async function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForHttp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 服务尚未就绪，继续等待
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("archive console service did not become ready");
}