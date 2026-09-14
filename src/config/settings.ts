import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { isRecord, normalizeSession } from "./model.js";
import { defaultSettingsFile } from "./paths.js";

export interface SessionGuardSettings {
  readonly windowMs: number;
  readonly threshold: number;
  readonly backoffMinMs: number;
  readonly backoffMaxMs: number;
}

export interface PluginSettings {
  readonly manifest: string;
  readonly registry: string;
  readonly autoInstall: boolean;
  readonly manifestTtlHours: number;
  readonly scopes: readonly string[];
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  manifest: "@paperkite/bundles",
  registry: "https://registry.npmjs.org",
  autoInstall: true,
  manifestTtlHours: 24,
  scopes: ["@paperkite/"]
};

export interface AppSettings {
  readonly telegram: {
    readonly apiId: number;
    readonly apiHash: string;
    readonly sessionsDir: string;
    readonly sessionGuard?: SessionGuardSettings;
  };
  readonly logging: {
    readonly level: string;
    readonly directory: string;
  };
  readonly plugins: PluginSettings;
}

export async function loadSettings(path = defaultSettingsFile()): Promise<AppSettings> {
  const base = dirname(resolve(path));
  const data = parse(await readFile(resolve(path), "utf8")) as unknown;
  if (!isRecord(data) || !isRecord(data.telegram)) {
    throw new Error("settings.yml needs a telegram section");
  }
  const apiId = Number(data.telegram.apiId);
  const apiHash = normalizeSession(data.telegram.apiHash);
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("settings.yml needs telegram.apiId and telegram.apiHash");
  }
  const sessionsDir = normalizeSession(data.telegram.sessionsDir) ?? "accounts";
  const logging = isRecord(data.logging) ? data.logging : {};
  const plugins = isRecord(data.plugins) ? data.plugins : {};
  const guard = isRecord(data.telegram.sessionGuard) ? data.telegram.sessionGuard : {};
  return {
    telegram: {
      apiId,
      apiHash,
      sessionsDir: resolve(base, sessionsDir),
      sessionGuard: {
        windowMs: positiveNumber(guard.windowMs ?? 60_000, "sessionGuard.windowMs"),
        threshold: positiveNumber(guard.threshold ?? 5, "sessionGuard.threshold"),
        backoffMinMs: positiveNumber(guard.backoffMinMs ?? 30_000, "sessionGuard.backoffMinMs"),
        backoffMaxMs: positiveNumber(guard.backoffMaxMs ?? 30 * 60_000, "sessionGuard.backoffMaxMs")
      }
    },
    logging: {
      level: String(logging.level ?? "info").toLowerCase(),
      directory: resolve(base, String(logging.directory ?? "logs"))
    },
    plugins: {
      manifest: normalizeSession(plugins.manifest) ?? DEFAULT_PLUGIN_SETTINGS.manifest,
      registry: normalizeSession(plugins.registry) ?? DEFAULT_PLUGIN_SETTINGS.registry,
      autoInstall:
        typeof plugins.autoInstall === "boolean" ? plugins.autoInstall : DEFAULT_PLUGIN_SETTINGS.autoInstall,
      manifestTtlHours: nonNegativeNumber(
        plugins.manifestTtlHours ?? DEFAULT_PLUGIN_SETTINGS.manifestTtlHours,
        "plugins.manifestTtlHours"
      ),
      scopes: normalizeScopes(plugins.scopes) ?? DEFAULT_PLUGIN_SETTINGS.scopes
    }
  };
}

function nonNegativeNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("settings.yml needs a non-negative " + field);
  return Math.floor(number);
}

function normalizeScopes(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = value.map((item) => String(item).trim()).filter(Boolean);
  return scopes.length ? scopes : undefined;
}

function positiveNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("settings.yml needs a positive " + field);
  return Math.floor(number);
}
