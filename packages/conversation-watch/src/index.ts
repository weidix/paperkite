import { NewMessage } from "telegram/events/index.js";
import { Trigger, definePlugin, type PluginContext, type TriggerEvent } from "@paperkite/sdk";

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
  readonly sessions?: readonly string[];
}

interface EventClient {
  addEventHandler(handler: (event: unknown) => void, builder: NewMessage): void;
  removeEventHandler(handler: (event: unknown) => void, builder: NewMessage): void;
  getMessages(chat: string | number, options: Record<string, unknown>): Promise<readonly unknown[]>;
}

class LiveConversationTrigger extends Trigger<WatchConfig> {
  async run(): Promise<void> {
    const chats = listChats(this.payload);
    const sessions = sessionNames(this.payload, this.session);
    if (!this.sessions) throw new Error("conversation watcher needs session access");
    const matcher = makePattern(this.payload);
    const handlers: Array<{ client: EventClient; handler: (event: unknown) => void; builder: NewMessage }> = [];
    try {
      for (const session of sessions) {
        await this.sessions.run(session, async (rawClient) => {
          const client = rawClient as EventClient;
          const builder = new NewMessage({
            chats: chats as never[],
            fromUsers: this.payload.fromUsers as never[] | undefined,
            incoming: this.payload.incoming,
            outgoing: this.payload.outgoing,
            forwards: this.payload.forwards,
            pattern: matcher ? new RegExp(matcher.source, matcher.flags) : undefined
          });
          const handler = (input: unknown): void => {
            void this.handleEvent(input, matcher).catch((error) => this.contextError(error));
          };
          client.addEventHandler(handler, builder);
          handlers.push({ client, handler, builder });
        });
      }
      await waitForAbort(this.signal);
    } finally {
      for (const { client, handler, builder } of handlers) client.removeEventHandler(handler, builder);
    }
  }

  private async handleEvent(input: unknown, matcher: RegExp | undefined): Promise<void> {
    const event = toTriggerEvent(getEventMessage(input));
    if (matches(event, this.payload, matcher)) await this.emit(event);
  }

  private contextError(error: unknown): void {
    this.context.logger.error("live conversation watcher failed", error);
  }
}

class PollConversationTrigger extends Trigger<WatchConfig> {
  async run(): Promise<void> {
    const chats = listChats(this.payload);
    const sessions = sessionNames(this.payload, this.session);
    const interval = normalizeSeconds(this.payload.pollSeconds ?? this.payload.intervalSeconds, 30);
    const limit = normalizeLimit(this.payload.limit);
    if (!this.sessions) throw new Error("conversation watcher needs session access");
    const matcher = makePattern(this.payload);
    const cursors = new Map<string, number>();
    for (const session of sessions) {
      for (const chat of chats) cursors.set(cursorKey(session, chat), this.payload.startAfterId ?? 0);
    }

    while (!this.signal.aborted) {
      for (const session of sessions) {
        for (const chat of chats) {
          if (this.signal.aborted) break;
          try {
            await this.sessions.run(session, async (rawClient) => {
              const client = rawClient as EventClient;
              const messages = await client.getMessages(chat, {
                limit,
                minId: cursors.get(cursorKey(session, chat)) ?? 0,
                reverse: true
              });
              for (const raw of messages) {
                const event = toTriggerEvent(raw);
                if (event.id && event.id > (cursors.get(cursorKey(session, chat)) ?? 0)) {
                  cursors.set(cursorKey(session, chat), event.id);
                }
                if (matches(event, this.payload, matcher)) await this.emit(event);
              }
            });
          } catch (error) {
            this.context.logger.warn("conversation polling failed", { session, chat, error });
          }
        }
      }
      await waitForSeconds(interval, this.signal);
    }
  }
}

export const manifest = {
  name: "@paperkite/plugin-conversation-watch",
  version: "0.1.0",
  capabilities: [
    { kind: "trigger" as const, name: "watch.group" },
    { kind: "trigger" as const, name: "watch.poll" }
  ]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerTrigger("watch.group", LiveConversationTrigger);
  context.registerTrigger("watch.poll", PollConversationTrigger);
}

export default definePlugin({ manifest, register });

function listChats(config: WatchConfig): Array<string | number> {
  const values = [...(config.chats ?? [])];
  if (config.chat !== undefined) values.unshift(config.chat);
  const result = [...new Map(values.map((value) => [String(value), value])).values()];
  if (!result.length) throw new Error("conversation watcher needs chat or chats");
  return result;
}

function sessionNames(config: WatchConfig, parent: string | undefined): string[] {
  const values = [...(config.sessions ?? [])];
  if (parent) values.unshift(parent);
  const result = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (!result.length) throw new Error("conversation watcher needs session");
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

function cursorKey(session: string, chat: string | number): string {
  return session + "\u0000" + String(chat);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
