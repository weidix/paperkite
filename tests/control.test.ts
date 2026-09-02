import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestControl, startControlServer, type RuntimeControl } from "../src/control/socket.js";

const EMPTY_SNAPSHOT = {
  running: false,
  pid: process.pid,
  uptimeSeconds: 0,
  triggers: [],
  services: ["console"],
  schedules: [],
  activeServices: [],
  activeActions: [],
  flows: [],
  logs: []
};

test("local control socket dispatches runtime, flow, and action operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-control-"));
  const path = join(directory, "control.sock");
  const calls: string[] = [];
  const runtime: RuntimeControl = {
    snapshot: EMPTY_SNAPSHOT,
    async executeAction(spec) { calls.push("action:" + spec.capability); },
    async runFlow(id) { calls.push("flow:" + id); },
    async updateFlow(id, patch) { calls.push(`update:${id}:${String(patch.enabled)}`); return true; },
    async reloadFlow(id) { calls.push("reload:" + id); return true; },
    async startService(id) { calls.push("start:" + id); },
    async stopService(id) { calls.push("stop:" + id); },
    async reload() { calls.push("reload"); },
    listPlugins() {
      calls.push("plugins");
      return [
        {
          name: "@paperkite/plugin-bark",
          version: "1.0.0",
          capabilities: [{ kind: "action", name: "notifications.bark" }],
          loaded: true
        }
      ];
    },
    subscribe() { return () => undefined; }
  };
  const server = await startControlServer(runtime, path);
  assert.deepEqual(await requestControl({ action: "snapshot" }, path), runtime.snapshot);
  assert.equal(await requestControl({ action: "flow.update", id: "watch", patch: { enabled: false } }, path), true);
  assert.equal(await requestControl({ action: "flow.reload", id: "console" }, path), true);
  assert.equal(await requestControl({ action: "runtime.reload" }, path), true);
  assert.equal(await requestControl({ action: "flow.run", id: "archive-daily" }, path), true);
  assert.equal(await requestControl({ action: "action.run", spec: { capability: "notifications.bark" } }, path), true);
  assert.deepEqual(await requestControl({ action: "plugins" }, path), [
    {
      name: "@paperkite/plugin-bark",
      version: "1.0.0",
      capabilities: [{ kind: "action", name: "notifications.bark" }],
      loaded: true
    }
  ]);
  assert.deepEqual(calls, [
    "update:watch:false",
    "reload:console",
    "reload",
    "flow:archive-daily",
    "action:notifications.bark",
    "plugins"
  ]);
  await server.close();
});