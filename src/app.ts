import { resolve } from "node:path";
import { loadCatalog } from "./config/loader.js";
import { loadSettings, type AppSettings } from "./config/settings.js";
import { AppLogger } from "./engine/logger.js";
import { Runtime } from "./engine/runtime.js";
import { loadExtensions } from "./extensions/loader.js";
import { SessionPool, configureTelegramClientFactory } from "./telegram/pool.js";

export interface CreateAppOptions {
  readonly profile?: string;
  readonly settingsFile?: string;
  readonly flowsFile?: string;
}

export interface PaperkiteApp {
  readonly settings: AppSettings;
  readonly runtime: Runtime;
  readonly logger: AppLogger;
}

export async function createApp(options: CreateAppOptions = {}): Promise<PaperkiteApp> {
  const settings = await loadSettings(options.settingsFile ?? "data/settings.yml");
  const flowsFile = options.flowsFile ?? "data/flows.yml";
  const catalog = await loadCatalog(flowsFile);
  const logger = new AppLogger(settings.logging.level, settings.logging.directory);
  configureTelegramClientFactory(settings, logger);
  const extensions = await loadExtensions(catalog.atomRefs(), {
    profile: options.profile,
    logger
  });
  const sessions = new SessionPool(settings, logger);
  return {
    settings,
    logger,
    runtime: new Runtime({
      catalog,
      registry: extensions.registry,
      sessions,
      logger,
      installed: extensions.installed,
      reloadCatalog: () => loadCatalog(flowsFile)
    })
  };
}

export function defaultLockFile(): string {
  return resolve(process.env.PAPERKITE_HOME?.trim() || "data/.paperkite", "paperkite.lock");
}
