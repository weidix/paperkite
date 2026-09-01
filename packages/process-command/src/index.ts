import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Action, definePlugin, type PluginContext } from "@paperkite/sdk";

interface CommandConfig {
  readonly program?: string;
  readonly args?: readonly string[];
  readonly command?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly shell?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

class ProcessCommandAction extends Action<CommandConfig> {
  protected async run(): Promise<void> {
    const [program, args] = commandParts(this.payload);
    const shell = this.payload.shell === true;
    const timeoutMs = normalizeTimeout(this.payload.timeoutMs);
    const maxOutputBytes = normalizeOutputLimit(this.payload.maxOutputBytes);
    const child = shell && this.payload.command
      ? spawn(this.payload.command, {
          cwd: this.payload.cwd ? resolve(this.payload.cwd) : process.cwd(),
          env: { ...process.env, ...this.payload.env },
          shell: true,
          stdio: ["ignore", "pipe", "pipe"]
        })
      : spawn(program, args, {
          cwd: this.payload.cwd ? resolve(this.payload.cwd) : process.cwd(),
          env: { ...process.env, ...this.payload.env },
          shell,
          stdio: ["ignore", "pipe", "pipe"]
        });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendOutput(stdout, chunk, maxOutputBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendOutput(stderr, chunk, maxOutputBytes);
    });

    const result = await waitForProcess(child, timeoutMs, this.signal);
    if (result.error) throw result.error;
    if (result.timedOut) throw new Error(`command timed out after ${timeoutMs}ms: ${program}`);
    if (result.aborted) return;
    if (result.code !== 0) {
      throw new Error(`command exited with ${String(result.code)}: ${stderr.trim() || stdout.trim()}`);
    }
    this.context.logger.info("command completed", {
      program,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    });
  }
}

export const manifest = {
  name: "@paperkite/plugin-process-command",
  version: "0.1.0",
  capabilities: [{ kind: "action" as const, name: "system.command" }]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerAction("system.command", ProcessCommandAction);
}

export default definePlugin({ manifest, register });

function commandParts(config: CommandConfig): [string, string[]] {
  if (config.program?.trim()) return [config.program.trim(), [...(config.args ?? [])].map(String)];
  if (!config.command?.trim()) throw new Error("system.command needs program or command");
  const parts = tokenize(config.command);
  const program = parts.shift();
  if (!program) throw new Error("system.command command cannot be empty");
  return [program, parts];
}

function tokenize(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  for (const character of value.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
    } else if (character === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaping) current += "\\";
  if (quote) throw new Error("system.command has an unterminated quote");
  if (current) parts.push(current);
  return parts;
}

function appendOutput(current: string, chunk: string, limit: number): string {
  const result = current + chunk;
  if (Buffer.byteLength(result, "utf8") <= limit) return result;
  return Buffer.from(result, "utf8").subarray(0, limit).toString("utf8") + "…";
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = Number(value ?? 60_000);
  if (!Number.isFinite(timeout) || timeout <= 0) return 60_000;
  return Math.min(86_400_000, timeout);
}

function normalizeOutputLimit(value: number | undefined): number {
  const limit = Number(value ?? 64 * 1024);
  if (!Number.isFinite(limit) || limit <= 0) return 64 * 1024;
  return Math.min(10 * 1024 * 1024, Math.trunc(limit));
}

interface ProcessResult {
  readonly code: number | null;
  readonly error?: Error;
  readonly timedOut: boolean;
  readonly aborted: boolean;
}

async function waitForProcess(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const onAbort = (): void => {
      aborted = true;
      child.kill("SIGTERM");
    };
    const finish = (result: ProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    child.once("error", (error) => finish({ code: null, error, timedOut, aborted }));
    child.once("close", (code) => finish({ code, timedOut, aborted }));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
