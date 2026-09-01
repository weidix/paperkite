import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringSession } from "telegram/sessions/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateSessionDirectory } from "../src/telegram/session-migration.js";

test("converts a SQLite session into a GramJS string session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-session-migration-"));
  const source = join(directory, "primary.session");
  const database = new DatabaseSync(source);
  database.exec("CREATE TABLE sessions (dc_id INTEGER, server_address TEXT, port INTEGER, auth_key BLOB)");
  database.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(5, "91.108.56.101", 443, Buffer.alloc(256, 7));
  database.close();

  const target = join(directory, "accounts");
  const result = await migrateSessionDirectory(directory, target);
  assert.deepEqual(result, { migrated: ["primary.session"], skipped: [] });
  const value = await readFile(join(target, "primary.session"), "utf8");
  const session = new StringSession(value);
  await session.load();
  assert.equal(session.dcId, 5);
  assert.equal(session.serverAddress, "91.108.56.101");
  assert.equal(session.port, 443);
  assert.equal(session.authKey?.getKey()?.byteLength, 256);
});
