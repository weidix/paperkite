import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { Action, definePlugin, type PluginContext, type TriggerEmission } from "@paperkite/sdk";

interface SendConfig {
  readonly mode?: "user" | "bot" | "personal";
  readonly peer?: string | number;
  readonly to?: string | number;
  readonly chat?: string | number;
  readonly chatId?: string | number;
  readonly botToken?: string;
  readonly text?: string;
  readonly message?: string;
  readonly file?: string;
  readonly caption?: string;
  readonly reply?: boolean;
  readonly replyTo?: number;
  readonly silent?: boolean;
  readonly parseMode?: string;
  readonly linkPreview?: boolean;
  readonly sendAt?: string;
  readonly delaySeconds?: number;
}

interface TelegramClientLike {
  sendMessage(peer: string | number, options: Record<string, unknown>): Promise<unknown>;
  sendFile(peer: string | number, options: Record<string, unknown>): Promise<unknown>;
}

class SendMessageAction extends Action<SendConfig> {
  protected async run(): Promise<void> {
    const peer = this.payload.peer ?? this.payload.to ?? this.payload.chat;
    const message = render(this.payload.text ?? this.payload.message ?? "", this.emission);
    await waitForSendTime(this.payload.sendAt, this.payload.delaySeconds, this.signal);
    if (this.signal.aborted) return;
    if (this.payload.mode === "bot") {
      await sendWithBot(this.payload, message, this.emission, this.signal);
      return;
    }
    if (peer === undefined || peer === "") throw new Error("messages.send needs peer");
    if (!this.sessions || !this.session) throw new Error("messages.send needs a session");
    await this.sessions.run(this.session, async (client) => {
      const telegram = client as TelegramClientLike;
      if (this.payload.file) {
        await telegram.sendFile(peer, {
          file: this.payload.file,
          caption: render(this.payload.caption ?? message, this.emission),
          replyTo: this.payload.replyTo ?? (this.payload.reply ? replyId(this.emission) : undefined),
          silent: this.payload.silent,
          parseMode: this.payload.parseMode,
          forceDocument: false
        });
        return;
      }
      if (!message) throw new Error("messages.send needs text or file");
      await telegram.sendMessage(peer, {
        message,
        replyTo: this.payload.replyTo ?? (this.payload.reply ? replyId(this.emission) : undefined),
        silent: this.payload.silent,
        parseMode: this.payload.parseMode,
        linkPreview: this.payload.linkPreview
      });
    });
  }
}

export const manifest = {
  name: "@paperkite/plugin-telegram-messages",
  version: "0.1.0",
  capabilities: [{ kind: "action" as const, name: "messages.send" }]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerAction("messages.send", SendMessageAction);
}

export default definePlugin({ manifest, register });

function render(value: string, emission: TriggerEmission | undefined): string {
  const values: Record<string, unknown> = {
    text: readPath(emission?.event, "text"),
    sender: readPath(emission?.event, "senderId"),
    sender_name: readPath(emission?.event, "senderName"),
    chat: readPath(emission?.event, "chatId"),
    chat_title: readPath(emission?.event, "chatTitle"),
    id: readPath(emission?.event, "id"),
    date: readPath(emission?.event, "date"),
    source_id: emission?.source.id,
    source_capability: emission?.source.capability
  };
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}|\{(\w+)\}/g, (match, path: string | undefined, short: string | undefined) => {
    const result = path ? readPath({ event: emission?.event }, path.trim()) : values[short ?? ""];
    return result === undefined || result === null ? (path ? "" : match) : String(result);
  });
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

async function waitForSendTime(
  sendAt: string | undefined,
  delaySeconds: number | undefined,
  signal: AbortSignal
): Promise<void> {
  let delay = Math.max(0, Number(delaySeconds ?? 0) * 1_000);
  if (sendAt) {
    const target = parseSendAt(sendAt);
    if (!Number.isFinite(target)) throw new Error("messages.send sendAt must be an ISO timestamp");
    delay = Math.max(delay, target - Date.now());
  }
  if (!delay) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const abort = (): void => finish(new Error("message send cancelled"));
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), delay);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function sendWithBot(
  config: SendConfig,
  message: string,
  emission: TriggerEmission | undefined,
  parentSignal: AbortSignal
): Promise<void> {
  const token = config.botToken;
  const chatId = config.chatId ?? config.chat;
  if (!token || chatId === undefined || chatId === "") throw new Error("bot mode needs botToken and chatId");
  if (!config.file && !message) throw new Error("messages.send needs text or file");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const abort = (): void => controller.abort();
  parentSignal.addEventListener("abort", abort, { once: true });
  try {
    const endpoint = new URL(`https://api.telegram.org/bot${token}/${config.file ? "sendDocument" : "sendMessage"}`);
    let body: BodyInit;
    if (config.file) {
      const form = new FormData();
      form.set("chat_id", String(chatId));
      form.set("document", new Blob([await readFile(config.file)]), config.file.split(/[\\/]/).pop() ?? "file");
      form.set("caption", render(config.caption ?? message, emission));
      const replyTo = config.replyTo ?? (config.reply ? replyId(emission) : undefined);
      if (replyTo) form.set("reply_to_message_id", String(replyTo));
      if (config.silent !== undefined) form.set("disable_notification", String(config.silent));
      body = form;
    } else {
      body = JSON.stringify({
        chat_id: chatId,
        text: message,
        reply_to_message_id: config.replyTo ?? (config.reply ? replyId(emission) : undefined),
        disable_notification: config.silent,
        parse_mode: config.parseMode,
        link_preview_options: config.linkPreview === false ? { is_disabled: true } : undefined
      });
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
      body,
      signal: controller.signal
    });
    const result = (await response.json().catch(() => undefined)) as { ok?: boolean; description?: string } | undefined;
    if (!response.ok || !result?.ok) throw new Error("Telegram Bot API failed: " + (result?.description ?? response.status));
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", abort);
  }
}

function parseSendAt(value: string): number {
  const iso = DateTime.fromISO(value);
  if (iso.isValid) return iso.toMillis();
  const short = DateTime.fromFormat(value, "HH:mm:ss.SSS");
  if (short.isValid) return DateTime.now().set({ hour: short.hour, minute: short.minute, second: short.second, millisecond: short.millisecond }).toMillis();
  throw new Error("messages.send sendAt must be an ISO timestamp or HH:mm:ss.SSS");
}

function replyId(emission: TriggerEmission | undefined): number | undefined {
  const value = emission?.event;
  if (!isRecord(value)) return undefined;
  const id = Number(value.id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
