import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createArchiveStore, SqliteArchiveStore, type MessageRow } from "../packages/message-archive/src/storage/index.js";
import { paramPlaceholders, toIsoDate } from "../packages/message-archive/src/storage/model.js";

const CHAT_ID = "100";

function messageRow(messageId: number, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    messageId,
    chatId: CHAT_ID,
    chatTitle: "Test Chat",
    senderId: "42",
    senderUsername: "tester",
    date: "2026-08-30T10:00:00.000Z",
    text: "hello archive",
    messageType: "text",
    hasMedia: false,
    ...overrides
  };
}

async function newStore(): Promise<{ store: SqliteArchiveStore; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-archive-"));
  const store = new SqliteArchiveStore(join(directory, "archive.db"));
  await store.init();
  return { store, cleanup: () => store.close() };
}

test("sqlite backend saves and dedups messages", async () => {
  const { store, cleanup } = await newStore();
  try {
    const first = await store.saveBatch([messageRow(1)], []);
    assert.deepEqual(first, { messages: 1, media: 0 });
    const second = await store.saveBatch([messageRow(1)], []);
    assert.deepEqual(second, { messages: 0, media: 0 });
    assert.deepEqual(await store.messageIdsExist(CHAT_ID, [1, 2, 3]), new Set([1]));
  } finally {
    await cleanup();
  }
});

test("sqlite backend tracks last message info and sync sessions", async () => {
  const { store, cleanup } = await newStore();
  try {
    assert.equal(await store.getLastMessageInfo(CHAT_ID), undefined);
    await store.saveChat({
      chatId: CHAT_ID,
      title: "Test Chat",
      username: "test_chat",
      type: "channel"
    });
    const sessionId = await store.startSyncSession(CHAT_ID, "2026-08-01T00:00:00.000Z", "2026-08-30T00:00:00.000Z");
    assert.ok(sessionId > 0);
    await store.completeSyncSession(sessionId, 5, 1);

    await store.saveBatch([messageRow(7), messageRow(3)], []);
    const info = await store.getLastMessageInfo(CHAT_ID);
    assert.equal(info?.messageId, 7);
    assert.ok(info?.date);
  } finally {
    await cleanup();
  }
});

test("sqlite backend commits messages and media in one transaction", async () => {
  const { store, cleanup } = await newStore();
  try {
    const result = await store.saveBatch(
      [messageRow(7)],
      [{
        messageId: 7,
        chatId: CHAT_ID,
        mediaType: "photo",
        fileName: "7.jpg",
        filePath: "/tmp/7.jpg",
        fileSize: 1024,
        mimeType: "image/jpeg"
      }]
    );
    assert.deepEqual(result, { messages: 1, media: 1 });
    const file = await store.getMediaFileById("1");
    assert.equal(file?.fileName, "7.jpg");
    assert.equal(file?.mediaType, "photo");
  } finally {
    await cleanup();
  }
});

test("structured search applies keyword terms, time modes and pagination", async () => {
  const { store, cleanup } = await newStore();
  try {
    await store.saveBatch([
      messageRow(1, { date: "2026-08-30T10:00:00.000Z", text: "clash 香港 节点" }),
      messageRow(2, { date: "2026-08-30T11:00:00.000Z", text: "clash 广告" }),
      messageRow(3, { date: "2026-08-31T12:00:00.000Z", text: "香港 其他消息" })
    ], []);

    const all = await store.searchStructured({});
    assert.equal(all.total, 3);

    const matched = await store.searchStructured({
      keyword: "clash 香港",
      dateFrom: "2026-08-30T00:00:00.000Z",
      dateTo: "2026-08-30T23:59:59.000Z"
    });
    assert.equal(matched.total, 1);
    assert.equal(matched.items[0]?.text, "clash 香港 节点");

    const excluded = await store.searchStructured({ keyword: "clash", excludeKeyword: "广告", timeMode: "include" });
    assert.equal(excluded.total, 1);

    const reversed = await store.searchStructured({ keyword: "香港", timeMode: "exclude", dateFrom: "2026-08-30T00:00:00.000Z", dateTo: "2026-08-31T23:59:59.000Z" });
    assert.equal(reversed.total, 0);
  } finally {
    await cleanup();
  }
});

test("message context returns the neighborhood around an anchor", async () => {
  const { store, cleanup } = await newStore();
  try {
    await store.saveBatch([
      messageRow(1, { text: "first" }),
      messageRow(2, { text: "second" }),
      messageRow(3, { text: "third" })
    ], []);
    const search = await store.searchStructured({ keyword: "second" });
    const rowId = search.items[0]?.rowId;
    assert.ok(rowId);

    const context = await store.getMessageContext(rowId, 1, 1);
    assert.equal(context.anchor?.text, "second");
    assert.deepEqual(context.before.map((row) => row.text), ["first"]);
    assert.deepEqual(context.after.map((row) => row.text), ["third"]);
  } finally {
    await cleanup();
  }
});

test("unknown archive backend raises", () => {
  assert.throws(() => createArchiveStore({ backend: "oracle" }), /unknown archive backend/);
  assert.throws(() => createArchiveStore({ backend: "postgres" }), /needs url/);
});

test("paramPlaceholders emits positional $n bindings so batch inserts never bind literals", () => {
  assert.equal(
    paramPlaceholders(1, 18),
    "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18"
  );
  assert.equal(
    paramPlaceholders(19, 18),
    "$19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36"
  );
  assert.equal(paramPlaceholders(1, 7), "$1, $2, $3, $4, $5, $6, $7");
});

test("toIsoDate accepts ISO strings, dates, and epoch timestamps", () => {
  const iso = "2026-09-02T06:38:00.000Z";
  assert.equal(toIsoDate(iso), iso);
  assert.equal(toIsoDate(new Date("2026-09-02T06:38:00.000Z")), iso);
  assert.equal(toIsoDate(1_788_331_080), "2026-09-02T06:38:00.000Z");
  assert.equal(toIsoDate("1788331080"), "2026-09-02T06:38:00.000Z");
  assert.equal(toIsoDate(1_788_331_080_000), iso);
  assert.throws(() => toIsoDate("not a date"), /invalid date value/);
});