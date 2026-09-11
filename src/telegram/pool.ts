import { Api } from "telegram/tl/api.js";
import type { RuntimeLogger, SessionAccess, SessionState, Unsubscribe } from "@paperkite/sdk";
import { SessionUnavailableError } from "../engine/errors.js";
import type { AppSettings } from "../config/settings.js";
import { createGramClient, type SessionClient } from "./client.js";
import { classifySessionFailure } from "./failure.js";
import { normalizeSessionName, readSessionFile, writeSessionFile } from "./session-files.js";

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
}

interface GuardSettings {
  windowMs: number;
  threshold: number;
  backoffMinMs: number;
  backoffMaxMs: number;
}

const DEFAULT_GUARD: GuardSettings = { windowMs: 60_000, threshold: 5, backoffMinMs: 30_000, backoffMaxMs: 30 * 60_000 };

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
        void this.attempt(created);
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
    await this.attempt(entry);
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

  private async attempt(entry: Entry): Promise<void> {
    if (this.closed) return;
    if (entry.health.state === "starting") {
      await entry.ready.catch(() => undefined);
      return;
    }
    if (entry.health.state === "connected") return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.health.reason = "connecting";
    entry.health.state = "starting";
    entry.ready = new Promise<void>((resolvePromise) => {
      entry.readyResolve = resolvePromise;
    });
    try {
      const outcome = await this.performAttempt(entry);
      if (this.closed) return;
      if (outcome.ok) {
        await this.saveSession(entry);
        this.transition(entry, "connected");
        return;
      }
      this.failAttempt(entry, outcome.error, outcome.hadContent);
    } finally {
      entry.readyResolve?.();
      entry.readyResolve = undefined;
    }
  }

  private async performAttempt(
    entry: Entry
  ): Promise<{ ok: boolean; error?: unknown; hadContent: boolean }> {
    await this.disposeClient(entry);
    const content = await readSessionFile(this.settings.telegram.sessionsDir, entry.name).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error))
    );
    if (content instanceof Error) return { ok: false, error: content, hadContent: false };
    const hadContent = Boolean(content);
    if (!hadContent) {
      return { ok: false, error: new Error("session " + entry.name + " has no saved login"), hadContent: false };
    }
    try {
      const client = this.createClient(entry.name, content);
      entry.client = client;
      await client.connect();
      await this.checkAuthorized(client);
      return { ok: true, hadContent };
    } catch (error) {
      return { ok: false, error, hadContent };
    }
  }

  private failAttempt(entry: Entry, error: unknown, hadContent: boolean): void {
    const message = messageOf(error);
    const kind = classifySessionFailure(error);
    if (kind === "auth" || !hadContent) {
      this.transition(entry, "waiting-auth", loginHint(entry.name, message));
      return;
    }
    entry.health.attempts += 1;
    this.transition(entry, "isolated", message);
    this.scheduleBackoff(entry);
  }

  private scheduleBackoff(entry: Entry): void {
    if (this.closed || entry.health.state !== "isolated") return;
    const delay = Math.min(this.guard.backoffMaxMs, this.guard.backoffMinMs * 2 ** Math.max(0, entry.health.attempts - 1));
    const timer = setTimeout(() => void this.attempt(entry), delay);
    timer.unref();
    entry.timer = timer;
  }

  private noteFailure(entry: Entry, error: unknown): void {
    const kind = classifySessionFailure(error);
    if (kind === "auth") {
      this.transition(entry, "waiting-auth", loginHint(entry.name, messageOf(error)));
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
      if (state === "connected") entry.health.reason = undefined;
      else if (reason !== undefined) entry.health.reason = reason;
      return;
    }
    const previous = entry.health.state;
    entry.health.state = state;
    entry.health.since = Date.now();
    if (state === "connected") entry.health.reason = undefined;
    else if (reason !== undefined) entry.health.reason = reason;
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
    await client.invoke(new Api.updates.GetState());
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loginHint(name: string, detail: string | undefined): string {
  const base = detail && detail.trim() ? detail : "session login is required";
  return base + "; run `paperkite session login " + name + "` to log in";
}