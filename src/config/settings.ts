import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { isRecord, normalizeSession } from "./model.js";

export interface SessionGuardSettings {
  readonly windowMs: number;
  readonly threshold: number;
  readonly backoffMinMs: number;
  readonly backoffMaxMs: number;
}

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
}

export async function loadSettings(path = "data/settings.yml"): Promise<AppSettings> {
  const data = parse(await readFile(resolve(path), "utf8")) as unknown;
  if (!isRecord(data) || !isRecord(data.telegram)) {
    throw new Error("settings.yml needs a telegram section");
  }
  const apiId = Number(data.telegram.apiId ?? data.telegram.api_id);
  const apiHash = normalizeSession(data.telegram.apiHash ?? data.telegram.api_hash);
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("settings.yml needs telegram.apiId and telegram.apiHash");
  }
  const sessionsDir = normalizeSession(data.telegram.sessionsDir ?? data.telegram.sessions_dir) ?? "data/accounts";
  const logging = isRecord(data.logging) ? data.logging : {};
  const guard = isRecord(data.telegram.sessionGuard) ? data.telegram.sessionGuard : {};
  return {
    telegram: {
      apiId,
      apiHash,
      sessionsDir: resolve(sessionsDir),
      sessionGuard: {
        windowMs: positiveNumber(guard.windowMs ?? 60_000, "sessionGuard.windowMs"),
        threshold: positiveNumber(guard.threshold ?? 5, "sessionGuard.threshold"),
        backoffMinMs: positiveNumber(guard.backoffMinMs ?? 30_000, "sessionGuard.backoffMinMs"),
        backoffMaxMs: positiveNumber(guard.backoffMaxMs ?? 30 * 60_000, "sessionGuard.backoffMaxMs")
      }
    },
    logging: {
      level: String(logging.level ?? "info").toLowerCase(),
      directory: resolve(String(logging.directory ?? "data/logs"))
    }
  };
}

function positiveNumber(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("settings.yml needs a positive " + field);
  return Math.floor(number);
}
