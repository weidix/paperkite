import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  const root = coreRoot();
  if (root !== process.cwd()) {
    logger.warn(`running from ${root} while cwd is ${process.cwd()}; plugin paths resolve from the install root`);
  }
  const heal = await healModuleFallback();
  for (const change of heal.changes) logger.debug(`shared fallback ${change.kind} ${change.name} -> ${change.target ?? "-"}`);
  for (const warning of heal.warnings) logger.warn(warning);
  const extensions = await loadExtensions(catalog.capabilityRefs(), {
    profile: options.profile,
    strict: settings.plugins.strict
  });
  for (const warning of extensions.warnings) logger.warn(warning);
  const sessions = new SessionPool(settings, logger);
  const build = {
    version: readCoreVersion(root),
    root,
    source: fileURLToPath(import.meta.url).endsWith(".ts") ? "src" as const : "dist" as const
  };
  return {
    settings,
    logger,
    runtime: new Runtime({
      catalog,
      registry: extensions.registry,
      sessions,
      logger,
      installed: extensions.installed,
      build,
      markUsed: createUsageMarker(extensions.installed),
      reloadCatalog: () => loadCatalog(flowsFile),
      reloadExtensions: (references) => loadExtensions(references, { profile: options.profile, strict: settings.plugins.strict })
    })
  };
}

function readCoreVersion(root: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function defaultLockFile(): string {
  return join(paperkiteHome(), "paperkite.lock");
}
