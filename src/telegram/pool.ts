import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { RuntimeLogger, SessionAccess } from "@paperkite/sdk";
import type { AppSettings } from "../config/settings.js";

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

interface Entry {
  readonly name: string;
  readonly client: SessionClient;
  ready: Promise<void>;
  tail: Promise<void>;
}

export class SessionPool {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly settings: AppSettings,
    private readonly logger: RuntimeLogger,
    private readonly createClient: (session: string, content: string) => SessionClient = createGramClient
  ) {}

  async ensure(names: Iterable<string>): Promise<void> {
    for (const name of new Set([...names].map((value) => normalizeSessionName(value)))) {
      let entry = this.entries.get(name);
      if (!entry) {
        const content = await readSessionFile(this.settings.telegram.sessionsDir, name);
        const client = this.createClient(name, content);
        entry = { name, client, ready: Promise.resolve(), tail: Promise.resolve() };
        entry.ready = this.startEntry(entry);
        this.entries.set(name, entry);
      }
      await entry.ready;
    }
  }

  access(): SessionAccess {
    return {
      get: (name) => this.get(name),
      run: (name, operation) => this.run(name, operation)
    };
  }

  get(name: string): SessionClient {
    const entry = this.entries.get(normalizeSessionName(name));
    if (!entry) throw new Error("session is not initialized: " + name);
    return entry.client;
  }

  async run<T>(name: string, operation: (client: SessionClient) => T | Promise<T>): Promise<T> {
    const entry = this.entries.get(normalizeSessionName(name));
    if (!entry) throw new Error("session is not initialized: " + name);
    await entry.ready;
    const previous = entry.tail;
    let resolveTail: (() => void) | undefined;
    entry.tail = new Promise<void>((resolvePromise) => {
      resolveTail = resolvePromise;
    });
    await previous;
    try {
      return await operation(entry.client);
    } finally {
      resolveTail?.();
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      await entry.ready.catch(() => undefined);
      await entry.tail;
      try {
        const saved = entry.client.session.save();
        await writeSessionFile(this.settings.telegram.sessionsDir, entry.name, saved);
      } catch (error) {
        this.logger.warn("could not save session " + entry.name, error);
      }
      await entry.client.disconnect().catch((error: unknown) => {
        this.logger.warn("could not disconnect session " + entry.name, error);
      });
    }
  }

  private async startEntry(entry: Entry): Promise<void> {
    const prompt = createInterface({ input, output });
    try {
      await entry.client.start({
        phoneNumber: async () => prompt.question("Phone number: "),
        phoneCode: async () => prompt.question("Login code: "),
        password: async () => prompt.question("Two-factor password: "),
        onError: (error) => this.logger.error("session login failed", error)
      });
      await writeSessionFile(
        this.settings.telegram.sessionsDir,
        entry.name,
        entry.client.session.save()
      );
      this.logger.info("session ready: " + entry.name);
    } finally {
      prompt.close();
    }
  }
}

export function createGramClient(sessionName: string, content: string): SessionClient {
  const session = new StringSession(content);
  return new TelegramClient(session, currentSettings.telegram.apiId, currentSettings.telegram.apiHash, {
    connectionRetries: 5,
    autoReconnect: true
  }) as unknown as SessionClient;
}

let currentSettings: AppSettings = {
  telegram: { apiId: 0, apiHash: "", sessionsDir: resolve("data/accounts") },
  logging: { level: "info", directory: resolve("data/logs") }
};

export function configureTelegramClientFactory(settings: AppSettings): void {
  currentSettings = settings;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
