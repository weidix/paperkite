import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { isRecord, normalizeSession } from "./model.js";

export interface AppSettings {
  readonly telegram: {
    readonly apiId: number;
    readonly apiHash: string;
    readonly sessionsDir: string;
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
  return {
    telegram: {
      apiId,
      apiHash,
      sessionsDir: resolve(sessionsDir)
    },
    logging: {
      level: String(logging.level ?? "info").toLowerCase(),
      directory: resolve(String(logging.directory ?? "data/logs"))
    }
  };
}
