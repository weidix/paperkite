import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionUnavailableError } from "../src/engine/errors.js";
import { SessionPool } from "../src/telegram/pool.js";
import { createGramLogger, type SessionClient } from "../src/telegram/client.js";
import { writeSessionFile } from "../src/telegram/session-files.js";
import type { AppSettings } from "../src/config/settings.js";
import type { RuntimeLogger } from "@paperkite/sdk";

test("session operations are serialized without worker threads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-sessions-"));
  const settings: AppSettings = {
    telegram: { apiId: 1, apiHash: "hash", sessionsDir: directory },
    logging: { level: "error", directory }
  };
  await writeSessionFile(directory, "primary", "saved");
  const logger = makeLogger();
  let active = 0;
  let maximum = 0;
  const pool = new SessionPool(settings, logger, () => workingClient());
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

function makeLogger(): RuntimeLogger {
  const logger: RuntimeLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return logger;
    }
  };
  return logger;
}

function workingClient(): SessionClient {
  return {
    async start() {},
    async connect() {},
    async disconnect() {},
    async invoke() {},
    session: { save: () => "saved" }
  };
}

function accountFailure(): Error {
  return Object.assign(new Error("500: INTERNAL"), { errorMessage: "INTERNAL", code: 500 });
}

test("session faults isolate the session and automatic reconnects recover it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-guard-"));
  const settings: AppSettings = {
    telegram: {
      apiId: 1,
      apiHash: "hash",
      sessionsDir: directory,
      sessionGuard: { windowMs: 200, threshold: 2, backoffMinMs: 30, backoffMaxMs: 200 }
    },
    logging: { level: "error", directory }
  };
  await writeSessionFile(directory, "primary", "saved");
  const logger = makeLogger();
  const pool = new SessionPool(settings, logger, () => workingClient());
  await pool.ensure(["primary"]);
  const states: string[] = [];
  pool.subscribe((change) => states.push(change.state));

  const failing = async (): Promise<number> => {
    throw accountFailure();
  };
  await assert.rejects(pool.run("primary", failing));
  await assert.rejects(pool.run("primary", failing));
  await assert.rejects(pool.run("primary", async () => 1), (error: unknown) => {
    assert.ok(error instanceof SessionUnavailableError);
    assert.equal((error as SessionUnavailableError).session, "primary");
    return true;
  });
  assert.ok(states.includes("isolated"), "session must isolate after the fault threshold: " + states.join(","));

  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(await pool.run("primary", async () => 42), 42);
  assert.ok(states.includes("connected"), "session must reconnect by itself: " + states.join(","));
  await pool.closeAll();
});

test("auth-class failures move the session to waiting-auth with a typed error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-auth-"));
  const settings: AppSettings = {
    telegram: { apiId: 1, apiHash: "hash", sessionsDir: directory },
    logging: { level: "error", directory }
  };
  await writeSessionFile(directory, "primary", "saved");
  const logger = makeLogger();
  const pool = new SessionPool(settings, logger, () => workingClient());
  await pool.ensure(["primary"]);
  const authError = Object.assign(new Error("401: AUTH_KEY_UNREGISTERED"), {
    errorMessage: "AUTH_KEY_UNREGISTERED",
    code: 401
  });
  await assert.rejects(pool.run("primary", async () => {
    throw authError;
  }));
  assert.equal(pool.state("primary"), "waiting-auth");
  assert.match(
    pool.states().find((info) => info.name === "primary")?.reason ?? "",
    /run `paperkite session login primary` to log in/
  );
  await assert.rejects(pool.run("primary", async () => 1), (error: unknown) => {
    assert.ok(error instanceof SessionUnavailableError);
    return true;
  });
  await pool.closeAll();
});

test("action-class failures do not count toward session isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-action-"));
  const settings: AppSettings = {
    telegram: {
      apiId: 1,
      apiHash: "hash",
      sessionsDir: directory,
      sessionGuard: { windowMs: 200, threshold: 2, backoffMinMs: 30, backoffMaxMs: 200 }
    },
    logging: { level: "error", directory }
  };
  await writeSessionFile(directory, "primary", "saved");
  const logger = makeLogger();
  const pool = new SessionPool(settings, logger, () => workingClient());
  await pool.ensure(["primary"]);
  const peerError = Object.assign(new Error("400: PEER_ID_INVALID"), { errorMessage: "PEER_ID_INVALID", code: 400 });
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(
      pool.run("primary", async () => {
        throw peerError;
      })
    );
  }
  assert.equal(pool.state("primary"), "connected");
  await pool.closeAll();
});

test("access hands out an implicit single-session handle only for a declared session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-access-"));
  const settings: AppSettings = {
    telegram: { apiId: 1, apiHash: "hash", sessionsDir: directory },
    logging: { level: "error", directory }
  };
  await writeSessionFile(directory, "primary", "saved");
  const logger = makeLogger();
  const pool = new SessionPool(settings, logger, () => workingClient());
  await pool.ensure(["primary"]);
  const access = pool.access("primary");
  assert.ok(access, "a declared session gets a session handle");
  assert.equal(await access!.run(async () => 42), 42);
  assert.equal(pool.access(undefined), undefined, "plugins without a declared session see no handle");
  await pool.closeAll();
});

test("startup with a missing session isolates it and reports the login command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-missing-"));
  const settings: AppSettings = {
    telegram: { apiId: 1, apiHash: "hash", sessionsDir: directory },
    logging: { level: "error", directory }
  };
  const logger = makeLogger();
  const pool = new SessionPool(settings, logger, () => workingClient());
  await pool.ensure(["primary"]);
  assert.equal(pool.state("primary"), "waiting-auth");
  const info = pool.states().find((item) => item.name === "primary");
  assert.ok(info, "the missing session must be reported");
  assert.match(info.reason ?? "", /has no saved login; run `paperkite session login primary` to log in/);
  await assert.rejects(pool.run("primary", async () => 1), (error: unknown) => {
    assert.ok(error instanceof SessionUnavailableError);
    assert.match(error.message, /run `paperkite session login primary` to log in/);
    return true;
  });
  await pool.closeAll();
});