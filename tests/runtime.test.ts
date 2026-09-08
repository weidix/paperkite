import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Action, Service, Trigger, type RuntimeEvent, type RuntimeSnapshot } from "@paperkite/sdk";
import { fromMapping } from "../src/config/loader.js";
import type { FlowCatalog } from "../src/config/model.js";
import { CapabilityRegistry } from "../src/extensions/registry.js";
import { AppLogger } from "../src/engine/logger.js";
import { Runtime } from "../src/engine/runtime.js";
import type { SessionPool } from "../src/telegram/pool.js";

class EchoAction extends Action {
  static runs: { id: string; config: unknown }[] = [];

  async run(): Promise<void> {
    EchoAction.runs.push({ id: this.id, config: this.config });
  }
}

const fakeSessions = {
  ensure: async () => undefined,
  access: () => ({ run: async (operation: (client: unknown) => unknown) => operation(undefined) }),
  closeAll: async () => undefined,
  subscribe: () => () => undefined,
  state: () => undefined,
  states: () => []
} as unknown as SessionPool;

async function makeRuntime(
  settings: {
    catalog?: FlowCatalog;
    reloadCatalog?: () => Promise<FlowCatalog>;
    stopGraceMs?: number;
    register?: (registry: CapabilityRegistry) => void;
    sessions?: SessionPool;
  } = {}
): Promise<{ runtime: Runtime; events: RuntimeEvent[] }> {
  EchoAction.runs = [];
  const directory = await mkdtemp(join(tmpdir(), "paperkite-runtime-"));
  const logger = new AppLogger("info", join(directory, "logs"));
  const registry = new CapabilityRegistry();
  registry.register("action", "demo.action", EchoAction, "plugin-demo");
  settings.register?.(registry);
  const runtime = new Runtime({
    catalog: settings.catalog ?? fromMapping({}),
    registry,
    sessions: settings.sessions ?? fakeSessions,
    logger,
    installed: [],
    reloadCatalog: settings.reloadCatalog,
    stopGraceMs: settings.stopGraceMs
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  return { runtime, events };
}

test("executeAction runs an action once and emits start/finish events", async () => {
  const { runtime, events } = await makeRuntime();
  await runtime.executeAction({ capability: "demo.action", config: { mark: 1 }, label: "manual" });
  assert.deepEqual(EchoAction.runs, [{ id: "manual", config: { mark: 1 } }]);
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
  assert.deepEqual(EchoAction.runs, [{ id: "schedule:daily", config: { mark: 2 } }]);
  assert.equal(
    events.some(
      (event) => event.type === "flow.finished" && event.kind === "schedule" && event.id === "daily" && event.ok
    ),
    true
  );
  await runtime.reload();
  const snapshot = runtime.snapshot as RuntimeSnapshot;
  assert.deepEqual(snapshot.flows, []);
  assert.equal(events.some((event) => event.type === "flows.reloaded" && event.ok), true);
  await runtime.stop();
});

class SlowStopService extends Service {
  static runs = 0;

  async run(): Promise<void> {
    SlowStopService.runs += 1;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        setTimeout(() => resolve(), 600);
      };
      if (this.signal.aborted) finish();
      else this.signal.addEventListener("abort", finish, { once: true });
    });
  }
}

class WaitTrigger extends Trigger {
  static runs = 0;

  async run(): Promise<void> {
    WaitTrigger.runs += 1;
    await new Promise<void>((resolve) => this.signal.addEventListener("abort", () => resolve(), { once: true }));
  }
}

test("reload restarts flows within the stop grace even when a service settles late", async () => {
  SlowStopService.runs = 0;
  WaitTrigger.runs = 0;
  const catalog = fromMapping({
    triggers: [{ id: "watch", capability: "demo.wait" }],
    services: [{ id: "stubborn", capability: "demo.slowstop" }]
  });
  const { runtime } = await makeRuntime({
    catalog,
    reloadCatalog: async () => catalog,
    stopGraceMs: 200,
    register: (registry) => {
      registry.register("trigger", "demo.wait", WaitTrigger, "plugin-demo");
      registry.register("service", "demo.slowstop", SlowStopService, "plugin-demo");
    }
  });
  await runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(runtime.snapshot.activeServices.length, 1, "service runs before reload");
  assert.equal(WaitTrigger.runs, 1, "trigger runs before reload");

  const startedAt = Date.now();
  await runtime.reload();
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 900, "reload must not wait for the late service: " + elapsed + "ms");
  assert.equal(runtime.snapshot.running, true);
  assert.deepEqual(runtime.snapshot.activeServices, ["stubborn"], "service restarts after reload");
  assert.deepEqual(runtime.snapshot.triggers, ["watch"], "trigger restarts after reload");
  assert.equal(WaitTrigger.runs, 2, "trigger runs again after reload");
  assert.equal(SlowStopService.runs, 2, "service runs again after reload");

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.deepEqual(runtime.snapshot.activeServices, ["stubborn"], "late zombie cleanup must not drop the new instance");
  await runtime.stop();
});

class FakeSessionPool {
  private readonly statesMap = new Map<string, string>();
  private readonly listeners = new Set<(change: { name: string; previous: string; state: string; reason?: string }) => void>();

  constructor(initial: Record<string, string>) {
    for (const [name, state] of Object.entries(initial)) this.statesMap.set(name, state);
  }

  async ensure(): Promise<void> {}
  async closeAll(): Promise<void> {}

  state(name: string): string | undefined {
    return this.statesMap.get(name);
  }

  states(): { name: string; state: string; since: number; reason?: string; attempts: number }[] {
    return [...this.statesMap.entries()].map(([name, state]) => ({
      name,
      state,
      since: Date.now(),
      reason: "test",
      attempts: 0
    }));
  }

  access() {
    return {
      run: async (operation: (client: unknown) => unknown) => operation(undefined)
    };
  }

  subscribe(listener: (change: { name: string; previous: string; state: string; reason?: string }) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change: { name: string; previous: string; state: string; reason?: string }): void {
    this.statesMap.set(change.name, change.state);
    for (const listener of [...this.listeners]) listener(change);
  }
}

test("flows bound to a session suspend on isolation and resume on recovery", async () => {
  WaitTrigger.runs = 0;
  const sessions = new FakeSessionPool({ "acct-1": "connected" });
  const catalog = fromMapping({
    triggers: [{ id: "watch", capability: "demo.wait", session: "acct-1" }]
  });
  const { runtime, events } = await makeRuntime({
    catalog,
    sessions: sessions as unknown as SessionPool,
    register: (registry) => registry.register("trigger", "demo.wait", WaitTrigger, "plugin-demo")
  });
  await runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(WaitTrigger.runs, 1, "trigger runs while the session is connected");

  sessions.emit({ name: "acct-1", previous: "connected", state: "isolated", reason: "boom" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(WaitTrigger.runs, 1, "no new run while the session is isolated");

  const snapshot = runtime.snapshot as RuntimeSnapshot;
  const flow = snapshot.flows.find((item) => item.id === "watch");
  assert.ok(flow?.suspended, "flow snapshot must carry the suspension");
  assert.equal(snapshot.sessions[0]?.name, "acct-1");
  assert.equal(snapshot.sessions[0]?.flows.length, 1);

  sessions.emit({ name: "acct-1", previous: "isolated", state: "connected" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(WaitTrigger.runs, 2, "trigger restarts after session recovery");
  assert.ok(events.some((event) => event.type === "session.state"));
  assert.ok(events.some((event) => event.type === "flow.suspended"));
  assert.ok(events.some((event) => event.type === "flow.resumed"));
  await runtime.stop();
});