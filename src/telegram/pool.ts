import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Logger as GramLogger, LogLevel } from "telegram/extensions/Logger.js";
import { Api } from "telegram/tl/api.js";
import {
  SessionUnavailableError,
  type RuntimeLogger,
  type SessionAccess,
  type SessionLoginReply,
  type SessionState,
  type Unsubscribe
} from "@paperkite/sdk";
import type { AppSettings } from "../config/settings.js";
import { classifySessionFailure } from "./failure.js";

export interface SessionClient {
  readonly connected?: boolean;
  start(options: {
    phoneNumber: () => Promise<string>;
    phoneCode: () => Promise<string>;
    password: () => Promise<string>;
    onError: (error: unknown) => void;
  }): Promise<unknown>;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  getMe(): Promise<unknown>;
  session: { save(): string };
  [key: string]: unknown;
}

export interface SessionStateInfo {
  readonly name: string;
  readonly state: SessionState;
  readonly since: number;
  readonly reason?: string;
  readonly attempts: number;
}

export interface SessionStateChange {
  readonly name: string;
  readonly previous: SessionState;
  readonly state: SessionState;
  readonly reason?: string;
}

export type SessionStateListener = (change: SessionStateChange) => void;

type LoginPromptKind = "phone" | "code" | "password";

interface Health {
  state: SessionState;
  since: number;
  reason?: string;
  attempts: number;
  faultsWindowStart: number;
  faults: number;
}

interface Entry {
  readonly name: string;
  client?: SessionClient;
  ready: Promise<void>;
  readyResolve?: () => void;
  tail: Promise<void>;
  health: Health;
  timer?: NodeJS.Timeout;
  login?: LoginFlow;
}

interface LoginFlow {
  ask?: { kind: LoginPromptKind; resolve: (value: string) => void; timer: NodeJS.Timeout };
  result?: { ok: boolean; error?: string };
}

interface GuardSettings {
  windowMs: number;
  threshold: number;
  backoffMinMs: number;
  backoffMaxMs: number;
}

const DEFAULT_GUARD: GuardSettings = { windowMs: 60_000, threshold: 5, backoffMinMs: 30_000, backoffMaxMs: 30 * 60_000 };
const LOGIN_INPUT_TIMEOUT_MS = 180_000;

export class SessionPool {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<SessionStateListener>();
  private readonly guard: GuardSettings;
  private closed = false;

  constructor(
    private readonly settings: AppSettings,
    private readonly logger: RuntimeLogger,
    private readonly createClient: (session: string, content: string) => SessionClient = createGramClient
  ) {
    const configured = settings.telegram.sessionGuard;
    this.guard = configured
      ? {
          windowMs: configured.windowMs,
          threshold: configured.threshold,
          backoffMinMs: configured.backoffMinMs,
          backoffMaxMs: configured.backoffMaxMs
        }
      : DEFAULT_GUARD;
  }

