import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  PROFILE_WORKSPACE,
  bundleRanges,
  defaultProfileManifest,
  ensureProfile,
  profileDirectory,
  readProfile,
  userPlugins,
  writeProfile,
  type ProfileManifest
} from "./profile.js";
import { acquireProcessLock } from "../control/process-lock.js";
import { healDependencyFallback } from "./dependency-fallback.js";
import { inspectPlugins, type InstalledPluginView, type PluginDeviation, type PluginSource } from "./loader.js";
import {
  filterScopes,
  readBundleManifest,
  readPackument,
  readReleasePolicy,
  selectPluginVersion,
  type HttpFetch,
  type ManifestOrigin,
  type ReleasePolicy
} from "./manifest.js";
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from "../config/settings.js";
import { parseRange, parseVersion, satisfiesRange } from "./semver.js";
import type { CompatibilityVerdict } from "./abi.js";

export type PnpmRunner = (args: readonly string[], cwd: string) => number | Promise<number>;

export interface SyncOptions {
  readonly settings?: PluginSettings;
  readonly refresh?: boolean;
  readonly offline?: boolean;
  readonly check?: boolean;
  readonly fetch?: HttpFetch;
  readonly runner?: PnpmRunner;
  readonly now?: () => number;
  readonly cacheDir?: string;
}

export interface SyncChange {
  readonly name: string;
  readonly version: string;
  readonly range: string;
}

export interface SyncResult {
  readonly origin: ManifestOrigin;
  readonly manifestVersion?: string;
  readonly added: readonly SyncChange[];
  readonly kept: readonly string[];
  readonly removed: readonly string[];
  readonly warnings: readonly string[];
  readonly problems: readonly string[];
  readonly applied: boolean;
}

