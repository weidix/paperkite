import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeControl, RuntimeEvent, RuntimeEventListener, RuntimeLogger, ServiceContext } from "@paperkite/sdk";
import { createRuntimeConsoleServer } from "../packages/console-web/src/console/server.js";
import { RuntimeConsoleWebService } from "../packages/console-web/src/index.js";

const logger: RuntimeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return logger;
  }
};

const PLUGINS = [
  {
    name: "@paperkite/plugin-console-web",
    version: "0.1.0",
    capabilities: [{ kind: "service" as const, name: "runtime.console_web" }],
    loaded: true
  }
];

function stubRuntime(logs: RuntimeControl["snapshot"]["logs"] = []): {
  runtime: RuntimeControl;
  listeners: RuntimeEventListener[];
  calls: string[];
} {
  const listeners: RuntimeEventListener[] = [];
  const calls: string[] = [];
  const runtime: RuntimeControl = {
    snapshot: {
      running: true,
      pid: process.pid,
      uptimeSeconds: 12,
      triggers: ["watch.group"],
      services: ["console"],
      schedules: [],
      activeServices: ["console"],
      activeActions: [],
      flows: [
        {
          kind: "trigger",
          id: "watch.group",
          capability: "watch.group",
          enabled: true,
          active: true,
          session: "primary",
          logFile: false,
          config: { intervalSeconds: 60 },
          actions: [{ capability: "notifications.bark" }]
        }
      ],
      logs
    },
    async executeAction(spec) {
      calls.push("action:" + spec.capability);
    },
    async runFlow(id) {
      if (id === "nope") throw new Error("unknown flow: " + id);
      calls.push("flow:" + id);
    },
    async updateFlow(id, patch) {
      calls.push(`update:${id}:${String(patch.enabled)}`);
      return true;
    },
    async reloadFlow(id) {
      calls.push("reload:" + id);
      return true;
    },
    async startService(id) {
      calls.push("start:" + id);
    },
    async stopService(id) {
      calls.push("stop:" + id);
    },
    async reload() {
      calls.push("reload-runtime");
    },
    listPlugins() {
      return PLUGINS;
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }
  };
  return { runtime, listeners, calls };
}

test("runtime console exposes snapshot, plugins, and control operations", async () => {
  const { runtime, calls } = stubRuntime();
  const server = createRuntimeConsoleServer(runtime, { logger });
  try {
    const snapshot = await server.inject({ method: "GET", url: "/api/snapshot" });
    assert.equal(snapshot.statusCode, 200);
    assert.deepEqual(snapshot.json(), runtime.snapshot);

    const plugins = await server.inject({ method: "GET", url: "/api/plugins" });
    assert.equal(plugins.statusCode, 200);
    assert.deepEqual(plugins.json(), PLUGINS);

    const badRun = await server.inject({
      method: "POST",
      url: "/api/action/run",
      payload: { spec: {} }
    });
    assert.equal(badRun.statusCode, 422);
    assert.equal((badRun.json() as { error: string }).error, "action.run needs spec.capability");

    const run = await server.inject({
      method: "POST",
      url: "/api/action/run",
      payload: { spec: { capability: "notifications.bark" } }
    });
    assert.equal(run.statusCode, 200);

    const flowRun = await server.inject({ method: "POST", url: "/api/flows/archive-daily/run" });
    assert.equal(flowRun.statusCode, 200);

    const patch = await server.inject({
      method: "PATCH",
      url: "/api/flows/watch.group",
      payload: { enabled: false }
    });
    assert.equal(patch.statusCode, 200);
    assert.deepEqual(patch.json(), { ok: true, changed: true });

    const reload = await server.inject({ method: "POST", url: "/api/flows/watch.group/reload" });
    assert.equal(reload.statusCode, 200);

    const start = await server.inject({ method: "POST", url: "/api/services/console/start" });
    assert.equal(start.statusCode, 200);
    const stop = await server.inject({ method: "POST", url: "/api/services/console/stop" });
    assert.equal(stop.statusCode, 200);

    const runtimeReload = await server.inject({ method: "POST", url: "/api/runtime/reload" });
    assert.equal(runtimeReload.statusCode, 200);

    const unknown = await server.inject({ method: "POST", url: "/api/flows/nope/run" });
    assert.equal(unknown.statusCode, 500);
    assert.equal((unknown.json() as { error: string }).error, "unknown flow: nope");

    assert.deepEqual(calls, [
      "action:notifications.bark",
      "flow:archive-daily",
      "update:watch.group:false",
      "reload:watch.group",
      "start:console",
      "stop:console",
      "reload-runtime"
    ]);
  } finally {
    await server.close();
  }
});

