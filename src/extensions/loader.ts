import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Action,
  Service,
  Trigger,
  type ActionConstructor,
  type CapabilityKind,
  type ConfigValidator,
  type PluginCapability,
  type PluginInfo,
  type PluginModule,
  type ServiceConstructor,
  type TriggerConstructor
} from "@paperkite/sdk";
import { CapabilityRegistry } from "./registry.js";
import { profileDirectory, readProfile } from "./profile.js";

interface PackagePluginMeta {
  readonly plugin?: boolean | { readonly capabilities?: readonly PluginCapability[] };
  readonly capabilities?: readonly PluginCapability[];
}

interface PackageManifest {
  readonly version?: string;
  readonly exports?: unknown;
  readonly main?: string;
  readonly paperkite?: PackagePluginMeta;
}

export interface LoadedExtensions {
  readonly registry: CapabilityRegistry;
  readonly packages: readonly string[];
  readonly installed: readonly PluginInfo[];
}

/** 按运行清单实际引用的能力标注插件使用状态，相同引用集合不重复计算。 */
export function createUsageMarker(
  installed: readonly PluginInfo[]
): (references: ReadonlySet<string>) => readonly PluginInfo[] {
  let signature: string | undefined;
  let marked = installed;
  return (references) => {
    const next = hashOf(references);
    if (next !== signature) {
      signature = next;
      marked = installed.map((plugin) => ({
        ...plugin,
        used: plugin.capabilities.some((capability) => references.has(capability.name))
      }));
    }
    return marked;
  };
}

function hashOf(values: ReadonlySet<string>): string {
  return [...values].sort().join("\u0000");
}

