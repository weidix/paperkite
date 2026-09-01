export interface ArchiveTarget {
  readonly chat: string | number;
  readonly daysBack: number;
  readonly maxMessages: number;
  readonly downloadMedia: boolean;
  readonly resume: boolean;
}

export interface ArchiveConfig {
  readonly backend?: string;
  readonly file?: string;
  readonly dbPath?: string;
  readonly url?: string;
  readonly schema?: string;
  readonly chats?: unknown;
  readonly chat?: string | number;
  readonly daysBack?: number;
  readonly maxMessages?: number;
  readonly limit?: number;
  readonly downloadMedia?: boolean;
  readonly resume?: boolean;
  readonly batchSize?: number;
  readonly mediaPath?: string;
}

export function buildTargets(config: ArchiveConfig): ArchiveTarget[] {
  const defaultDaysBack = coerceInt(config.daysBack, 30);
  const defaultMaxMessages = coerceInt(config.maxMessages ?? config.limit, 1_000);
  const defaultDownloadMedia = coerceBool(config.downloadMedia, true);
  const defaultResume = coerceBool(config.resume, true);

  const targets: ArchiveTarget[] = [];
  const addTarget = (source: unknown): void => {
    let identifier: string | number | undefined;
    const overrides = isRecord(source) ? source : undefined;
    if (typeof source === "string" || typeof source === "number") {
      identifier = source;
    } else if (overrides) {
      const raw = overrides.chat ?? overrides.identifier;
      if (typeof raw === "string" || typeof raw === "number") identifier = raw;
    }
    if (identifier === undefined || identifier === "") {
      throw new Error("chats entry needs chat or identifier");
    }
    targets.push({
      chat: identifier,
      daysBack: coerceInt(overrides?.daysBack, defaultDaysBack),
      maxMessages: coerceInt(overrides?.maxMessages ?? overrides?.limit, defaultMaxMessages),
      downloadMedia: coerceBool(overrides?.downloadMedia, defaultDownloadMedia),
      resume: coerceBool(overrides?.resume, defaultResume)
    });
  };

  if (Array.isArray(config.chats)) {
    for (const item of config.chats) addTarget(item);
  } else if (config.chats) {
    addTarget(config.chats);
  }
  return targets;
}

export function coerceInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`invalid integer: ${String(value)}`);
  return result;
}

export function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["false", "no", "off", "0", ""].includes(text)) return false;
    return true;
  }
  return Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}