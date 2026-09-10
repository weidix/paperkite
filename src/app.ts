import { join } from "node:path";
import { loadCatalog } from "./config/loader.js";
import { loadSettings, type AppSettings } from "./config/settings.js";
import { defaultFlowsFile, defaultSettingsFile, paperkiteHome } from "./config/paths.js";
import { AppLogger } from "./engine/logger.js";
import { Runtime } from "./engine/runtime.js";
import { loadExtensions, createUsageMarker } from "./extensions/loader.js";
import { configureTelegramClientFactory } from "./telegram/client.js";
import { SessionPool } from "./telegram/pool.js";

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
  const settings = await loadSettings(options.settingsFile ?? defaultSettingsFile());
  const flowsFile = options.flowsFile ?? defaultFlowsFile();
  const catalog = await loadCatalog(flowsFile);
  const logger = new AppLogger(settings.logging.level, settings.logging.directory);
  configureTelegramClientFactory(settings, logger);
  const extensions = await loadExtensions(catalog.capabilityRefs(), { profile: options.profile, logger });
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
      markUsed: createUsageMarker(extensions.installed),
      reloadCatalog: () => loadCatalog(flowsFile)
    })
  };
}

export function defaultLockFile(): string {
  return join(paperkiteHome(), "paperkite.lock");
}
