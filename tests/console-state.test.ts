import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ConfigValidator,
  RuntimeEvent,
  ServiceHandler,
  TriggerContext,
  TriggerHandler
} from "@paperkite/sdk";
import { fromMapping, loadCatalog } from "../src/config/loader.js";
import type { FlowCatalog } from "../src/config/model.js";
import { CapabilityRegistry } from "../src/extensions/registry.js";
import { AppLogger } from "../src/engine/logger.js";
import { Runtime } from "../src/engine/runtime.js";
import type { SessionPool } from "../src/telegram/pool.js";

const fakeSessions = {
  ensure: async () => undefined,
  access: () => ({ run: async (operation: (client: unknown) => unknown) => operation(undefined) }),
  closeAll: async () => undefined,
  subscribe: () => () => undefined,
  state: () => undefined,
  states: () => []
} as unknown as SessionPool;

const JOIN_FAILURE = "未加入群 abcd1234，请先通过链接加入该群";
const MISSING_CHAT = "无法解析的聊天引用 ，请使用群数字 ID、@用户名或邀请链接";

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

class WaitTrigger implements TriggerHandler {
  static runs = 0;

  async run(ctx: TriggerContext): Promise<void> {
    WaitTrigger.runs += 1;
    await waitForAbort(ctx.signal);
  }
}

class FailingTrigger implements TriggerHandler {
  async run(): Promise<void> {
    throw new Error(JOIN_FAILURE);
  }
}

class FlakyTrigger implements TriggerHandler<{ healthy?: boolean }> {
  async run(ctx: TriggerContext<{ healthy?: boolean }>): Promise<void> {
    if (ctx.config?.healthy !== true) throw new Error(JOIN_FAILURE);
    await waitForAbort(ctx.signal);
  }
}

class AbortRejectingTrigger implements TriggerHandler {
  async run(ctx: TriggerContext): Promise<void> {
    await waitForAbort(ctx.signal);
    throw new Error("session closed while stopping");
  }
}

class OnceTrigger implements TriggerHandler<{ emit?: boolean }> {
  async run(ctx: TriggerContext<{ emit?: boolean }>): Promise<void> {
    if (ctx.config?.emit !== false) await ctx.emit?.({ text: "once" });
    await waitForAbort(ctx.signal);
  }
}

class FailingService implements ServiceHandler {
  async run(): Promise<void> {
    throw new Error("console port is taken");
  }
}

