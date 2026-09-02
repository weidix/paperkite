import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { register as registerConsoleWeb } from "../packages/console-web/src/index.js";
import { fromMapping } from "../src/config/loader.js";
import { CapabilityRegistry } from "../src/extensions/registry.js";
import { AppLogger } from "../src/engine/logger.js";
import { Runtime } from "../src/engine/runtime.js";
import type { SessionPool } from "../src/telegram/pool.js";
import type { RuntimeEvent } from "@paperkite/sdk";

const fakeSessions = {
  ensure: async () => undefined,
  access: () => ({ get: () => undefined, run: async (_name: string, op: (client: unknown) => unknown) => op(undefined) }),
  closeAll: async () => undefined
} as unknown as SessionPool;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

test("reload completes and the console restarts while its own SSE stream is open", async () => {
  const port = await freePort();
  const directory = await mkdtemp(join(tmpdir(), "paperkite-console-reload-"));
  const logger = new AppLogger("info", join(directory, "logs"));
  const registry = new CapabilityRegistry();
  await registerConsoleWeb(registry.context(logger, "@paperkite/plugin-console-web"));
  const catalog = fromMapping({
    services: [{ id: "console", capability: "runtime.console_web", config: { host: "127.0.0.1", port } }]
  });
  const runtime = new Runtime({
    catalog,
    registry,
    sessions: fakeSessions,
    logger,
    installed: [],
    reloadCatalog: async () => catalog
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  try {
    await runtime.start();
    assert.ok(await waitFor(() => runtime.snapshot.activeServices.includes("console"), 3_000));

    const sse = http.get(`http://127.0.0.1:${port}/api/events`);
    sse.on("error", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const response = await fetch(`http://127.0.0.1:${port}/api/runtime/reload`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });

    const restarted = await waitFor(() => runtime.snapshot.activeServices.includes("console"), 3_000);
    assert.ok(restarted, "console service must be running again after reload");
    assert.equal(events.some((event) => event.type === "config.reloaded" && event.ok), true);

    sse.destroy();
    await runtime.stop();
  } finally {
    await runtime.stop().catch(() => undefined);
  }
});