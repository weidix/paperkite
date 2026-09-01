import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginCapability, PluginManifest, PluginModule, RuntimeLogger } from "@paperkite/sdk";
import { CapabilityRegistry } from "./registry.js";
import { BUILTIN_PLUGINS, profileDirectory, readProfile } from "./profile.js";

interface PackagePluginMeta {
  readonly plugin?: boolean | { readonly entry?: string; readonly capabilities?: readonly PluginCapability[] };
  readonly entry?: string;
  readonly capabilities?: readonly PluginCapability[];
}

interface PackageManifest {
  readonly paperkite?: PackagePluginMeta;
}

export interface LoadedExtensions {
  readonly registry: CapabilityRegistry;
  readonly packages: readonly string[];
}

export async function loadExtensions(
  references: Iterable<string>,
  options: { profile?: string; logger: RuntimeLogger }
): Promise<LoadedExtensions> {
  const profile = profileDirectory(options.profile ?? "default");
  const profileManifest = await readProfile(profile);
  const configured = Array.isArray(profileManifest.paperkite?.profile?.plugins)
    ? profileManifest.paperkite.profile.plugins
    : [];
  const pluginNames = unique([...BUILTIN_PLUGINS, ...configured]);
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
    const scopedLogger = options.logger.child(candidate.name);
    await module.register(registry.context(scopedLogger, candidate.name));
    assertManifestMatches(candidate, module.manifest);
  }
  return { registry, packages: [...selected.keys()] };
}

interface PluginCandidate {
  readonly name: string;
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
    packageDirectory: dirname(packageFile),
    entry,
    capabilities
  };
}

async function importPlugin(candidate: PluginCandidate): Promise<PluginModule> {
  const modulePath = resolve(candidate.packageDirectory, candidate.entry);
  const loaded = (await import(pathToFileURL(modulePath).href)) as Partial<PluginModule> & {
    default?: Partial<PluginModule>;
  };
  const module = loaded.register && loaded.manifest ? loaded : loaded.default;
  if (!module?.register || !module.manifest) throw new Error("invalid paperkite plugin: " + candidate.name);
  return module as PluginModule;
}

function assertManifestMatches(candidate: PluginCandidate, manifest: PluginManifest): void {
  if (manifest.name !== candidate.name) {
    throw new Error("plugin " + candidate.name + " exports manifest " + manifest.name);
  }
  if (!Array.isArray(manifest.capabilities)) {
    throw new Error("plugin " + candidate.name + " has invalid capabilities");
  }
  const declared = new Set(candidate.capabilities.map((item) => item.kind + ":" + item.name));
  const exported = new Set(manifest.capabilities.map((item) => item.kind + ":" + item.name));
  if (declared.size !== exported.size) {
    throw new Error("plugin " + candidate.name + " manifest does not match package metadata");
  }
  for (const capability of manifest.capabilities) {
    if (!declared.has(capability.kind + ":" + capability.name)) {
      throw new Error("plugin " + candidate.name + " exports undeclared capability " + capability.name);
    }
  }
  for (const capability of candidate.capabilities) {
    if (!exported.has(capability.kind + ":" + capability.name)) {
      throw new Error("plugin " + candidate.name + " package metadata declares missing capability " + capability.name);
    }
  }
}

function resolvePackageJson(name: string, profile: string): string | undefined {
  const roots = [profile, process.cwd()];
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
