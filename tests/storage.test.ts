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
      messageRow(3, { text: "third" }),
      messageRow(4, { text: "fourth" }),
      messageRow(5, { text: "fifth" })
    ], []);
    const search = await store.searchStructured({ keyword: "second" });
    const rowId = search.items[0]?.rowId;
    assert.ok(rowId);

    const context = await store.getMessageContext(rowId, 1, 1);
    assert.equal(context.anchor?.kind, "message");
    assert.equal(context.anchor?.kind === "message" && context.anchor.record.text, "second");
    assert.deepEqual(
      context.before.map((entry) => (entry.kind === "message" ? entry.record.text : null)),
      ["first"]
    );
    assert.deepEqual(
      context.after.map((entry) => (entry.kind === "message" ? entry.record.text : null)),
      ["third"]
    );
    assert.equal(context.beforeN, 1);
    assert.equal(context.afterN, 3);

    const paged = await store.getMessageContext(rowId, 1, 1, 1, 2);
    assert.deepEqual(
      paged.before.map((entry) => (entry.kind === "message" ? entry.record.text : null)),
      []
    );
    assert.deepEqual(
      paged.after.map((entry) => (entry.kind === "message" ? entry.record.text : null)),
      ["fifth"]
    );
  } finally {
    await cleanup();
  }
});

test("message context folds album members into a single entry", async () => {
  const { store, cleanup } = await newStore();
  try {
    await store.saveBatch([
      messageRow(1, { date: "2026-08-30T10:00:00.000Z", text: "alpha" }),
      messageRow(2, { date: "2026-08-30T10:01:00.000Z", groupedId: "g1", text: "album caption", hasMedia: true, mediaType: "photo" }),
      messageRow(3, { date: "2026-08-30T10:02:00.000Z", groupedId: "g1", text: "", hasMedia: true, mediaType: "photo" }),
      messageRow(4, { date: "2026-08-30T10:03:00.000Z", groupedId: "g1", text: "", hasMedia: true, mediaType: "photo" }),
      messageRow(5, { date: "2026-08-30T10:04:00.000Z", text: "omega" })
    ], []);

    // 锚点是相册中间的成员（rowId 3）：锚点条目为整个相册，窗口按条目计
    const viaMiddle = await store.getMessageContext("3", 5, 5);
    assert.equal(viaMiddle.anchor?.kind, "album");
    if (viaMiddle.anchor?.kind !== "album") throw new Error("expected album anchor");
    assert.equal(viaMiddle.anchor.captionText, "album caption");
    assert.equal(viaMiddle.anchor.focusRowId, "3");
    assert.equal(viaMiddle.anchor.rows.length, 3);
    assert.deepEqual(viaMiddle.before.map((entry) => entry.kind), ["message"]);
    assert.deepEqual(viaMiddle.after.map((entry) => entry.kind), ["message"]);
    assert.equal(viaMiddle.beforeN, 1);
    assert.equal(viaMiddle.afterN, 1);

    // 锚点是普通消息：相册作为整体出现在 after，计数按条目
    const viaFirst = await store.getMessageContext("1", 5, 5);
    assert.deepEqual(viaFirst.after.map((entry) => entry.kind), ["album", "message"]);
    const album = viaFirst.after[0];
    if (album?.kind !== "album") throw new Error("expected album entry");
    assert.equal(album.rows.length, 3);
    assert.equal(album.captionText, "album caption");
    assert.equal(viaFirst.afterN, 2);

    // 锚点为组内最后一条（rowId 4）：整组居中，两侧窗口不含本组
    const viaLast = await store.getMessageContext("4", 5, 5);
    assert.equal(viaLast.anchor?.kind, "album");
    assert.deepEqual(viaLast.before.map((entry) => entry.kind), ["message"]);
    assert.deepEqual(viaLast.after.map((entry) => entry.kind), ["message"]);
    assert.equal(viaLast.beforeN, 1);
    assert.equal(viaLast.afterN, 1);

    // 窗口边界补全：锚点 m5 且 before 只取 1 条 → 相册整体进入窗口，成员完整
    const viaNext = await store.getMessageContext("5", 1, 0);
    assert.deepEqual(viaNext.before.map((entry) => entry.kind), ["album"]);
    const boundaryAlbum = viaNext.before[0];
    if (boundaryAlbum?.kind !== "album") throw new Error("expected album entry");
    assert.equal(boundaryAlbum.rows.length, 3);
    assert.equal(viaNext.beforeN, 2);

    // 偏移以条目为单位推进
    const paged = await store.getMessageContext("1", 5, 5, 0, 1);
    assert.deepEqual(paged.after.map((entry) => entry.kind), ["message"]);
  } finally {
    await cleanup();
  }
});

test("chat ledger joins chats metadata with per-chat aggregates", async () => {
  const { store, cleanup } = await newStore();
  try {
    await store.saveChat({ chatId: CHAT_ID, title: "Test Chat", username: "test_chat", type: "group" });
    await store.saveChat({ chatId: "200", title: "Empty Chat", type: "channel" });
    await store.saveBatch([
      messageRow(1, { text: "first" }),
      messageRow(2, { text: "second" }),
      messageRow(3, { text: "third" })
    ], []);

    const ledger = await store.listChatLedger(10);
    assert.equal(ledger.length, 2);
    const chat = ledger.find((row) => row.chatId === CHAT_ID);
    assert.equal(chat?.title, "Test Chat");
    assert.equal(chat?.username, "test_chat");
    assert.equal(chat?.type, "group");
    assert.equal(chat?.count, 3);
    assert.equal(chat?.lastText, "third");
    assert.match(chat?.lastDate ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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