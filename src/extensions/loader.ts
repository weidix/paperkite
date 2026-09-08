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
  type PluginCapability,
  type PluginInfo,
  type PluginModule,
  type ServiceConstructor,
  type TriggerConstructor
} from "@paperkite/sdk";
import { CapabilityRegistry } from "./registry.js";
import { profileDirectory, readProfile } from "./profile.js";

interface PackagePluginMeta {
  readonly plugin?: boolean | { readonly entry?: string; readonly capabilities?: readonly PluginCapability[] };
  readonly entry?: string;
  readonly capabilities?: readonly PluginCapability[];
}

interface PackageManifest {
  readonly version?: string;
  readonly paperkite?: PackagePluginMeta;
}

export interface LoadedExtensions {
  readonly registry: CapabilityRegistry;
  readonly packages: readonly string[];
  readonly installed: readonly PluginInfo[];
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
  const pluginNames = unique([...configured, ...(await readBundles())]);
  const candidates: PluginCandidate[] = [];
  for (const name of pluginNames) {
    const candidate = await inspectPlugin(name, profile);
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
      loaded: selected.has(candidate.name)
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
  registry.register(
    capability.kind,
    capability.name,
    constructor as ActionConstructor | TriggerConstructor | ServiceConstructor,
    scope,
    { control: capability.control }
  );
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
  readonly packageDirectory: string;
  readonly entry: string;
  readonly capabilities: readonly PluginCapability[];
}

async function inspectPlugin(name: string, profile: string): Promise<PluginCandidate | undefined> {
  const packageFile = resolvePackageJson(name, profile);
  if (!packageFile) return undefined;
  const manifest = JSON.parse(await readFile(packageFile, "utf8")) as PackageManifest;
  const metadata = manifest.paperkite;
  if (!metadata?.plugin) return undefined;
  const pluginObject = typeof metadata.plugin === "object" ? metadata.plugin : {};
  const entry = pluginObject.entry ?? metadata.entry ?? "./dist/index.js";
  const capabilities = pluginObject.capabilities ?? metadata.capabilities ?? [];
  if (!Array.isArray(capabilities)) throw new Error("invalid capability metadata in " + name);
  return {
    name,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
    packageDirectory: dirname(packageFile),
    entry,
    capabilities
  };
}

async function importPlugin(candidate: PluginCandidate): Promise<PluginModule> {
  const modulePath = resolve(candidate.packageDirectory, candidate.entry);
  return (await import(pathToFileURL(modulePath).href)) as PluginModule;
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

function coreRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return directory;
    directory = parent;
  }
}