function makeRuntime(
  catalog: FlowCatalog,
  options: { reloadCatalog?: () => Promise<FlowCatalog>; validator?: ConfigValidator } = {}
): { runtime: Runtime; events: RuntimeEvent[] } {
  const registry = new CapabilityRegistry();
  registry.register("trigger", "demo.wait", WaitTrigger, "plugin-demo");
  registry.register("trigger", "demo.fail", FailingTrigger, "plugin-demo");
  registry.register("trigger", "demo.flaky", FlakyTrigger, "plugin-demo");
  registry.register("trigger", "demo.rejecting", AbortRejectingTrigger, "plugin-demo");
  registry.register("trigger", "demo.once", OnceTrigger, "plugin-demo");
  registry.register("service", "demo.broken", FailingService, "plugin-demo");
  if (options.validator) {
    registry.register("trigger", "demo.checked", WaitTrigger, "plugin-demo", { validateConfig: options.validator });
  }
  const runtime = new Runtime({
    catalog,
    registry,
    sessions: fakeSessions,
    logger: new AppLogger("info", join(tmpdir(), "paperkite-console-state-logs")),
    installed: [],
    reloadCatalog: options.reloadCatalog
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  return { runtime, events };
}

async function tempCatalog(
  flows: string
): Promise<{ catalog: FlowCatalog; directory: string; flowsFile: string; reloadCatalog: () => Promise<FlowCatalog> }> {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-console-state-"));
  const flowsFile = join(directory, "flows.yml");
  await writeFile(flowsFile, flows);
  return { catalog: await loadCatalog(flowsFile), directory, flowsFile, reloadCatalog: () => loadCatalog(flowsFile) };
}

function triggerFlow(id: string, capability: string, extra: readonly string[] = []): string {
  return [`  - id: ${id}`, `    capability: ${capability}`, "    config: {}", ...extra].join("\n");
}

function snapshotOf(runtime: Runtime, id: string) {
  return runtime.snapshot.flows.find((flow) => flow.id === id);
}

test("configDirty follows external edits, reloads, and console writes", async () => {
  const temp = await tempCatalog(["triggers:", triggerFlow("watch", "demo.wait"), ""].join("\n"));
  const { runtime } = makeRuntime(temp.catalog, { reloadCatalog: temp.reloadCatalog });
  try {
    assert.equal(runtime.snapshot.configDirty, false, "a fresh load matches the file");
    assert.equal(runtime.snapshot.flowsFile, temp.flowsFile);

    await writeFile(temp.flowsFile, ["triggers:", triggerFlow("watch", "demo.wait", ["    logFile: true"]), ""].join("\n"));
    assert.equal(runtime.snapshot.configDirty, true, "an external edit marks the config dirty");

    await runtime.reload();
    assert.equal(runtime.snapshot.configDirty, false, "a reload re-establishes the baseline");

    assert.equal(await runtime.updateFlow("watch", { config: { mark: 2 } }), true);
    assert.equal(runtime.snapshot.configDirty, false, "a console write keeps the baseline current");
  } finally {
    await runtime.stop();
    await rm(temp.directory, { recursive: true, force: true });
  }
});

test("updateFlow marks a run-backed flow pending until it restarts", async () => {
  const temp = await tempCatalog(
    [
      "triggers:",
      triggerFlow("watch", "demo.wait"),
      "commands:",
      "  - id: ping",
      "    title: ping",
      "    run: { capability: demo.wait }",
      ""
    ].join("\n")
  );
  const { runtime } = makeRuntime(temp.catalog, { reloadCatalog: temp.reloadCatalog });
  try {
    await runtime.updateFlow("watch", { maxRuns: 3 });
    assert.equal(snapshotOf(runtime, "watch")?.pendingReload, true, "a saved trigger waits for a reload");
    await runtime.reloadFlow("watch");
    assert.equal(snapshotOf(runtime, "watch")?.pendingReload, false, "a single reload clears the mark");

    await runtime.updateFlow("watch", { maxRuns: 4 });
    await runtime.reload();
    assert.equal(snapshotOf(runtime, "watch")?.pendingReload, false, "a full reload clears the mark");

    await runtime.updateFlow("ping", { title: "ping-2" });
    assert.equal(snapshotOf(runtime, "ping")?.pendingReload, false, "commands hold no run instance");
  } finally {
    await runtime.stop();
    await rm(temp.directory, { recursive: true, force: true });
  }
});

test("a capability validator surfaces as flow warnings", async () => {
  const validator: ConfigValidator = (config) =>
    config && typeof config === "object" && "chats" in config ? [] : [MISSING_CHAT];
  const { runtime } = makeRuntime(
    fromMapping({ triggers: [{ id: "watch", capability: "demo.checked", config: {} }] }),
    { validator }
  );
  try {
    assert.deepEqual(snapshotOf(runtime, "watch")?.warnings, [MISSING_CHAT]);
  } finally {
    await runtime.stop();
  }
});

test("a failed trigger start annotates lastStop and emits trigger.stopped", async () => {
  const { runtime, events } = makeRuntime(fromMapping({ triggers: [{ id: "watch", capability: "demo.fail" }] }));
  try {
    await runtime.start();
    assert.ok(await waitFor(() => snapshotOf(runtime, "watch")?.lastStop !== undefined, 3_000));

    const flow = snapshotOf(runtime, "watch");
    assert.equal(flow?.enabled, true, "a failed start stays enabled");
    assert.equal(flow?.active, false, "a failed start holds no run instance");
    assert.equal(flow?.lastStop?.reason, "error");
    assert.equal(flow?.lastStop?.error, JOIN_FAILURE);

    const stopped = events.find((event) => event.type === "trigger.stopped");
    assert.equal(stopped?.type === "trigger.stopped" ? stopped.reason : undefined, "error");
    assert.equal(stopped?.type === "trigger.stopped" ? stopped.error : undefined, JOIN_FAILURE);
  } finally {
    await runtime.stop();
  }
});

test("a failing autostart service annotates lastStop with the same vocabulary", async () => {
  const { runtime, events } = makeRuntime(fromMapping({ services: [{ id: "console", capability: "demo.broken" }] }));
  try {
    await runtime.start();
    assert.ok(await waitFor(() => snapshotOf(runtime, "console")?.lastStop !== undefined, 3_000));

    const flow = snapshotOf(runtime, "console");
    assert.equal(flow?.enabled, true);
    assert.equal(flow?.lastStop?.reason, "error");
    assert.equal(flow?.lastStop?.error, "console port is taken");
    assert.equal(
      events.some((event) => event.type === "service.stopped" && event.reason === "error"),
      true
    );
  } finally {
    await runtime.stop();
  }
});

test("a successful restart clears the previous failure annotation", async () => {
  const temp = await tempCatalog(["triggers:", triggerFlow("watch", "demo.flaky"), ""].join("\n"));
  const { runtime } = makeRuntime(temp.catalog, { reloadCatalog: temp.reloadCatalog });
  try {
    await runtime.start();
    assert.ok(await waitFor(() => snapshotOf(runtime, "watch")?.lastStop !== undefined, 3_000));

    await runtime.updateFlow("watch", { config: { healthy: true } });
    await runtime.reloadFlow("watch");
    const recovered = snapshotOf(runtime, "watch");
    assert.equal(recovered?.active, true, "the trigger restarts");
    assert.equal(recovered?.lastStop, undefined, "a successful restart drops the annotation");
  } finally {
    await runtime.stop();
    await rm(temp.directory, { recursive: true, force: true });
  }
});

test("operator stops leave no failure annotation", async () => {
  WaitTrigger.runs = 0;
  const { runtime } = makeRuntime(fromMapping({ triggers: [{ id: "watch", capability: "demo.wait" }] }));
  try {
    await runtime.start();
    assert.equal(WaitTrigger.runs, 1, "the trigger starts");

    await runtime.reloadFlow("watch");
    const flow = snapshotOf(runtime, "watch");
    assert.equal(flow?.active, true, "the trigger restarts on reload");
    assert.equal(flow?.lastStop, undefined, "an operator stop records no annotation");
  } finally {
    await runtime.stop();
  }
});

test("a plugin rejecting on abort is not reported as a start failure", async () => {
  const temp = await tempCatalog(["triggers:", triggerFlow("watch", "demo.rejecting"), ""].join("\n"));
  const { runtime, events } = makeRuntime(temp.catalog, { reloadCatalog: temp.reloadCatalog });
  try {
    await runtime.start();
    await runtime.updateFlow("watch", { enabled: false });
    await runtime.reloadFlow("watch");

    const flow = snapshotOf(runtime, "watch");
    assert.equal(flow?.enabled, false);
    assert.equal(flow?.lastStop, undefined, "an aborted plugin must not report a start failure");
    assert.equal(
      events.some((event) => event.type === "trigger.stopped" && event.reason === "stop"),
      true
    );
  } finally {
    await runtime.stop();
    await rm(temp.directory, { recursive: true, force: true });
  }
});

test("a full reload clears the annotation of an idle manual service", async () => {
  const temp = await tempCatalog(
    ["services:", "  - id: console", "    capability: demo.broken", "    autoStart: false", ""].join("\n")
  );
  const { runtime } = makeRuntime(temp.catalog, { reloadCatalog: temp.reloadCatalog });
  try {
    await runtime.start();
    await runtime.startService("console");
    assert.ok(await waitFor(() => snapshotOf(runtime, "console")?.lastStop !== undefined, 3_000));

    await runtime.reload();
    const reloaded = snapshotOf(runtime, "console");
    assert.equal(reloaded?.active, false, "an idle manual service stays stopped");
    assert.equal(reloaded?.lastStop, undefined, "a full reload clears the stale annotation");
  } finally {
    await runtime.stop();
    await rm(temp.directory, { recursive: true, force: true });
  }
});

test("exhausting maxRuns disables the trigger in memory without touching the file", async () => {
  const body = (emit: boolean): string =>
    [
      "triggers:",
      "  - id: once",
      "    capability: demo.once",
      `    config: { emit: ${emit} }`,
      "    maxRuns: 1",
      ""
    ].join("\n");
  const temp = await tempCatalog(body(true));
  const { runtime, events } = makeRuntime(temp.catalog, { reloadCatalog: temp.reloadCatalog });
  try {
    await runtime.start();
    assert.ok(await waitFor(() => snapshotOf(runtime, "once")?.enabled === false, 3_000), "the quota stops the trigger");

    const flow = snapshotOf(runtime, "once");
    assert.equal(flow?.lastStop?.reason, "maxruns");
    assert.equal(runtime.snapshot.configDirty, false, "the in-memory disable is not a file change");
    assert.equal(
      events.some((event) => event.type === "trigger.stopped" && event.reason === "maxruns"),
      true
    );

    await runtime.reloadFlow("once");
    assert.equal(snapshotOf(runtime, "once")?.enabled, false, "a single reload keeps it disabled");

    await writeFile(temp.flowsFile, body(false));
    await runtime.reload();
    const restored = snapshotOf(runtime, "once");
    assert.equal(restored?.enabled, true, "a full reload restores the flow from disk");
    assert.equal(restored?.lastStop, undefined, "the quota annotation is cleared");
  } finally {
    await runtime.stop();
    await rm(temp.directory, { recursive: true, force: true });
  }
});
