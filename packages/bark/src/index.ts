import { Action, definePlugin, type PluginContext, type TriggerEmission } from "@paperkite/sdk";

interface BarkConfig {
  /** Bark 服务入口；缺省用官方 api.day.app，自建部署时如 https://bark.example:444。 */
  readonly server?: string;
  /** 设备 key：推送目标 `${server}/${key}`。 */
  readonly key?: string;
  readonly title?: string;
  readonly body?: string;
  readonly message?: string;
  readonly group?: string;
  readonly level?: string;
  readonly icon?: string;
  /** 点击通知后跳转的 URL。 */
  readonly click?: string;
  /** 长按通知可复制的文本。 */
  readonly copy?: string;
  readonly timeoutMs?: number;
  readonly method?: "get" | "post";
}

class BarkAction extends Action<BarkConfig> {
  protected async run(): Promise<void> {
    const server = this.config.server?.trim() || "https://api.day.app";
    const key = this.config.key?.trim();
    if (!key) throw new Error("notifications.bark needs key");
    const title = render(this.config.title ?? "Paperkite", this.emission);
    const body = render(this.config.body ?? this.config.message ?? "", this.emission);
    const method = (this.config.method ?? "post").toUpperCase() as "GET" | "POST";
    if (method === "POST" && !body) throw new Error("notifications.bark needs body or message");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), normalizeTimeout(this.config.timeoutMs));
    const onAbort = (): void => controller.abort();
    this.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(
        method === "POST"
          ? buildBarkUrl(server, key, { title: "" })
          : buildBarkUrl(server, key, {
              title,
              body,
              group: this.config.group,
              level: this.config.level,
              icon: this.config.icon,
              click: this.config.click,
              copy: this.config.copy
            }),
        {
          method,
          ...(method === "POST"
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  title,
                  body,
                  group: this.config.group,
                  level: this.config.level,
                  icon: this.config.icon,
                  url: this.config.click,
                  copy: this.config.copy
                })
              }
            : {}),
          signal: controller.signal
        }
      );
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

export interface BarkMessage {
  readonly title: string;
  readonly body?: string;
  readonly group?: string;
  readonly level?: string;
  readonly icon?: string;
  readonly click?: string;
  readonly copy?: string;
}

/** 按 Bark 路径格式拼推送 URL：`server/key/title(/body)?group&level&icon&url&copy`。 */
export function buildBarkUrl(server: string, key: string, message: BarkMessage): string {
  const root = new URL(server);
  if (root.protocol !== "https:" && root.protocol !== "http:") {
    throw new Error("Bark server must use http or https");
  }
  const segments = [key, message.title, message.body ?? ""].filter((part) => part !== "");
  const url = new URL(`${root.toString().replace(/\/+$/, "")}/${segments.map(encodeURIComponent).join("/")}`);
  if (message.group) url.searchParams.set("group", message.group);
  if (message.level) url.searchParams.set("level", message.level);
  if (message.icon) url.searchParams.set("icon", message.icon);
  if (message.click) url.searchParams.set("url", message.click);
  if (message.copy) url.searchParams.set("copy", message.copy);
  return url.toString();
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