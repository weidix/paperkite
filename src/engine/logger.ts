import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RuntimeLogger } from "@paperkite/sdk";

const levels = ["debug", "info", "warn", "error"] as const;
type Level = (typeof levels)[number];

class LogSink {
  private readonly tails = new Map<string, Promise<void>>();
  private ready: Promise<void> | undefined;

  constructor(readonly directory: string) {}

  write(scope: string, line: string): void {
    const previous = this.tails.get(scope) ?? Promise.resolve();
    const next = previous.then(() => this.append(scope, line)).catch(() => undefined);
    this.tails.set(scope, next);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }

  private async append(scope: string, line: string): Promise<void> {
    this.ready ??= mkdir(this.directory, { recursive: true }).then(() => undefined, () => undefined);
    await this.ready;
    await appendFile(join(this.directory, basename(scope) + ".log"), line, "utf8");
  }
}

export class AppLogger implements RuntimeLogger {
  private readonly threshold: number;
  private readonly children = new Map<string, AppLogger>();
  private readonly sink: LogSink | undefined;

  constructor(
    private readonly level: string = "info",
    directory?: string,
    private readonly scope?: string,
    sink?: LogSink
  ) {
    this.threshold = Math.max(0, levels.indexOf(normalizeLevel(level)));
    this.sink = directory ? (sink ?? new LogSink(directory)) : sink;
  }

  child(scope: string): AppLogger {
    const existing = this.children.get(scope);
    if (existing) return existing;
    const child = new AppLogger(this.level, undefined, scope, this.sink);
    this.children.set(scope, child);
    return child;
  }

  registeredScopes(): readonly string[] {
    return [...this.children.keys()];
  }

  logDirectory(): string | undefined {
    return this.sink?.directory;
  }

  async flush(): Promise<void> {
    await this.sink?.flush();
  }

  debug(message: string, ...values: unknown[]): void {
    this.write("debug", message, values);
  }

  info(message: string, ...values: unknown[]): void {
    this.write("info", message, values);
  }

  warn(message: string, ...values: unknown[]): void {
    this.write("warn", message, values);
  }

  error(message: string, ...values: unknown[]): void {
    this.write("error", message, values);
  }

  private write(level: Level, message: string, values: readonly unknown[]): void {
    if (levels.indexOf(level) < this.threshold) return;
    const suffix = values.length ? " " + values.map(formatValue).join(" ") : "";
    const line =
      new Date().toISOString() +
      " " +
      level.toUpperCase() +
      (this.scope ? " [" + this.scope + "]" : "") +
      " " +
      message +
      suffix +
      "\n";
    process.stderr.write(line);
    this.sink?.write(this.scope || "paperkite", line);
  }
}

function normalizeLevel(value: string): Level {
  const lowered = value.toLowerCase() as Level;
  return levels.includes(lowered) ? lowered : "info";
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
