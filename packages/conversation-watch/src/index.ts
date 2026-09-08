import { NewMessage } from "telegram/events/index.js";
import { Trigger, type TriggerEvent } from "@paperkite/sdk";

interface WatchConfig {
  readonly chat?: string | number;
  readonly chats?: readonly (string | number)[];
  readonly fromUsers?: readonly (string | number)[];
  readonly keywords?: readonly string[];
  readonly match?: string;
  readonly matchFlags?: string;
  readonly incoming?: boolean;
  readonly outgoing?: boolean;
  readonly forwards?: boolean;
  readonly pollSeconds?: number;
  readonly intervalSeconds?: number;
  readonly limit?: number;
  readonly startAfterId?: number;
}

interface EventClient {
  addEventHandler(handler: (event: unknown) => void, builder: NewMessage): void;
  removeEventHandler(handler: (event: unknown) => void, builder: NewMessage): void;
  getMessages(chat: string | number, options: Record<string, unknown>): Promise<readonly unknown[]>;
}

export class LiveConversationTrigger extends Trigger<WatchConfig> {
  async run(): Promise<void> {
    const chats = listChats(this.config);
    if (!this.sessions || !this.session) throw new Error("live conversation watcher needs a session");
    const matcher = makePattern(this.config);
    const registrations: Array<{ client: EventClient; handler: (event: unknown) => void; builder: NewMessage }> = [];
    try {
      await this.sessions.run(async (rawClient) => {
        const client = rawClient as EventClient;
        const builder = new NewMessage({
          chats: chats as never[],
          fromUsers: this.config.fromUsers as never[] | undefined,
          incoming: this.config.incoming,
          outgoing: this.config.outgoing,
          forwards: this.config.forwards,
          pattern: matcher ? new RegExp(matcher.source, matcher.flags) : undefined
        });
        const handler = (input: unknown): void => {
          void this.handleEvent(input, matcher).catch((error) => this.contextError(error));
        };
        client.addEventHandler(handler, builder);
        registrations.push({ client, handler, builder });
      });
      await waitForAbort(this.signal);
    } finally {
      for (const { client, handler, builder } of registrations) client.removeEventHandler(handler, builder);
    }
  }

  private async handleEvent(input: unknown, matcher: RegExp | undefined): Promise<void> {
    const event = toTriggerEvent(getEventMessage(input));
    if (matches(event, this.config, matcher)) await this.emit(event);
  }

  private contextError(error: unknown): void {
    this.context.logger.error("live conversation watcher failed", error);
  }
}

export class PollConversationTrigger extends Trigger<WatchConfig> {
  async run(): Promise<void> {
    const chats = listChats(this.config);
    if (!this.sessions || !this.session) throw new Error("poll conversation watcher needs a session");
    const interval = normalizeSeconds(this.config.pollSeconds ?? this.config.intervalSeconds, 30);
    const limit = normalizeLimit(this.config.limit);
    const matcher = makePattern(this.config);
    const cursors = new Map<string, number>();
    for (const chat of chats) cursors.set(cursorKey(chat), this.config.startAfterId ?? 0);

    while (!this.signal.aborted) {
      for (const chat of chats) {
        if (this.signal.aborted) break;
        try {
          await runUntilAborted(
            this.sessions.run(async (rawClient) => {
              const client = rawClient as EventClient;
              const messages = await client.getMessages(chat, {
                limit,
                minId: cursors.get(cursorKey(chat)) ?? 0,
                reverse: true
              });
              for (const raw of messages) {
                const event = toTriggerEvent(raw);
                if (event.id && event.id > (cursors.get(cursorKey(chat)) ?? 0)) {
                  cursors.set(cursorKey(chat), event.id);
                }
                if (matches(event, this.config, matcher)) await this.emit(event);
              }
            }),
            this.signal
          );
        } catch (error) {
          if (this.signal.aborted) break;
          this.context.logger.warn("conversation polling failed", { chat, error });
        }
      }
      await waitForSeconds(interval, this.signal);
    }
  }
}

function listChats(config: WatchConfig): Array<string | number> {
  const values = [...(config.chats ?? [])];
  if (config.chat !== undefined) values.unshift(config.chat);
  const result = [...new Map(values.map((value) => [String(value), value])).values()];
  if (!result.length) throw new Error("conversation watcher needs chat or chats");
  return result;
}

function makePattern(config: WatchConfig): RegExp | undefined {
  if (!config.match) return undefined;
  try {
    return new RegExp(config.match, config.matchFlags);
  } catch (error) {
    throw new Error("invalid conversation match pattern: " + String(error));
  }
}

function matches(event: TriggerEvent, config: WatchConfig, matcher: RegExp | undefined): boolean {
  const text = event.text;
  if (config.keywords?.length) {
    const keywords = config.keywords.map((value) => String(value)).filter(Boolean);
    if (!keywords.some((keyword) => text.includes(keyword))) return false;
  }
  if (matcher) {
    matcher.lastIndex = 0;
    if (!matcher.test(text)) return false;
  }
  if (
    config.fromUsers?.length &&
    !config.fromUsers.some((value) => {
      const expected = String(value).replace(/^@/, "").toLowerCase();
      return expected === event.senderId?.toLowerCase() || expected === event.senderUsername?.toLowerCase();
    })
  ) {
    return false;
  }
  return true;
}

function getEventMessage(input: unknown): unknown {
  return isRecord(input) && isRecord(input.message) ? input.message : input;
}

function toTriggerEvent(message: unknown): TriggerEvent {
  const value = isRecord(message) ? message : {};
  const id = positiveNumber(value.id);
  const sender = value.senderId ?? value.fromId;
  const chat = value.chatId ?? value.peerId ?? value.chat;
  const date = value.date instanceof Date ? value.date.toISOString() : toDate(value.date);
  return {
    id,
    text: String(value.message ?? value.text ?? ""),
    senderId: entityId(sender),
    senderUsername: isRecord(value.sender) && value.sender.username ? String(value.sender.username) : undefined,
    senderName: entityName(value.sender),
    chatId: entityId(chat),
    chatTitle: entityName(value.chat),
    date,
    raw: message
  };
}

function entityId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value);
  if (isRecord(value)) {
    for (const key of ["channelId", "chatId", "userId", "id"]) {
      if (value[key] !== undefined) return String(value[key]);
    }
  }
  return String(value);
}

function entityName(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const parts = [value.firstName, value.lastName].filter(Boolean).map(String);
  return parts.join(" ") || (value.title ? String(value.title) : value.username ? String(value.username) : undefined);
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function toDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const date = new Date(typeof value === "number" ? value * 1_000 : String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeSeconds(value: number | undefined, fallback: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(86_400, number);
}

function normalizeLimit(value: number | undefined): number {
  const number = Number(value ?? 100);
  if (!Number.isFinite(number) || number <= 0) return 100;
  return Math.min(1_000, Math.trunc(number));
}

function cursorKey(chat: string | number): string {
  return String(chat);
}

async function waitForSeconds(seconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, seconds * 1_000);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

async function runUntilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("aborted");
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(new Error("aborted")));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
