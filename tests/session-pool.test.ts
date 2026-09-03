import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionPool, createGramLogger, type SessionClient } from "../src/telegram/pool.js";
import type { AppSettings } from "../src/config/settings.js";
import type { RuntimeLogger } from "@paperkite/sdk";

test("session operations are serialized without worker threads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-sessions-"));
  const settings: AppSettings = {
    telegram: { apiId: 1, apiHash: "hash", sessionsDir: directory },
    logging: { level: "error", directory }
  };
  const logger: RuntimeLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
  let starts = 0;
  let active = 0;
  let maximum = 0;
  const client: SessionClient = {
    connected: true,
    async start() { starts += 1; },
    async connect() {},
    async disconnect() {},
    async getMe() { return {}; },
    session: { save: () => "saved" }
  };
  const pool = new SessionPool(settings, logger, () => client);
  await pool.ensure(["primary", "primary.session"]);
  await Promise.all([
    pool.run("primary", async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    }),
    pool.run("primary", async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      active -= 1;
    })
  ]);
  assert.equal(starts, 1);
  assert.equal(maximum, 1);
  await pool.closeAll();
});

test("gramJS logs route through the app logger with the unified format", () => {
  const calls: { level: string; message: string }[] = [];
  const logger: RuntimeLogger = {
    debug: (message) => calls.push({ level: "debug", message }),
    info: (message) => calls.push({ level: "info", message }),
    warn: (message) => calls.push({ level: "warn", message }),
    error: (message) => calls.push({ level: "error", message }),
    child: () => logger
  };

  const gram = createGramLogger(logger, "info");
  gram.info("Running gramJS version 2.26.22");
  gram.warn("Connection to 149.154.167.91:80/TCPFull complete!");
  gram.error("unexpected data center");
  gram.debug("hidden below the info threshold");

  const debugLogger = createGramLogger(logger, "debug");
  debugLogger.debug("visible at debug level");

  assert.deepEqual(calls, [
    { level: "info", message: "Running gramJS version 2.26.22" },
    { level: "warn", message: "Connection to 149.154.167.91:80/TCPFull complete!" },
    { level: "error", message: "unexpected data center" },
    { level: "debug", message: "visible at debug level" }
  ]);
});