export async function managePlugins(profile: string, args: readonly string[]): Promise<number> {
  const directory = profileDirectory(profile);
  initProfileSync(directory, profile);
  const before = readProfileSync(directory);
  const anchored = installArgs(args).map((value) => anchorPath(value, process.cwd()));
  const result = spawnSync("pnpm", anchored, {
    cwd: directory,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) {
    process.stderr.write(pnpmError(result.error));
    return (result.error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 1;
  }
  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    process.stderr.write("paperkite: pnpm failed in " + directory + "\n");
    return exitCode;
  }
  reconcileProfileSync(directory, before);
  for (const warning of await healDependencyFallback()) process.stderr.write("paperkite: " + warning + "\n");
  for (const view of await inspectPlugins(profile)) {
    if (view.warning) process.stderr.write("paperkite: " + view.warning + "\n");
  }
  return 0;
}

/** 按清单安装缺失的内置插件；已固定的版本与用户插件都不改动。 */
export async function syncBundles(profile = "default", options: SyncOptions = {}): Promise<SyncResult> {
  const settings = options.settings ?? DEFAULT_PLUGIN_SETTINGS;
  const { directory, migration } = await ensureProfile(profile);
  const release = await readReleasePolicy(directory);
  const lock = await acquireProcessLock(join(directory, ".paperkite-bundles.lock"));
  try {
    const manifest = await readBundleManifest({
      settings,
      offline: options.offline,
      refresh: options.refresh,
      fetch: options.fetch,
      now: options.now,
      cacheDir: options.cacheDir
    });
    const context: ResolveContext = {
      settings,
      release,
      offline: options.offline ?? false,
      refresh: options.refresh ?? false,
      fetch: options.fetch,
      now: options.now ?? Date.now,
      cacheDir: options.cacheDir,
      warnings: [...(migration ? [migration] : []), ...manifest.warnings],
      problems: []
    };
    const { accepted, skipped } = filterScopes(manifest.dependencies, settings.scopes);
    for (const name of skipped) {
      context.warnings.push(name + " is outside the configured bundle scopes; skipped");
    }
    const current = await readProfile(directory);
    const dependencies = { ...(current.dependencies ?? {}) };
    const managed = bundleRanges(current);
    const additions: SyncChange[] = [];
    const kept: string[] = [];
    for (const [name, range] of Object.entries(accepted)) {
      const spec = dependencies[name];
      const installed = installedVersion(directory, name);
      if (spec && installed && specSatisfied(spec, installed)) {
        kept.push(name);
        // 已固定的版本照样刷一次单包 packument：refresh 之后紧跟的 update 要看到新版本
        if (context.refresh) await resolveVersion(context, name, range);
        continue;
      }
      const pinned = spec && parseVersion(spec) ? spec : undefined;
      if (pinned && !satisfiesRange(pinned, range)) {
        context.warnings.push(
          name + " is pinned to " + pinned + ", outside " + range + "; run paperkite plugin update " + name
        );
      }
      const version = pinned ?? (await resolveVersion(context, name, range));
      if (!version) continue;
      additions.push({ name, version, range });
    }

    const removed = Object.keys(managed).filter((name) => !(name in accepted));
    const plugins = [...userPlugins(current)];
    for (const name of removed) {
      context.warnings.push(name + " is no longer managed by the bundle manifest; it stays installed");
      if (dependencies[name] && !plugins.includes(name)) plugins.push(name);
    }

    const bundles = Object.fromEntries(Object.entries(accepted).map(([name, range]) => [name, range]));
    const nextManifest: ProfileManifest = {
      ...current,
      dependencies: { ...dependencies, ...Object.fromEntries(additions.map((item) => [item.name, item.version])) },
      paperkite: {
        ...(current.paperkite ?? {}),
        profile: { ...(current.paperkite?.profile ?? {}), plugins: unique(plugins), bundles }
      }
    };
    const changed = JSON.stringify(nextManifest) !== JSON.stringify(current);
    if (options.check) {
      return {
        origin: manifest.origin,
        manifestVersion: manifest.version,
        added: additions,
        kept,
        removed,
        warnings: context.warnings,
        problems: context.problems,
        applied: false
      };
    }
    if (changed) await writeProfile(directory, nextManifest);
    if (additions.length) {
      const code = await (options.runner ?? runPnpm)(["install", "--ignore-scripts"], directory);
      if (code !== 0) context.problems.push("pnpm install failed in " + directory + " (exit " + code + ")");
      context.warnings.push(...(await healDependencyFallback()));
    }
    const applied = changed || additions.length > 0;
    return {
      origin: manifest.origin,
      manifestVersion: manifest.version,
      added: additions,
      kept,
      removed,
      warnings: context.warnings,
      problems: context.problems,
      applied
    };
  } finally {
    await lock.release();
  }
}

/** 重算清单管理插件的版本并前进；已是最新时不执行安装。 */
export async function updatePlugins(
  profile: string,
  names: readonly string[],
  options: SyncOptions = {}
): Promise<SyncResult> {
  const settings = options.settings ?? DEFAULT_PLUGIN_SETTINGS;
  const { directory, migration } = await ensureProfile(profile);
  const release = await readReleasePolicy(directory);
  const lock = await acquireProcessLock(join(directory, ".paperkite-bundles.lock"));
  try {
    const manifest = await readBundleManifest({
      settings,
      offline: options.offline,
      refresh: options.refresh,
      fetch: options.fetch,
      now: options.now,
      cacheDir: options.cacheDir
    });
    const context: ResolveContext = {
      settings,
      release,
      offline: options.offline ?? false,
      refresh: options.refresh ?? false,
      fetch: options.fetch,
      now: options.now ?? Date.now,
      cacheDir: options.cacheDir,
      warnings: [...(migration ? [migration] : []), ...manifest.warnings],
      problems: []
    };
    const accepted = filterScopes(manifest.dependencies, settings.scopes).accepted;
    const current = await readProfile(directory);
    const dependencies = { ...(current.dependencies ?? {}) };
    const managed = bundleRanges(current);
    const additions: SyncChange[] = [];
    const kept: string[] = [];
    for (const name of unique(names)) {
      const spec = dependencies[name];
      const range = managed[name] ?? accepted[name] ?? specRange(spec);
      if (!range) {
        context.problems.push(name + " has no upgradable range declared; nothing to update");
        continue;
      }
      const version = await resolveVersion(context, name, range);
      if (!version) continue;
      if (installedVersion(directory, name) === version && specSatisfied(spec, version)) {
        kept.push(name);
        continue;
      }
      additions.push({ name, version, range });
    }
    const nextManifest: ProfileManifest = {
      ...current,
      dependencies: { ...dependencies, ...Object.fromEntries(additions.map((item) => [item.name, item.version])) },
      paperkite: {
        ...(current.paperkite ?? {}),
        profile: {
          ...(current.paperkite?.profile ?? {}),
          plugins: [...userPlugins(current)],
          bundles: { ...managed, ...Object.fromEntries(additions.map((item) => [item.name, item.range])) }
        }
      }
    };
    const changed = JSON.stringify(nextManifest) !== JSON.stringify(current);
    const installs = additions.length > 0;
    if (!options.check) {
      if (changed) await writeProfile(directory, nextManifest);
      if (installs) {
        const code = await (options.runner ?? runPnpm)(["install", "--ignore-scripts"], directory);
        if (code !== 0) context.problems.push("pnpm install failed in " + directory + " (exit " + code + ")");
        context.warnings.push(...(await healDependencyFallback()));
      }
    }
    return {
      origin: manifest.origin,
      manifestVersion: manifest.version,
      added: additions,
      kept,
      removed: [],
      warnings: context.warnings,
      problems: context.problems,
      applied: !options.check && (changed || installs)
    };
  } finally {
    await lock.release();
  }
}

/** 每个插件一行：安装来源、可用版本、共享来源与三层诊断。 */
export interface PluginListEntry {
  readonly name: string;
  readonly source: PluginSource;
  readonly root: InstalledPluginView["root"];
  readonly version?: string;
  readonly range?: string;
  readonly available?: string;
  readonly compatibility?: CompatibilityVerdict;
  /** 该插件在 core 依赖闭包容忍下解析到的 host-owned 包。 */
  readonly shared: readonly string[];
  readonly capabilities: readonly string[];
  readonly deviations?: readonly PluginDeviation[];
  readonly note?: string;
}

/** profile 视图 + 清单可用版本，供 `plugin list` 输出。 */
export async function listPlugins(profile = "default", options: SyncOptions = {}): Promise<readonly PluginListEntry[]> {
  const settings = options.settings ?? DEFAULT_PLUGIN_SETTINGS;
  const directory = profileDirectory(profile);
  const views = await inspectPlugins(profile, settings.strict);
  const current = await readProfile(directory);
  const dependencies = current.dependencies ?? {};
  const manifest = await readBundleManifest({
    settings,
    offline: options.offline,
    refresh: options.refresh,
    fetch: options.fetch,
    now: options.now,
    cacheDir: options.cacheDir
  });
  const accepted = filterScopes(manifest.dependencies, settings.scopes).accepted;
  const warnings: string[] = [];
  const context: ResolveContext = {
    settings,
    release: await readReleasePolicy(directory),
    offline: options.offline ?? false,
    refresh: options.refresh ?? false,
    fetch: options.fetch,
    now: options.now ?? Date.now,
    cacheDir: options.cacheDir,
    warnings,
    problems: []
  };
  const entries: PluginListEntry[] = [];
  for (const view of views) {
    const range = view.range ?? accepted[view.name] ?? specRange(dependencies[view.name]);
    const available = range ? await resolveVersion(context, view.name, range) : undefined;
    const deviations = view.report?.deviations ?? [];
    entries.push({
      name: view.name,
      source: view.source,
      root: view.root,
      version: view.version,
      range,
      available,
      compatibility: view.compatibility,
      shared: view.shared,
      capabilities: view.capabilities.map((capability) => capability.name),
      deviations: deviations.length ? deviations : undefined,
      note: view.warning
    });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

interface ResolveContext {
  readonly settings: PluginSettings;
  readonly release: ReleasePolicy;
  readonly offline: boolean;
  readonly refresh: boolean;
  readonly fetch?: HttpFetch;
  readonly now: () => number;
  readonly cacheDir?: string;
  readonly warnings: string[];
  readonly problems: string[];
}

async function resolveVersion(context: ResolveContext, name: string, range: string): Promise<string | undefined> {
  try {
    const packument = await readPackument(name, {
      settings: context.settings,
      offline: context.offline,
      refresh: context.refresh,
      fetch: context.fetch,
      now: context.now,
      cacheDir: context.cacheDir,
      release: context.release
    });
    const choice = selectPluginVersion(packument, range, {
      name,
      release: context.release,
      now: context.now
    });
    if (!choice) {
      context.problems.push("no release of " + name + " satisfies " + range + " under this core");
      return undefined;
    }
    if (choice.verdict.verdict === "warn") context.warnings.push(choice.verdict.detail);
    return choice.version;
  } catch (error) {
    context.problems.push("cannot read releases of " + name + ": " + formatError(error));
    return undefined;
  }
}

function installedVersion(directory: string, name: string): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(directory, "node_modules", name, "package.json"), "utf8")
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

function specSatisfied(spec: string | undefined, version: string | undefined): boolean {
  if (!spec || !version) return false;
  return satisfiesRange(version, spec) || spec === version;
}

function specRange(spec: string | undefined): string | undefined {
  if (!spec || parseVersion(spec)) return undefined;
  return parseRange(spec) ? spec : undefined;
}

function runPnpm(args: readonly string[], cwd: string): number {
  const result = spawnSync("pnpm", [...args], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) {
    process.stderr.write(pnpmError(result.error));
    return (result.error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 1;
  }
  return result.status ?? 1;
}

function pnpmError(error: unknown): string {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return "paperkite: pnpm is required for plugin management\n";
  }
  return "paperkite: " + formatError(error) + "\n";
}

function initProfileSync(directory: string, profile: string): void {
  mkdirSync(directory, { recursive: true });
  const current = readProfileSync(directory);
  if (!Object.keys(current).length) writeProfileSync(directory, defaultProfileManifest(profile));
  const workspacePath = join(directory, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    writeFileSync(workspacePath, PROFILE_WORKSPACE, "utf8");
  }
}

/** 清单接管的依赖不属于用户插件清单，回填时跳过。 */
function reconcileProfileSync(directory: string, before: ProfileManifest): void {
  const after = readProfileSync(directory);
  const dependencies = Object.keys(after.dependencies ?? {});
  const previous = new Set(Object.keys(before.dependencies ?? {}));
  const managed = bundleRanges(after);
  const configured = [...userPlugins(after)];
  let changed = false;
  for (const dependency of dependencies) {
    if (dependency in managed) continue;
    const plugin = readPluginMeta(dependency, directory);
    if (plugin && !configured.includes(dependency)) {
      configured.push(dependency);
      changed = true;
    } else if (!plugin && !previous.has(dependency)) {
      process.stderr.write(
        "paperkite: " + dependency + " has no plugin declaration; kept as a normal dependency\n"
      );
    }
  }
  const dependencySet = new Set(dependencies);
  for (const name of [...configured]) {
    if (!dependencySet.has(name) || !readPluginMeta(name, directory)) {
      configured.splice(configured.indexOf(name), 1);
      changed = true;
    }
  }
  if (!changed) return;
  writeProfileSync(directory, {
    ...after,
    paperkite: {
      ...(after.paperkite ?? {}),
      profile: { ...(after.paperkite?.profile ?? {}), plugins: configured }
    }
  });
}

function readPluginMeta(name: string, directory: string): unknown {
  try {
    const packageJson = resolvePackageJson(name, directory);
    if (!packageJson) return undefined;
    const value = JSON.parse(readFileSync(packageJson, "utf8")) as {
      paperkite?: { plugin?: unknown };
    };
    return value.paperkite?.plugin;
  } catch {
    return undefined;
  }
}

function resolvePackageJson(name: string, directory: string): string | undefined {
  const candidates = [
    join(directory, "node_modules", name, "package.json"),
    join(process.cwd(), "node_modules", name, "package.json")
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** 安装类透传统一补 `--ignore-scripts`，用户显式传入的选项优先。 */
function installArgs(args: readonly string[]): readonly string[] {
  const verb = args[0];
  if (verb !== "add" && verb !== "install" && verb !== "i") return args;
  if (args.some((value) => value === "--ignore-scripts" || value === "--no-ignore-scripts")) return args;
  return [...args, "--ignore-scripts"];
}

function anchorPath(value: string, cwd: string): string {
  const match = /^(?:(file|link):)?(\.\.?[\\/].*)$/.exec(value);
  if (!match?.[2]) return value;
  return (match[1] ? match[1] + ":" : "") + resolve(cwd, match[2]);
}

function readProfileSync(directory: string): ProfileManifest {
  try {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as ProfileManifest;
  } catch {
    return {};
  }
}

function writeProfileSync(directory: string, value: ProfileManifest): void {
  writeFileSync(join(directory, "package.json"), JSON.stringify(value, null, 2) + "\n", "utf8");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
