import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RuntimeLogger } from "@paperkite/sdk";

const levels = ["debug", "info", "warn", "error"] as const;
type Level = (typeof levels)[number];

export type LogEventSink = (entry: { scope: string; level: string; message: string }) => void;

export class AppLogger implements RuntimeLogger {
  private readonly threshold: number;
  private readonly children = new Map<string, AppLogger>();
  private sink: LogEventSink | undefined;

  constructor(
    private readonly level: string = "info",
    private readonly directory?: string,
    private readonly scope?: string
  ) {
    this.threshold = Math.max(0, levels.indexOf(normalizeLevel(level)));
  }

  child(scope: string): AppLogger {
    const existing = this.children.get(scope);
    if (existing) return existing;
    const child = new AppLogger(this.level, this.directory, scope);
    child.sink = this.sink;
    this.children.set(scope, child);
    return child;
  }

  attachLogSink(sink: LogEventSink): void {
    this.sink = sink;
    for (const child of this.children.values()) child.sink = sink;
  }

  registeredScopes(): readonly string[] {
    return [...this.children.keys()];
  }

  logDirectory(): string | undefined {
    return this.directory;
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
    if (this.directory) {
      void mkdir(this.directory, { recursive: true })
        .then(() =>
          appendFile(join(this.directory as string, basename(this.scope || "paperkite") + ".log"), line, "utf8")
        )
        .catch(() => undefined);
    }
    this.sink?.({ scope: this.scope || "paperkite", level, message: message + suffix });
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