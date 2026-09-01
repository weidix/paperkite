import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConsoleServer } from "../packages/message-archive/src/console/server.js";
import { SqliteArchiveStore, type MessageRow } from "../packages/message-archive/src/storage/index.js";
import type { RuntimeLogger } from "@paperkite/sdk";

const logger: RuntimeLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
const CHAT_ID = "42";

function messageRow(messageId: number, text: string, username: string, hour: number): MessageRow {
  return {
    messageId,
    chatId: CHAT_ID,
    chatTitle: "技术交流",
    senderUsername: username,
    date: `2026-08-30T${String(hour).padStart(2, "0")}:00:00.000Z`,
    text,
    messageType: "text",
    hasMedia: false
  };
}

test("web console searches messages and returns context around an anchor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-web-console-"));
  const store = new SqliteArchiveStore(join(directory, "archive.db"));
  await store.init();
  await store.saveBatch([
    messageRow(1, "clash 香港 节点", "alice", 10),
    messageRow(2, "clash 广告", "bob", 11),
    messageRow(3, "香港 其他消息", "carol", 12)
  ], []);

  const server = createConsoleServer(store, { logger });
  try {
    const search = await server.inject({
      method: "GET",
      url: "/api/search/structured?keyword=clash%20%E9%A6%99%E6%B8%AF&exclude_keyword=%E5%B9%BF%E5%91%8A&chat_title=%E6%8A%80%E6%9C%AF&date_from=2026-08-30T00:00:00.000Z&date_to=2026-08-30T23:59:59.000Z"
    });
    assert.equal(search.statusCode, 200);
    const payload = search.json() as { total: number; items: Array<{ id: string; sender_username?: string; media_items: never[]; has_preview: boolean }> };
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.sender_username, "alice");
    assert.equal(payload.items[0]?.has_preview, false);

    const rowId = payload.items[0]?.id;
    assert.ok(rowId);
    const context = await server.inject({
      method: "GET",
      url: `/api/search/context?message_rowid=${rowId}&before_n=1&after_n=1`
    });
    assert.equal(context.statusCode, 200);
    const contextPayload = context.json() as {
      anchor: { message_id: number; chat_title: string | null };
      before: Array<{ message_id: number }>;
      after: Array<{ message_id: number }>;
    };
    assert.equal(contextPayload.anchor.message_id, 1);
    assert.equal(contextPayload.anchor.chat_title, "技术交流");
    assert.deepEqual(contextPayload.before, []);
    assert.deepEqual(contextPayload.after.map((item) => item.message_id), [2]);
  } finally {
    await server.close();
    await store.close();
  }
});

test("web console rejects bad filters and stays unavailable without media session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-web-console-"));
  const store = new SqliteArchiveStore(join(directory, "archive.db"));
  await store.init();
  await store.saveBatch([messageRow(1, "hello", "alice", 10)], []);

  const server = createConsoleServer(store, { logger });
  try {
    const badTime = await server.inject({ method: "GET", url: "/api/search/structured?time_mode=sideways" });
    assert.equal(badTime.statusCode, 422);

    const badRange = await server.inject({
      method: "GET",
      url: "/api/search/structured?date_from=2026-09-01T00:00:00.000Z&date_to=2026-08-01T00:00:00.000Z"
    });
    assert.equal(badRange.statusCode, 422);

    const search = await server.inject({ method: "GET", url: "/api/search/structured?keyword=hello" });
    const rowId = (search.json() as { items: Array<{ id: string }> }).items[0]?.id;
    assert.ok(rowId);

    for (const url of [
      `/api/messages/${rowId}/media`,
      `/api/messages/${rowId}/album`,
      "/api/media-files/1"
    ]) {
      const response = await server.inject({ method: "GET", url });
      assert.equal(response.statusCode, 503, url);
    }
  } finally {
    await server.close();
    await store.close();
  }
});