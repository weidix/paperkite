import { chmod, mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { ActionSpecInput, RuntimeControl } from "@paperkite/sdk";
import type { Runtime } from "../engine/runtime.js";

export type { RuntimeControl };

interface ControlRequest {
  readonly action?: string;
  readonly id?: string;
  readonly enabled?: boolean;
  readonly payload?: unknown;
  readonly spec?: ActionSpecInput;
}

export interface ControlServer {
  close(): Promise<void>;
}

export function controlPath(): string {
  if (process.platform === "win32") return "\\\\.\\pipe\\paperkite-control";
  const home = process.env.PAPERKITE_HOME?.trim();
  return home ? resolve(home, "control.sock") : "data/.paperkite/control.sock";
}

export async function startControlServer(runtime: RuntimeControl, path = controlPath()): Promise<ControlServer> {
  if (process.platform !== "win32") {
    await mkdir(dirname(path), { recursive: true });
    await unlink(path).catch(() => undefined);
  }
  const server = createServer((socket) => handleConnection(socket, runtime));
  await listen(server, path);
  if (process.platform !== "win32") await chmod(path, 0o600).catch(() => undefined);
  return {
    close: async () => {
      server.close();
      await unlink(path).catch(() => undefined);
    }
  };
}

export async function requestControl<T = unknown>(
  request: ControlRequest,
  path = controlPath(),
  timeoutMs = 3_000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = createConnection(path);
    const input = createInterface({ input: socket, crlfDelay: Infinity });
    const timer = setTimeout(() => {
      socket.destroy(new Error("control request timed out"));
    }, timeoutMs);
    let settled = false;
    const finish = (error: Error | undefined, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.close();
      socket.destroy();
      if (error) reject(error);
      else resolve(value as T);
    };
    socket.once("error", (error) => finish(error));
    socket.once("connect", () => socket.write(JSON.stringify(request) + "\n"));
    input.once("line", (line) => {
      try {
        const response = JSON.parse(line) as { ok?: boolean; result?: T; error?: string };
        if (response.ok) finish(undefined, response.result);
        else finish(new Error(response.error || "control request failed"));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function handleConnection(socket: Socket, runtime: RuntimeControl): Promise<void> {
  const input = createInterface({ input: socket, crlfDelay: Infinity });
  for await (const line of input) {
    let response: { ok: boolean; result?: unknown; error?: string };
    try {
      response = { ok: true, result: await dispatch(runtime, JSON.parse(line) as ControlRequest) };
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    socket.write(JSON.stringify(response) + "\n");
  }
  socket.end();
}

async function dispatch(runtime: RuntimeControl, request: ControlRequest): Promise<unknown> {
  const action = request.action;
  if (action === "snapshot") return runtime.snapshot;
  if (action === "runtime.reload") {
    await runtime.reload();
    return true;
  }
  if (action === "action.run") {
    if (!request.spec) throw new Error("action.run needs spec");
    await runtime.executeAction(request.spec);
    return true;
  }
  if (!request.id) throw new Error("control request needs id");
  if (action === "command.run") {
    await runtime.runCommand(request.id, request.payload);
    return true;
  }
  if (action === "flow.run") {
    await runtime.runFlow(request.id);
    return true;
  }
  if (action === "service.start") {
    await runtime.startService(request.id);
    return true;
  }
  if (action === "service.stop") {
    await runtime.stopService(request.id);
    return true;
  }
  if (action === "service.restart") {
    await runtime.restartService(request.id);
    return true;
  }
  if (action === "flow.enabled") {
    if (request.enabled === undefined) throw new Error("flow.enabled needs enabled");
    return runtime.setFlowEnabled(request.id, request.enabled);
  }
  throw new Error("unknown control action: " + String(action));
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
}