  subscribe(listener: SessionStateListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ensure(names: Iterable<string>): Promise<void> {
    const pending: Entry[] = [];
    for (const name of new Set([...names].map((value) => normalizeSessionName(value)))) {
      const existing = this.entries.get(name);
      if (!existing) {
        const created = this.createEntry(name);
        void this.attempt(created, "auto");
        pending.push(created);
      } else if (existing.health.state === "starting") {
        pending.push(existing);
      }
    }
    await Promise.all(pending.map((entry) => entry.ready));
  }

  access(name?: string): SessionAccess | undefined {
    if (name === undefined) return undefined;
    return { run: (operation) => this.run(name, operation) };
  }

  state(name: string): SessionState | undefined {
    return this.entries.get(normalizeSessionName(name))?.health.state;
  }

  states(): SessionStateInfo[] {
    return [...this.entries.values()].map((entry) => ({
      name: entry.name,
      state: entry.health.state,
      since: entry.health.since,
      reason: entry.health.reason,
      attempts: entry.health.attempts
    }));
  }

  async run<T>(name: string, operation: (client: SessionClient) => T | Promise<T>): Promise<T> {
    const entry = this.entries.get(normalizeSessionName(name));
    if (!entry) throw new Error("session is not initialized: " + name);
    if (entry.health.state === "starting") await entry.ready;
    if (entry.health.state !== "connected") throw this.unavailable(entry);
    const previous = entry.tail;
    let resolveTail: (() => void) | undefined;
    entry.tail = new Promise<void>((resolvePromise) => {
      resolveTail = resolvePromise;
    });
    await previous;
    if (entry.health.state !== "connected" || !entry.client) {
      resolveTail?.();
      throw this.unavailable(entry);
    }
    try {
      const value = await operation(entry.client);
      this.noteSuccess(entry);
      return value;
    } catch (error) {
      this.noteFailure(entry, error);
      throw error;
    } finally {
      resolveTail?.();
    }
  }

  async reconnectSession(name: string): Promise<void> {
    const entry = this.entries.get(normalizeSessionName(name));
    if (!entry) throw new Error("unknown session: " + name);
    if (entry.health.state === "starting" || entry.health.state === "connected") return;
    await this.attempt(entry, "auto");
  }

  async beginSessionLogin(name: string): Promise<SessionLoginReply> {
    const entry = this.entries.get(normalizeSessionName(name));
    if (!entry) throw new Error("unknown session: " + name);
    if (entry.health.state === "connected") return { status: "ok" };
    if (entry.health.state === "starting") {
      return { status: "error", message: "a session attempt is already in progress" };
    }
    if (entry.login && entry.login.ask === undefined && entry.login.result === undefined) {
      return { status: "error", message: "a login flow is already in progress" };
    }
    if (this.closed) return { status: "error", message: "runtime is stopping" };
    entry.login = { result: undefined };
    await this.attempt(entry, "login");
    return this.awaitLogin(entry);
  }

  async submitSessionLogin(name: string, value: string): Promise<SessionLoginReply> {
    const entry = this.entries.get(normalizeSessionName(name));
    if (!entry) throw new Error("unknown session: " + name);
    const flow = entry.login;
    const ask = flow?.ask;
    if (!flow || !ask) return { status: "error", message: "no login flow is waiting for input" };
    clearTimeout(ask.timer);
    flow.ask = undefined;
    ask.resolve(value);
    return this.awaitLogin(entry);
  }

  async closeAll(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer);
      await entry.ready.catch(() => undefined);
      await entry.tail;
      await this.disposeClient(entry);
    }
    this.listeners.clear();
  }

  private createEntry(name: string): Entry {
    const health: Health = {
      state: "isolated",
      since: Date.now(),
      reason: "starting",
      attempts: 0,
      faultsWindowStart: Date.now(),
      faults: 0
    };
    const entry: Entry = { name, ready: Promise.resolve(), tail: Promise.resolve(), health };
    this.entries.set(name, entry);
    return entry;
  }

  private async attempt(entry: Entry, mode: "auto" | "login"): Promise<void> {
    if (this.closed) return;
    if (entry.health.state === "starting") {
      await entry.ready.catch(() => undefined);
      return;
    }
    if (entry.health.state === "connected") return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    if (entry.health.state === "isolated") entry.health.attempts = mode === "login" ? 0 : entry.health.attempts;
    entry.health.reason = mode === "login" ? "re-login in progress" : "connecting";
    entry.health.state = "starting";
    entry.ready = new Promise<void>((resolvePromise) => {
      entry.readyResolve = resolvePromise;
    });
    try {
      const outcome = await this.performAttempt(entry, mode);
      if (this.closed) return;
      if (outcome.ok) {
        await this.saveSession(entry);
        this.transition(entry, "connected");
        return;
      }
      this.failAttempt(entry, outcome.error, mode, outcome.hadContent);
    } finally {
      entry.readyResolve?.();
      entry.readyResolve = undefined;
    }
  }

  private async performAttempt(
    entry: Entry,
    mode: "auto" | "login"
  ): Promise<{ ok: boolean; error?: unknown; hadContent: boolean }> {
    await this.disposeClient(entry);
    const content = await readSessionFile(this.settings.telegram.sessionsDir, entry.name).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error))
    );
    if (content instanceof Error) return { ok: false, error: content, hadContent: false };
    const hadContent = Boolean(content);
    try {
      if (mode === "login" || !content) {
        if (!entry.client) entry.client = this.createClient(entry.name, content);
        await this.runLogin(entry, mode === "login" ? this.askOverControl(entry) : this.askOverStdin(entry.name));
        return { ok: true, hadContent };
      }
      const client = this.createClient(entry.name, content);
      entry.client = client;
      await client.connect();
      await this.checkAuthorized(client);
      return { ok: true, hadContent };
    } catch (error) {
      if (mode === "login" && entry.login && entry.login.result === undefined) {
        entry.login.result = { ok: false, error: messageOf(error) };
      }
      return { ok: false, error, hadContent };
    }
  }

  private failAttempt(entry: Entry, error: unknown, mode: "auto" | "login", hadContent: boolean): void {
    const message = messageOf(error);
    const kind = classifySessionFailure(error);
    if (mode === "login" || kind === "auth" || !hadContent) {
      this.transition(entry, "waiting-auth", message || "session login is required");
      return;
    }
    entry.health.attempts += 1;
    this.transition(entry, "isolated", message);
    this.scheduleBackoff(entry);
  }

  private scheduleBackoff(entry: Entry): void {
    if (this.closed || entry.health.state !== "isolated") return;
    const delay = Math.min(this.guard.backoffMaxMs, this.guard.backoffMinMs * 2 ** Math.max(0, entry.health.attempts - 1));
    const timer = setTimeout(() => void this.attempt(entry, "auto"), delay);
    timer.unref?.();
    entry.timer = timer;
  }

  private noteFailure(entry: Entry, error: unknown): void {
    const kind = classifySessionFailure(error);
    if (kind === "auth") {
      this.transition(entry, "waiting-auth", messageOf(error));
      void this.disposeClient(entry);
      return;
    }
    if (kind !== "account") return;
    const now = Date.now();
    if (now - entry.health.faultsWindowStart > this.guard.windowMs) {
      entry.health.faultsWindowStart = now;
      entry.health.faults = 0;
    }
    entry.health.faults += 1;
    if (entry.health.faults < this.guard.threshold) return;
    this.transition(entry, "isolated", `${entry.health.faults} session failures within ${this.guard.windowMs / 1_000}s`);
    void this.disposeClient(entry);
    entry.health.attempts = 0;
    this.scheduleBackoff(entry);
  }

  private noteSuccess(entry: Entry): void {
    entry.health.faults = 0;
    entry.health.faultsWindowStart = Date.now();
  }

  private transition(entry: Entry, state: SessionState, reason?: string): void {
    if (entry.health.state === state) {
      if (reason !== undefined) entry.health.reason = reason;
      return;
    }
    const previous = entry.health.state;
    entry.health.state = state;
    entry.health.since = Date.now();
    if (reason !== undefined) entry.health.reason = reason;
    if (state === "connected" || state === "waiting-auth") entry.health.attempts = 0;
    if (this.closed) return;
    this.logger.info(`session ${entry.name} ${previous} -> ${state}` + (reason ? ": " + reason : ""));
    for (const listener of [...this.listeners]) {
      try {
        listener({ name: entry.name, previous, state, reason });
      } catch (error) {
        this.logger.error("session state listener failed", error);
      }
    }
  }

  private unavailable(entry: Entry): SessionUnavailableError {
    return new SessionUnavailableError(entry.name, entry.health.state, entry.health.reason);
  }

  private async disposeClient(entry: Entry): Promise<void> {
    const client = entry.client;
    entry.client = undefined;
    if (!client) return;
    try {
      const saved = client.session.save();
      if (saved) await writeSessionFile(this.settings.telegram.sessionsDir, entry.name, saved);
    } catch (error) {
      this.logger.warn("could not save session " + entry.name, error);
    }
    await client.disconnect().catch((error: unknown) => {
      this.logger.warn("could not disconnect session " + entry.name, error);
    });
  }

  private async saveSession(entry: Entry): Promise<void> {
    if (!entry.client) return;
    try {
      await writeSessionFile(this.settings.telegram.sessionsDir, entry.name, entry.client.session.save());
    } catch (error) {
      this.logger.warn("could not save session " + entry.name, error);
    }
  }

  private async checkAuthorized(client: SessionClient): Promise<void> {
    const invoker = client as unknown as { invoke?: (request: unknown) => Promise<unknown> };
    if (typeof invoker.invoke === "function") {
      await invoker.invoke(new Api.updates.GetState());
    }
  }

  private async runLogin(entry: Entry, ask: (kind: LoginPromptKind) => Promise<string>): Promise<void> {
    const client = entry.client ?? (entry.client = this.createClient(entry.name, ""));
    await client.start({
      phoneNumber: () => ask("phone"),
      phoneCode: () => ask("code"),
      password: () => ask("password"),
      onError: (error: unknown) => this.logger.warn("session login step failed: " + entry.name, error)
    });
    if (entry.login && !this.closed) entry.login.result = { ok: true };
  }

  private askOverStdin(name: string): (kind: LoginPromptKind) => Promise<string> {
    return (kind) => {
      if (!input.isTTY) throw new Error("session " + name + " login needs an interactive terminal");
      const readline = createInterface({ input, output });
      const label = kind === "phone" ? "Phone number: " : kind === "code" ? "Login code: " : "Two-factor password: ";
      return readline.question(label).finally(() => readline.close());
    };
  }

  private askOverControl(entry: Entry): (kind: LoginPromptKind) => Promise<string> {
    return (kind) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (entry.login?.ask?.timer === timer) entry.login.ask = undefined;
          reject(new Error("login input timed out after " + LOGIN_INPUT_TIMEOUT_MS / 1_000 + "s"));
        }, LOGIN_INPUT_TIMEOUT_MS);
        timer.unref?.();
        const flow = entry.login;
        if (!flow) {
          clearTimeout(timer);
          reject(new Error("login flow ended"));
          return;
        }
        flow.ask = {
          kind,
          resolve: (value: string) => {
            clearTimeout(timer);
            resolve(value);
          },
          timer
        };
      });
  }

  private async awaitLogin(entry: Entry): Promise<SessionLoginReply> {
    for (;;) {
      if (this.closed) return { status: "error", message: "runtime is stopping" };
      if (entry.health.state === "connected") return { status: "ok" };
      const flow = entry.login;
      if (!flow) return { status: "error", message: "login flow ended" };
      if (flow.ask) return { status: "prompt", kind: flow.ask.kind };
      if (flow.result) {
        return flow.result.ok ? { status: "ok" } : { status: "error", message: flow.result.error ?? "session login failed" };
      }
      if (entry.health.state !== "starting") {
        return { status: "error", message: entry.health.reason ?? "session login failed" };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
}

export function createGramClient(sessionName: string, content: string): SessionClient {
  const session = new StringSession(content);
  return new TelegramClient(session, currentSettings.telegram.apiId, currentSettings.telegram.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
    ...(currentLogger ? { baseLogger: createGramLogger(currentLogger, currentSettings.logging.level) } : {})
  }) as unknown as SessionClient;
}

let currentSettings: AppSettings = {
  telegram: { apiId: 0, apiHash: "", sessionsDir: resolve("data/accounts") },
  logging: { level: "info", directory: resolve("data/logs") }
};

let currentLogger: RuntimeLogger | undefined;

export function configureTelegramClientFactory(settings: AppSettings, logger?: RuntimeLogger): void {
  currentSettings = settings;
  currentLogger = logger;
}

export function createGramLogger(logger: RuntimeLogger, level: string): GramLogger {
  const gram = new GramLogger(gramLogLevel(level));
  gram.log = (logLevel, message) => {
    switch (logLevel) {
      case LogLevel.ERROR:
        logger.error(message);
        break;
      case LogLevel.WARN:
        logger.warn(message);
        break;
      case LogLevel.DEBUG:
        logger.debug(message);
        break;
      default:
        logger.info(message);
    }
  };
  return gram;
}

function gramLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

async function readSessionFile(directory: string, name: string): Promise<string> {
  const path = sessionPath(directory, name);
  try {
    await access(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "";
    throw error;
  }
  return readFile(path, "utf8");
}

async function writeSessionFile(directory: string, name: string, value: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(sessionPath(directory, name), value, "utf8");
}

function sessionPath(directory: string, name: string): string {
  const filename = name.endsWith(".session") ? name : name + ".session";
  if (basename(filename) !== filename) throw new Error("invalid session name: " + name);
  return join(directory, filename);
}

function normalizeSessionName(value: string): string {
  const result = String(value).trim();
  if (!result) throw new Error("session name cannot be empty");
  return result.endsWith(".session") ? result.slice(0, -8) : result;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
