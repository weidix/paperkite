import { join } from "node:path";
import { loadCatalog } from "./config/loader.js";
import { loadSettings, type AppSettings } from "./config/settings.js";
import { defaultFlowsFile, defaultSettingsFile, paperkiteHome } from "./config/paths.js";
import { AppLogger } from "./engine/logger.js";
import { Runtime } from "./engine/runtime.js";
import { coreRoot, loadExtensions, createUsageMarker } from "./extensions/loader.js";
import { healModuleFallback } from "./extensions/dependency-fallback.js";
import { configureTelegramClientFactory } from "./telegram/client.js";
import { SessionPool } from "./telegram/pool.js";

export interface CreateAppOptions {
  readonly profile?: string;
  readonly settingsFile?: string;
  readonly settings?: AppSettings;
  readonly flowsFile?: string;
}

export interface PaperkiteApp {
  readonly settings: AppSettings;
  readonly runtime: Runtime;
  readonly logger: AppLogger;
}

export async function createApp(options: CreateAppOptions = {}): Promise<PaperkiteApp> {
  const settings = options.settings ?? (await loadSettings(options.settingsFile ?? defaultSettingsFile()));
  const flowsFile = options.flowsFile ?? defaultFlowsFile();
  const catalog = await loadCatalog(flowsFile);
  const logger = new AppLogger(settings.logging.level, settings.logging.directory);
  configureTelegramClientFactory(settings, logger);
  const heal = await healModuleFallback();
  for (const change of heal.changes) logger.debug(`shared fallback ${change.kind} ${change.name} -> ${change.target ?? "-"}`);
  for (const warning of heal.warnings) logger.warn(warning);
  const extensions = await loadExtensions(catalog.capabilityRefs(), {
    profile: options.profile,
    strict: settings.plugins.strict
  });
  for (const warning of extensions.warnings) logger.warn(warning);
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
      reloadCatalog: () => loadCatalog(flowsFile),
      reloadExtensions: (references) => loadExtensions(references, { profile: options.profile, strict: settings.plugins.strict })
    })
  };
}

export function defaultLockFile(): string {
  return join(paperkiteHome(), "paperkite.lock");
}