export async function loadExtensions(
  references: Iterable<string>,
  options: { profile?: string } = {}
): Promise<LoadedExtensions> {
  const profile = profileDirectory(options.profile ?? "default");
  const profileManifest = await readProfile(profile);
  const configured = Array.isArray(profileManifest.paperkite?.profile?.plugins)
    ? profileManifest.paperkite.profile.plugins
    : [];
  const bundles = new Set(await readBundles());
  const pluginNames = unique([...configured, ...bundles]);
  const candidates: PluginCandidate[] = [];
  for (const name of pluginNames) {
    const candidate = await inspectPlugin(name, profile, bundles.has(name));
    if (candidate) candidates.push(candidate);
  }

  const owners = new Map<string, PluginCandidate>();
  for (const candidate of candidates) {
    for (const capability of candidate.capabilities) {
      const previous = owners.get(capability.name);
      if (previous && previous.name !== candidate.name) {
        throw new Error(
          "capability " + capability.name + " is provided by both " + previous.name + " and " + candidate.name
        );
      }
      owners.set(capability.name, candidate);
    }
  }

  const selected = new Map<string, PluginCandidate>();
  for (const reference of references) {
    const candidate = owners.get(reference.trim());
    if (!candidate) {
      const available = [...owners.keys()].sort().join(", ");
      throw new Error("unknown capability " + reference + "; available: " + (available || "none"));
    }
    selected.set(candidate.name, candidate);
  }

  const registry = new CapabilityRegistry();
  for (const candidate of [...selected.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const module = await importPlugin(candidate);
    const scope = shortPluginName(candidate.name);
    for (const capability of candidate.capabilities) {
      bindCapability(registry, candidate, module, capability, scope);
    }
  }
  const installed: PluginInfo[] = [...candidates]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((candidate) => ({
      name: candidate.name,
      version: candidate.version,
      capabilities: candidate.capabilities,
      loaded: selected.has(candidate.name),
      used: false
    }));
  return { registry, packages: [...selected.keys()], installed };
}

function bindCapability(
  registry: CapabilityRegistry,
  candidate: PluginCandidate,
  module: PluginModule,
  capability: PluginCapability,
  scope: string
): void {
  if (!capability.handler) {
    throw new Error("plugin " + candidate.name + " capability " + capability.name + " has no handler symbol");
  }
  const constructor = module[capability.handler];
  if (typeof constructor !== "function") {
    throw new Error(
      "plugin " + candidate.name + " does not export handler " + capability.handler +
      " for capability " + capability.name
    );
  }
  assertConstructorKind(constructor, capability.kind, candidate.name, capability.name);
  const validateConfig = resolveValidator(module, capability, candidate.name);
  registry.register(
    capability.kind,
    capability.name,
    constructor as ActionConstructor | TriggerConstructor | ServiceConstructor,
    scope,
    { control: capability.control, validateConfig }
  );
}

/** 校验器按符号名从插件模块取出，与 handler 同一解析路径。 */
function resolveValidator(
  module: PluginModule,
  capability: PluginCapability,
  pluginName: string
): ConfigValidator | undefined {
  const declared = capability.validateConfig;
  if (declared === undefined) return undefined;
  const validator = typeof declared === "string" ? module[declared] : declared;
  if (typeof validator !== "function") {
    throw new Error(
      "plugin " + pluginName + " does not export validator " + String(declared) +
      " for capability " + capability.name
    );
  }
  return validator as ConfigValidator;
}

function assertConstructorKind(
  constructor: Function,
  kind: CapabilityKind,
  pluginName: string,
  capabilityName: string
): void {
  const base = kind === "action" ? Action : kind === "trigger" ? Trigger : Service;
  if (!(constructor.prototype instanceof base)) {
    throw new Error(
      "plugin " + pluginName + " handler for capability " + capabilityName + " must extend " + kind
    );
  }
}

interface PluginCandidate {
  readonly name: string;
  readonly version?: string;
  readonly moduleUrl: string;
  readonly capabilities: readonly PluginCapability[];
}

async function inspectPlugin(name: string, profile: string, bundled: boolean): Promise<PluginCandidate | undefined> {
  const packageFile = bundled ? resolveCorePackageJson(name) : resolvePackageJson(name, profile);
  if (!packageFile) return undefined;
  const manifest = JSON.parse(await readFile(packageFile, "utf8")) as PackageManifest;
  const metadata = manifest.paperkite;
  if (!metadata?.plugin) return undefined;
  const pluginObject = typeof metadata.plugin === "object" ? metadata.plugin : {};
  const capabilities = pluginObject.capabilities ?? metadata.capabilities ?? [];
  if (!Array.isArray(capabilities)) throw new Error("invalid capability metadata in " + name);
  return {
    name,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
    moduleUrl: resolvePluginModule(manifest, dirname(packageFile), name),
    capabilities
  };
}

async function importPlugin(candidate: PluginCandidate): Promise<PluginModule> {
  try {
    return (await import(candidate.moduleUrl)) as PluginModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error("failed to load plugin " + candidate.name + ": " + detail);
  }
}

function resolvePluginModule(manifest: PackageManifest, packageDirectory: string, name: string): string {
  const entry = resolveEntry(manifest);
  if (!entry) {
    throw new Error("plugin " + name + " declares no resolvable entry under the current conditions");
  }
  return pathToFileURL(resolve(packageDirectory, entry)).href;
}

function resolveEntry(manifest: PackageManifest): string | undefined {
  if (typeof manifest.exports === "object" && manifest.exports !== null) {
    const entry = resolveConditionalEntry((manifest.exports as Record<string, unknown>)["."], runConditions());
    if (entry) return entry;
  }
  return manifest.main ?? "./index.js";
}

const EXACT_CONDITIONS = ["development", "node", "import", "default"] as const;

function runConditions(): readonly string[] {
  return developmentRequested() ? EXACT_CONDITIONS : EXACT_CONDITIONS.filter((condition) => condition !== "development");
}

function developmentRequested(): boolean {
  const tokens = [...process.argv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/)];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--conditions=development") return true;
    if (token === "--conditions" && tokens[index + 1] === "development") return true;
  }
  return false;
}

function resolveConditionalEntry(value: unknown, conditions: readonly string[]): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    if (!condition || !(condition in value)) continue;
    const match = resolveConditionalEntry((value as Record<string, unknown>)[condition], conditions.slice(index + 1));
    if (match) return match;
  }
  return undefined;
}

function resolvePackageJson(name: string, profile: string): string | undefined {
  const roots = [profile, coreRoot()];
  for (const root of roots) {
    try {
      return createRequire(join(root, "package.json")).resolve(name + "/package.json");
    } catch {
      continue;
    }
  }
  return undefined;
}

/** bundled 插件固定从运行时根解析，profile 与工作区链接不可覆盖。 */
function resolveCorePackageJson(name: string): string | undefined {
  try {
    return createRequire(join(coreRoot(), "package.json")).resolve(name + "/package.json");
  } catch {
    return undefined;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** 日志与注册作用域使用包短名（`@paperkite/plugin-messages-watch` → `messages-watch`）。 */
function shortPluginName(name: string): string {
  return name.replace(/^@[^/]+\/plugin-/, "");
}

interface CoreManifest {
  readonly paperkite?: { readonly bundles?: readonly string[] };
}

async function readBundles(): Promise<string[]> {
  try {
    const manifest = JSON.parse(await readFile(join(coreRoot(), "package.json"), "utf8")) as CoreManifest;
    const bundles = manifest.paperkite?.bundles;
    return Array.isArray(bundles)
      ? bundles.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
      : [];
  } catch {
    return [];
  }
}

export function coreRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return directory;
    directory = parent;
  }
}