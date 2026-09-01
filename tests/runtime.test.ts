import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Action, type RuntimeEvent, type RuntimeSnapshot } from "@paperkite/sdk";
import { fromMapping } from "../src/config/loader.js";
import type { FlowCatalog } from "../src/config/model.js";
import { CapabilityRegistry } from "../src/extensions/registry.js";
import { AppLogger } from "../src/engine/logger.js";
import { Runtime } from "../src/engine/runtime.js";
import type { SessionPool } from "../src/telegram/pool.js";

class EchoAction extends Action {
  static runs: { id: string; payload: unknown }[] = [];

  async run(): Promise<void> {
    EchoAction.runs.push({ id: this.id, payload: this.payload });
  }
}

const fakeSessions = {
  ensure: async () => undefined,
  access: () => ({ get: () => undefined, run: async (_name: string, op: (client: unknown) => unknown) => op(undefined) }),
  closeAll: async () => undefined
} as unknown as SessionPool;

async function makeRuntime(
  settings: { catalog?: FlowCatalog; reloadCatalog?: () => Promise<FlowCatalog> } = {}
): Promise<{ runtime: Runtime; events: RuntimeEvent[] }> {
  EchoAction.runs = [];
  const directory = await mkdtemp(join(tmpdir(), "paperkite-runtime-"));
  const logger = new AppLogger("info", join(directory, "logs"));
  const registry = new CapabilityRegistry();
  registry.register("action", "demo.action", EchoAction, "plugin-demo");
  const runtime = new Runtime({
    catalog: settings.catalog ?? fromMapping({}),
    registry,
    sessions: fakeSessions,
    logger,
    reloadCatalog: settings.reloadCatalog
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  return { runtime, events };
}

test("executeAction runs an action once and emits start/finish events", async () => {
  const { runtime, events } = await makeRuntime();
  await runtime.executeAction({ capability: "demo.action", config: { mark: 1 }, label: "manual" });
  assert.deepEqual(EchoAction.runs, [{ id: "manual", payload: { mark: 1 } }]);
  assert.equal(events.filter((event) => event.type === "action.started").length, 1);
  const finished = events.find((event) => event.type === "action.finished");
  assert.equal(finished?.type, "action.finished");
  await runtime.stop();
});

test("runFlow executes a schedule action once and reload swaps the catalog", async () => {
  const catalog = fromMapping({
    schedules: [{ id: "daily", cron: "0 4 * * *", run: { capability: "demo.action", config: { mark: 2 } } }]
  });
  const { runtime, events } = await makeRuntime({ catalog, reloadCatalog: async () => fromMapping({}) });
  await assert.rejects(runtime.runFlow("unknown"), /unknown flow/);
  await runtime.runFlow("daily");
  assert.deepEqual(EchoAction.runs, [{ id: "schedule:daily", payload: { mark: 2 } }]);
  await runtime.reload();
  const snapshot = runtime.snapshot as RuntimeSnapshot;
  assert.deepEqual(snapshot.flows, []);
  assert.equal(events.some((event) => event.type === "config.reloaded" && event.ok), true);
  await runtime.stop();
});