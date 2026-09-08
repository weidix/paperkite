import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Action, type TriggerEmission } from "@paperkite/sdk";
import { register as registerAccountWatch } from "../packages/account-watch/src/index.js";
import { fromMapping } from "../src/config/loader.js";
import { CapabilityRegistry } from "../src/extensions/registry.js";
import { AppLogger } from "../src/engine/logger.js";
import { Runtime } from "../src/engine/runtime.js";
import type { SessionPool } from "../src/telegram/pool.js";

class CaptureAction extends Action {
  static emissions: TriggerEmission[] = [];

  protected async run(): Promise<void> {
    if (this.emission) CaptureAction.emissions.push(this.emission);
  }
}

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

  states() {
    return [...this.statesMap.entries()].map(([name, state]) => ({
      name,
      state,
      since: Date.now(),
      reason: state === "connected" ? undefined : "test",
      attempts: 0
    }));
  }

  access() {
    return { run: async (operation: (client: unknown) => unknown) => operation(undefined) };
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

async function makeWatcherRuntime(
  config: Record<string, unknown>
): Promise<{ runtime: Runtime; sessions: FakeSessionPool }> {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-account-watch-"));
  const logger = new AppLogger("info", join(directory, "logs"));
  const registry = new CapabilityRegistry();
  await registerAccountWatch(registry.context(logger, "@paperkite/plugin-account-watch"));
  registry.register("action", "demo.capture", CaptureAction, "plugin-demo");
  const sessions = new FakeSessionPool({ "acct-1": "isolated", "acct-2": "connected" });
  const catalog = fromMapping({
    triggers: [{ id: "account-health", capability: "watch.session", config, actions: [{ capability: "demo.capture" }] }]
  });
  const runtime = new Runtime({
    catalog,
    registry,
    sessions: sessions as unknown as SessionPool,
    logger,
    installed: [],
    reloadCatalog: async () => catalog
  });
  CaptureAction.emissions = [];
  await runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { runtime, sessions };
}

test("watch.session alerts bad sessions from the snapshot and follows state events without a bound session", async () => {
  const { runtime, sessions } = await makeWatcherRuntime({});
  assert.deepEqual(
    CaptureAction.emissions.map((entry) => entry.event),
    [{ session: "acct-1", state: "isolated", reason: "test" }],
    "only the bad session alerts at startup, healthy and transient states stay silent"
  );

  sessions.emit({ name: "acct-2", previous: "connected", state: "waiting-auth", reason: "revoked" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(
    CaptureAction.emissions.map((entry) => entry.event).slice(1),
    [{ session: "acct-2", state: "waiting-auth", reason: "revoked" }],
    "state transitions notify through the runtime event stream"
  );
  assert.equal(
    runtime.snapshot.flows.find((item) => item.id === "account-health")?.suspended,
    undefined,
    "an unbound watcher never suspends while its sessions are down"
  );

  await runtime.stop();
});

test("watch.session recovery alerts are opt-in and the watcher restarts on reload", async () => {
  const { runtime, sessions } = await makeWatcherRuntime({ notifyOnRecovery: true });
  sessions.emit({ name: "acct-1", previous: "isolated", state: "connected" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(CaptureAction.emissions.map((entry) => entry.event), [
    { session: "acct-1", state: "isolated", reason: "test" },
    { session: "acct-1", state: "connected", reason: undefined }
  ]);

  sessions.emit({ name: "acct-2", previous: "connected", state: "isolated", reason: "flood" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await runtime.reload();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(runtime.snapshot.triggers, ["account-health"], "watcher restarts after reload");
  assert.deepEqual(
    CaptureAction.emissions.map((entry) => entry.event).slice(-2),
    [
      { session: "acct-2", state: "isolated", reason: "flood" },
      { session: "acct-2", state: "isolated", reason: "test" }
    ],
    "the restarted watcher re-reads the snapshot for still-bad sessions"
  );
  await runtime.stop();
});