test("runtime console tails log files that the snapshot indexes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-console-logs-"));
  const logFile = join(directory, "console.log");
  await writeFile(logFile, "line 1\nline 2\nline 3\n", "utf8");
  const { runtime } = stubRuntime([{ scope: "console", path: logFile }]);
  const server = createRuntimeConsoleServer(runtime, { logger });
  try {
    const scopes = await server.inject({ method: "GET", url: "/api/logs" });
    assert.equal(scopes.statusCode, 200);
    assert.deepEqual(scopes.json(), { scopes: [{ scope: "console", path: logFile }] });

    const tail = await server.inject({ method: "GET", url: "/api/logs/console?lines=2" });
    assert.equal(tail.statusCode, 200);
    assert.deepEqual(tail.json(), { scope: "console", path: logFile, lines: ["line 2", "line 3"] });

    const missing = await server.inject({ method: "GET", url: "/api/logs/other?lines=2" });
    assert.equal(missing.statusCode, 404);

    await unlink(logFile);
    const gone = await server.inject({ method: "GET", url: "/api/logs/console?lines=2" });
    assert.equal(gone.statusCode, 200);
    assert.deepEqual(gone.json(), { scope: "console", path: logFile, lines: [] });
  } finally {
    await server.close();
  }
});

test("runtime console accepts bodyless posts and normalizes parser errors", async () => {
  const { runtime } = stubRuntime();
  const server = createRuntimeConsoleServer(runtime, { logger });
  try {
    const start = await server.inject({ method: "POST", url: "/api/services/console/start" });
    assert.equal(start.statusCode, 200);

    const reload = await server.inject({ method: "POST", url: "/api/runtime/reload" });
    assert.equal(reload.statusCode, 200);

    const stale = await server.inject({
      method: "POST",
      url: "/api/services/console/start",
      headers: { "content-type": "application/json" },
      payload: ""
    });
    assert.equal(stale.statusCode, 400);
    assert.ok((stale.json() as { error: string }).error.length > 0);
    assert.equal((stale.json() as { error: string }).error, "Body cannot be empty when content-type is set to 'application/json'");
  } finally {
    await server.close();
  }
});

test("runtime console streams runtime events over SSE and unsubscribes on disconnect", async () => {
  const { runtime, listeners } = stubRuntime();
  const server = createRuntimeConsoleServer(runtime, { logger });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController();
  try {
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(listeners.length, 1);

    const reader = response.body?.getReader();
    assert.ok(reader);
    const event: RuntimeEvent = {
      type: "action.finished",
      id: "action:notifications.bark",
      capability: "notifications.bark",
      ok: true,
      skipped: false,
      durationMs: 42,
      at: "2026-09-02T00:00:00.000Z"
    };
    listeners[0]?.(event);

    const decoder = new TextDecoder();
    let buffer = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('"action.finished"')) break;
    }
    assert.ok(buffer.includes('"action.finished"'), buffer);
    assert.ok(buffer.includes('"notifications.bark"'), buffer);
  } finally {
    controller.abort();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    await server.close();
    assert.equal(listeners.length, 0);
  }
});

test("runtime console serves the SPA shell for direct deep links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-console-web-"));
  const publicDir = join(directory, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "index.html"), "<h1>运行时控制台</h1>");
  const port = await freePort();
  const controller = new AbortController();
  const context: ServiceContext<Record<string, unknown>> = {
    id: "console-web",
    capability: "runtime.console_web",
    payload: { host: "127.0.0.1", port, publicDir },
    signal: controller.signal,
    control: stubRuntime().runtime,
    logger
  };
  const service = new RuntimeConsoleWebService(context);
  const running = service.run();
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(base + "/api/plugins");
    const root = await (await fetch(base + "/")).text();
    assert.match(root, /运行时控制台/);

    const flows = await (await fetch(base + "/flows")).text();
    assert.match(flows, /运行时控制台/);
    const events = await (await fetch(base + "/events")).text();
    assert.match(events, /运行时控制台/);

    const unknown = await fetch(base + "/api/unknown");
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: "not found" });

    const post = await fetch(base + "/flows", { method: "POST" });
    assert.equal(post.status, 405);
  } finally {
    controller.abort();
    await running;
  }
});

async function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForHttp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 服务尚未就绪，继续等待
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("runtime console service did not become ready");
}