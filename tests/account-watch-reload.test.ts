import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { register as registerAccountWatch } from "../packages/account-watch/src/index.js";
import { fromMapping } from "../src/config/loader.js";
import { CapabilityRegistry } from "../src/extensions/registry.js";
import { AppLogger } from "../src/engine/logger.js";
import { Runtime } from "../src/engine/runtime.js";
import type { SessionPool } from "../src/telegram/pool.js";

test("reload is not blocked by a watch.session trigger stuck on an in-flight session call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-account-watch-reload-"));
  const logger = new AppLogger("info", join(directory, "logs"));
  const registry = new CapabilityRegistry();
  await registerAccountWatch(registry.context(logger, "@paperkite/plugin-account-watch"));

  let stuckCalls = 0;
  const fakeSessions = {
    ensure: async () => undefined,
    access: () => ({
      get: () => undefined,
      run: async () => {
        stuckCalls += 1;
        await new Promise<void>(() => undefined);
      }
    }),
    closeAll: async () => undefined
  } as unknown as SessionPool;

  const catalog = fromMapping({
    triggers: [{ id: "account-primary", capability: "watch.session", session: "acct-1", config: { intervalSeconds: 60 } }]
  });
  const runtime = new Runtime({
    catalog,
    registry,
    sessions: fakeSessions,
    logger,
    installed: [],
    reloadCatalog: async () => catalog
  });
  await runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(stuckCalls, 1, "the watcher must be inside its session call when reload starts");
  assert.equal(runtime.snapshot.triggers.length, 1);

  const startedAt = Date.now();
  await runtime.reload();
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 1_500, "reload must not wait the whole stop grace: " + elapsed + "ms");
  assert.equal(runtime.snapshot.running, true);
  assert.deepEqual(runtime.snapshot.triggers, ["account-primary"], "watcher restarts after reload");
  assert.ok(stuckCalls >= 2, "watcher runs again after reload: " + stuckCalls);
  await runtime.stop();
});