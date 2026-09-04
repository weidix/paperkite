import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeLogger, ServiceContext, SessionAccess } from "@paperkite/sdk";
import type { TelegramMessage } from "../packages/message-archive/src/archiver.js";
import { createArchiveConsoleServer } from "../packages/message-archive/src/console/server.js";
import { ArchiveConsoleWebService } from "../packages/message-archive/src/console/service.js";
import { SqliteArchiveStore, type MediaRow, type MessageRow } from "../packages/message-archive/src/storage/index.js";

const logger: RuntimeLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };

class FakeLiveClient {
  calls: string[] = [];
  message: TelegramMessage | undefined;
  missingIds: readonly number[] = [];

  async getMessages(_chatId: string, options: { ids: readonly number[] }): Promise<readonly TelegramMessage[]> {
    this.calls.push("getMessages:" + options.ids.join(","));
    if (options.ids.some((id) => this.missingIds.includes(id))) {
      throw new Error('Could not find the input entity for {"channelId":2614030056,"className":"PeerChannel"}');
    }
    return this.message && options.ids.includes(this.message.id) ? [this.message] : [];
  }

  async downloadMedia(message: TelegramMessage): Promise<Buffer | undefined> {
    this.calls.push("downloadMedia:" + message.id);
    return Buffer.from("LIVE-PHOTO-BYTES");
  }
}

function fakeSessions(client: FakeLiveClient): SessionAccess & { get(name: string): unknown } {
  return {
    get: () => client,
    run: async <T>(_name: string, operation: (client: unknown) => T | Promise<T>) => operation(client)
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

async function harness(options: { session?: boolean; missingIds?: readonly number[] } = {}): Promise<Harness> {
  const tmp = await mkdtemp(join(tmpdir(), "paperkite-archive-console-"));
  const mediaDir = join(tmp, "media");
  await mkdir(mediaDir, { recursive: true });
  const store = new SqliteArchiveStore(join(tmp, "archive.db"));
  await store.init();
  await seed(store, mediaDir);

  const client = new FakeLiveClient();
  client.message = { id: 3, date: 0, media: { className: "MessageMediaPhoto" } };
  client.missingIds = options.missingIds ?? [];
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

async function seed(store: SqliteArchiveStore, mediaDir: string): Promise<void> {
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

    const chat = await h.server.inject({ method: "GET", url: "/api/search?chat=200" });
    assert.equal(chat.statusCode, 200);
    assert.equal(chat.json().total, 1);

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

      const notFound = await withSession.server.inject({ method: "GET", url: "/api/mediafiles/3/live" });
      assert.equal(notFound.statusCode, 404);
    } finally {
      await withSession.close();
    }
  } finally {
    await h.close();
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
    payload: { file: join(tmp, "archive.db"), host: "127.0.0.1", port, publicDir },
    signal: controller.signal,
    logger
  };
  const service = new ArchiveConsoleWebService(context);
  const running = service.run();

  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(base + "/api/state");
  const state = await (await fetch(base + "/api/state")).json();
  assert.deepEqual(state, { backend: "sqlite", session: null, mediaRoot: null });
  const page = await (await fetch(base + "/")).text();
  assert.match(page, /归档台/);

  controller.abort();
  await running;
  await assert.rejects(fetch(base + "/api/state"));
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