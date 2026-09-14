import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ActionConstructor,
  ConfigValidator,
  PluginCapability,
  PluginInfo,
  PluginModule,
  ServiceConstructor,
  TriggerConstructor
} from "@paperkite/sdk";
import { CapabilityRegistry } from "./registry.js";
import { bundleRanges, profileDirectory, readProfile, userPlugins } from "./profile.js";
import { evaluateCompatibility, sdkDeclarations, type CompatibilityVerdict } from "./abi.js";

interface PackagePluginMeta {
  readonly plugin?: boolean | { readonly capabilities?: readonly PluginCapability[] };
  readonly capabilities?: readonly PluginCapability[];
}

interface PackageManifest {
  readonly version?: string;
  readonly exports?: unknown;
  readonly main?: string;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly paperkite?: PackagePluginMeta;
}

export type PluginSource = "manifest" | "user";

export interface InstalledPluginView {
  readonly name: string;
  readonly source: PluginSource;
  readonly root: "profile" | "core" | "missing";
  readonly version?: string;
  readonly range?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly compatibility?: CompatibilityVerdict;
  readonly warning?: string;
}

export interface LoadedExtensions {
  readonly registry: CapabilityRegistry;
  readonly packages: readonly string[];
  readonly installed: readonly PluginInfo[];
  readonly warnings: readonly string[];
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

/** 日志与注册作用域使用包短名（`@paperkite/plugin-messages-watch` → `messages-watch`）。 */
function shortPluginName(name: string): string {
  return name.replace(/^@[^/]+\/plugin-/, "");
}

export async function loadExtensions(
  references: Iterable<string>,
  options: { profile?: string } = {}
): Promise<LoadedExtensions> {
  const profile = profileDirectory(options.profile ?? "default");
  const inspections = await inspectProfile(profile);
  const candidates = inspections.flatMap((inspection) => {
    if (inspection.error) throw new Error(inspection.error);
    return inspection.candidate ? [inspection.candidate] : [];
  });

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
  const warnings = inspections.flatMap((inspection) => (inspection.warning ? [inspection.warning] : []));
  return { registry, packages: [...selected.keys()], installed, warnings };
}

/** profile 优先、core 根兜底的插件发现结果，供 `plugin list` 与加载共用。 */
export async function inspectPlugins(profile = "default"): Promise<readonly InstalledPluginView[]> {
  const directory = profileDirectory(profile);
  const inspections = await inspectProfile(directory);
  return inspections.map((inspection) => ({
    name: inspection.name,
    source: inspection.source,
    root: inspection.root,
    version: inspection.version,
    range: inspection.range,
    capabilities: inspection.capabilities ?? [],
    compatibility: inspection.compatibility,
    warning: inspection.warning ?? inspection.error
  }));
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
  const handler = module[capability.handler];
  assertHandlerShape(handler, candidate.name, capability.handler, capability.name);
  const validateConfig = resolveValidator(module, capability, candidate.name);
  registry.register(
    capability.kind,
    capability.name,
    handler as ActionConstructor | TriggerConstructor | ServiceConstructor,
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

function assertHandlerShape(
  handler: unknown,
  pluginName: string,
  handlerName: string,
  capabilityName: string
): void {
  if (isHandlerConstructor(handler)) return;
  throw new Error(
    "plugin " + pluginName + " handler " + handlerName + " for capability " + capabilityName +
    " must be a class whose prototype exposes run"
  );
}

/** handler 类别由结构判定：导出符号为函数，其原型带有 run。 */
export function isHandlerConstructor(value: unknown): value is Function {
  if (typeof value !== "function") return false;
  const prototype = (value as { prototype?: { run?: unknown } }).prototype;
  return typeof prototype?.run === "function";
}

interface PluginCandidate {
  readonly name: string;
  readonly version?: string;
  readonly moduleUrl: string;
  readonly capabilities: readonly PluginCapability[];
}

interface PluginInspection {
  readonly name: string;
  readonly source: PluginSource;
  readonly root: "profile" | "core" | "missing";
  readonly range?: string;
  readonly version?: string;
  readonly capabilities?: readonly PluginCapability[];
  readonly compatibility?: CompatibilityVerdict;
  readonly warning?: string;
  readonly error?: string;
  readonly candidate?: PluginCandidate;
}

interface PluginRequest {
  readonly name: string;
  readonly source: PluginSource;
  readonly range?: string;
}

/** 候选集：profile 声明的用户插件、清单接管的插件与 core 快照里的内置插件。 */
async function inspectProfile(profile: string): Promise<readonly PluginInspection[]> {
  const profileManifest = await readProfile(profile);
  const managed = bundleRanges(profileManifest);
  const requests = new Map<string, PluginRequest>();
  for (const name of userPlugins(profileManifest)) requests.set(name, { name, source: "user" });
  for (const [name, range] of Object.entries(managed)) requests.set(name, { name, source: "manifest", range });
  for (const name of await readBundles()) {
    const existing = requests.get(name);
    requests.set(name, { name, source: "manifest", range: existing?.range ?? managed[name] });
  }
  const inspections: PluginInspection[] = [];
  for (const request of [...requests.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    inspections.push(await inspectPlugin(request, profile));
  }
  return inspections;
}

async function inspectPlugin(request: PluginRequest, profile: string): Promise<PluginInspection> {
  const packageFile = resolvePackageJson(request.name, profile);
  if (!packageFile) {
    return {
      name: request.name,
      source: request.source,
      root: "missing",
      range: request.range,
      warning:
        request.source === "manifest"
          ? "bundled plugin " + request.name + " is not installed; run paperkite plugin sync"
          : "plugin " + request.name + " is declared but not installed; run paperkite plugin add " + request.name
    };
  }
  const base: Pick<PluginInspection, "name" | "source" | "range" | "root"> = {
    name: request.name,
    source: request.source,
    range: request.range,
    root: resolvesInside(profile, packageFile) ? "profile" : "core"
  };
  try {
    const manifest = JSON.parse(await readFile(packageFile, "utf8")) as PackageManifest;
    const metadata = manifest.paperkite;
    if (!metadata?.plugin) {
      return { ...base, warning: "dependency " + request.name + " declares no paperkite.plugin metadata; skipped" };
    }
    const pluginObject = typeof metadata.plugin === "object" ? metadata.plugin : {};
    const capabilities = pluginObject.capabilities ?? metadata.capabilities ?? [];
    if (!Array.isArray(capabilities)) throw new Error("invalid capability metadata in " + request.name);
    const compatibility = evaluateCompatibility(sdkDeclarations(manifest));
    const version = typeof manifest.version === "string" ? manifest.version : undefined;
    if (compatibility.verdict === "reject") {
      return {
        ...base,
        version,
        capabilities,
        compatibility,
        error: "plugin " + request.name + " is incompatible: " + compatibility.detail
      };
    }
    return {
      ...base,
      version,
      capabilities,
      compatibility,
      warning:
        compatibility.verdict === "warn"
          ? "plugin " + request.name + " compatibility warning: " + compatibility.detail
          : undefined,
      candidate: {
        name: request.name,
        version,
        moduleUrl: resolvePluginModule(manifest, dirname(packageFile), request.name),
        capabilities
      }
    };
  } catch (error) {
    return {
      ...base,
      error: "failed to inspect plugin " + request.name + ": " + (error instanceof Error ? error.message : String(error))
    };
  }
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

/** profile 优先，core 根兜底；开发工作区与 `pnpm dev` 走兜底。 */
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

/** 解析结果与 profile 都取真实路径比较，符号链接目录下的临时 profile 也判定为 profile。 */
function resolvesInside(profile: string, packageFile: string): boolean {
  try {
    return realpathSync(packageFile).startsWith(realpathSync(profile) + sep);
  } catch {
    return false;
  }
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
