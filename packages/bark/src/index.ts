import { Action, definePlugin, type PluginContext, type TriggerEmission } from "@paperkite/sdk";

interface BarkConfig {
  readonly endpoint?: string;
  readonly url?: string;
  readonly key?: string;
  readonly title?: string;
  readonly body?: string;
  readonly message?: string;
  readonly group?: string;
  readonly level?: string;
  readonly icon?: string;
  readonly click?: string;
  readonly copy?: string;
  readonly timeoutMs?: number;
  readonly method?: "get" | "post";
}

class BarkAction extends Action<BarkConfig> {
  protected async run(): Promise<void> {
    const endpoint = this.payload.endpoint ?? this.payload.url ?? process.env.BARK_ENDPOINT;
    if (!endpoint) throw new Error("notifications.bark needs endpoint");
    const body = render(this.payload.body ?? this.payload.message ?? "", this.emission);
    const method = (this.payload.method ?? "post").toUpperCase() as "GET" | "POST";
    if (method === "POST" && !body) throw new Error("notifications.bark needs body or message");
    const target = buildBarkUrl(endpoint, this.payload.key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), normalizeTimeout(this.payload.timeoutMs));
    const onAbort = (): void => controller.abort();
    this.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(target, {
        method,
        ...(method === "POST"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: render(this.payload.title ?? "Paperkite", this.emission),
                body,
                group: this.payload.group,
                level: this.payload.level,
                icon: this.payload.icon,
                url: this.payload.click,
                copy: this.payload.copy
              })
            }
          : {}),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Bark request failed with HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
      this.signal.removeEventListener("abort", onAbort);
    }
  }
}

export const manifest = {
  name: "@paperkite/plugin-bark",
  version: "0.1.0",
  capabilities: [{ kind: "action" as const, name: "notifications.bark" }]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerAction("notifications.bark", BarkAction);
}

export default definePlugin({ manifest, register });

export function buildBarkUrl(endpoint: string, key?: string): string {
  const value = endpoint.trim();
  if (!value) throw new Error("Bark endpoint cannot be empty");
  const withKey = key ? value.replaceAll("{key}", encodeURIComponent(key)) : value;
  const parsed = new URL(withKey);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Bark endpoint must use http or https");
  }
  return parsed.toString();
}

function render(value: string, emission: TriggerEmission | undefined): string {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
    const result = readPath({ event: emission?.event }, path.trim());
    return result === undefined || result === null ? "" : String(result);
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

function normalizeTimeout(value: number | undefined): number {
  return Math.min(120_000, Math.max(1_000, Number.isFinite(value) ? Number(value) : 15_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
