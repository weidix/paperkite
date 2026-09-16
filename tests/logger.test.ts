import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppLogger } from "../src/engine/logger.js";

test("concurrent log writes keep their order after flush", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-logger-"));
  const logs = join(directory, "logs");
  const logger = new AppLogger("info", logs);
  for (let index = 0; index < 200; index += 1) {
    logger.info(`line ${index}`);
  }
  await logger.flush();
  const lines = (await readFile(join(logs, "paperkite.log"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 200);
  for (let index = 0; index < 200; index += 1) {
    assert.match(lines[index] as string, new RegExp(`line ${index}$`));
  }
});

test("child scopes share one sink and flush together", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-logger-child-"));
  const logs = join(directory, "logs");
  const logger = new AppLogger("info", logs);
  const child = logger.child("worker");
  child.info("hello");
  logger.info("world");
  await logger.flush();
  const paperkite = (await readFile(join(logs, "paperkite.log"), "utf8")).trim().split("\n");
  const worker = (await readFile(join(logs, "worker.log"), "utf8")).trim().split("\n");
  assert.equal(paperkite.length, 1);
  assert.equal(worker.length, 1);
  assert.match(paperkite[0] as string, /world$/);
  assert.match(worker[0] as string, /hello$/);
});
