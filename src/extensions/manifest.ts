import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CORE_POLICY,
  evaluateCompatibility,
  sdkDeclarations,
  type CompatibilityVerdict,
  type CoreAbiPolicy
} from "./abi.js";
import { compareVersions, isStableVersion, satisfiesRange } from "./semver.js";
import { paperkiteHome } from "../config/paths.js";
import { coreRoot } from "./loader.js";
import type { PluginSettings } from "../config/settings.js";

export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type HttpFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<HttpResponseLike>;

export const defaultFetch: HttpFetch = (url, init) => fetch(url, init);

export type ManifestOrigin = "online" | "cache" | "snapshot";

export interface BundleManifest {
  readonly name: string;
  readonly version?: string;
  readonly origin: ManifestOrigin;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

export interface PackumentVersion {
  readonly version?: string;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
}

export interface Packument {
  readonly name?: string;
  readonly distTags: Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, PackumentVersion>>;
  readonly time: Readonly<Record<string, string>>;
}

export interface ReleasePolicy {
  readonly minimumReleaseAgeMinutes: number;
  readonly exclude: readonly string[];
}

export interface VersionChoice {
  readonly version: string;
  readonly verdict: CompatibilityVerdict;
}

export interface ManifestOptions {
  readonly settings: PluginSettings;
  readonly offline?: boolean;
  readonly refresh?: boolean;
  readonly fetch?: HttpFetch;
  readonly now?: () => number;
  readonly cacheDir?: string;
}

interface CachedManifest {
  readonly source: string;
  readonly etag?: string;
  readonly fetchedAt: string;
  readonly name: string;
  readonly version?: string;
  readonly dependencies: Record<string, string>;
}

interface CachedPackument {
  readonly fetchedAt: string;
  readonly packument: Packument;
}

/** core 随包携带的离线快照；读取失败按空清单处理。 */
export async function readSnapshot(file = join(coreRoot(), "bundles.json")): Promise<BundleManifest> {
  try {
    const document = JSON.parse(await readFile(file, "utf8")) as unknown;
    const parsed = parseManifestDocument(document);
    return { ...parsed, origin: "snapshot", warnings: [] };
  } catch (error) {
    return {
      name: "",
      origin: "snapshot",
      dependencies: {},
      warnings: ["built-in bundle snapshot is unreadable: " + detailOf(error)]
    };
  }
}

export function parseManifestDocument(document: unknown): { name: string; version?: string; dependencies: Record<string, string> } {
  if (!isRecord(document)) throw new Error("bundle manifest is not an object");
  const name = typeof document.name === "string" ? document.name : "";
  const version = typeof document.version === "string" ? document.version : undefined;
  const dependencies = parseDependencyRecord(document.dependencies);
  if (!Object.keys(dependencies).length) throw new Error("bundle manifest declares no dependencies");
  return { name, version, dependencies };
}

export async function readBundleManifest(options: ManifestOptions): Promise<BundleManifest> {
  const settings = options.settings;
  const source = settings.manifest.trim();
  const snapshot = await readSnapshot();
  if (!source) {
    return { ...snapshot, warnings: ["no bundle manifest configured; using the built-in snapshot"] };
  }
  const cacheFile = join(cacheDirectory(options), "bundle-manifest.json");
  const cached = await readJson<CachedManifest>(cacheFile);
  const usable = cached && cached.source === source ? cached : undefined;
  if (options.offline) {
    return usable
      ? { ...usable, origin: "cache", warnings: [] }
      : { ...snapshot, warnings: ["offline: using the built-in snapshot for " + source] };
  }
  if (usable && !options.refresh && fresh(usable.fetchedAt, settings.manifestTtlHours, options.now)) {
    return { ...usable, origin: "cache", warnings: [] };
  }
  try {
    const response = await request(source, settings, usable?.etag, options.fetch ?? defaultFetch);
    if (response.status === 304 && usable) {
      const refreshed: CachedManifest = { ...usable, fetchedAt: new Date().toISOString() };
      await writeJson(cacheFile, refreshed);
      return { ...refreshed, origin: "cache", warnings: [] };
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    const parsed = parseManifestDocument(response.document);
    await writeJson(cacheFile, {
      source,
      etag: response.etag,
      fetchedAt: new Date().toISOString(),
      name: parsed.name,
      version: parsed.version,
      dependencies: parsed.dependencies
    } satisfies CachedManifest);
    return { ...parsed, origin: "online", warnings: [] };
  } catch (error) {
    const detail = detailOf(error);
    if (usable) {
      return {
        ...usable,
        origin: "cache",
        warnings: ["bundle manifest refresh failed (" + detail + "); using the cached manifest"]
      };
    }
    return {
      ...snapshot,
      warnings: ["bundle manifest unavailable (" + detail + "); using the built-in snapshot"]
    };
  }
}

interface ManifestResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly etag?: string;
  readonly document?: unknown;
}

async function request(
  source: string,
  settings: PluginSettings,
  etag: string | undefined,
  fetcher: HttpFetch
): Promise<ManifestResponse> {
  const headers: Record<string, string> = etag ? { "if-none-match": etag } : {};
  if (isHttpSource(source)) {
    const response = await fetcher(source, { headers: { ...headers, accept: "application/json" } });
    return {
      ok: response.ok,
      status: response.status,
      etag: response.headers.get("etag") ?? undefined,
      document: response.ok ? await response.json() : undefined
    };
  }
  const response = await fetcher(registryUrl(settings.registry, source), {
    headers: { ...headers, accept: "application/vnd.npm.install-v1+json" }
  });
  if (response.status === 304) return { ok: false, status: 304, etag };
  if (!response.ok) return { ok: false, status: response.status };
  return {
    ok: true,
    status: response.status,
    etag: response.headers.get("etag") ?? undefined,
    document: latestRelease(parsePackument(await response.json()))
  };
}

/** 插件版本的 packument；离线时只读缓存。 */
export async function readPackument(
  name: string,
  options: ManifestOptions & { release?: ReleasePolicy }
): Promise<Packument> {
  const cacheFile = join(cacheDirectory(options), "packuments", safeName(name) + ".json");
  const cached = await readJson<CachedPackument>(cacheFile);
  if (options.offline) {
    if (cached) return cached.packument;
    throw new Error("offline: no cached packument for " + name);
  }
  if (cached && !options.refresh && fresh(cached.fetchedAt, options.settings.manifestTtlHours, options.now)) {
    return cached.packument;
  }
  const fetcher = options.fetch ?? defaultFetch;
  const full = (options.release?.minimumReleaseAgeMinutes ?? 0) > 0;
  const response = await fetcher(registryUrl(options.settings.registry, name), {
    headers: { accept: full ? "application/json" : "application/vnd.npm.install-v1+json" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " for " + name);
  const packument = parsePackument(await response.json());
  await writeJson(cacheFile, { fetchedAt: new Date().toISOString(), packument } satisfies CachedPackument);
  return packument;
}

/** 范围内满足 ABI 的最高稳定版；被 core 拒绝的版本排除。 */
export function selectPluginVersion(
  packument: Packument,
  range: string,
  options: {
    readonly name?: string;
    readonly policy?: CoreAbiPolicy;
    readonly release?: ReleasePolicy;
    readonly now?: () => number;
  } = {}
): VersionChoice | undefined {
  const policy = options.policy ?? CORE_POLICY;
  const release = options.release;
  const now = (options.now ?? Date.now)();
  const candidates = Object.entries(packument.versions)
    .filter(([version]) => isStableVersion(version) && satisfiesRange(version, range))
    .sort(([left], [right]) => compareVersions(right, left));
  for (const [version, manifest] of candidates) {
    if (release && excludedByAge(version, options.name, packument, release, now)) continue;
    const verdict = evaluateCompatibility(sdkDeclarations(manifest), policy);
    if (verdict.verdict === "reject") continue;
    return { version, verdict };
  }
  return undefined;
}

function excludedByAge(
  version: string,
  name: string | undefined,
  packument: Packument,
  release: ReleasePolicy,
  now: number
): boolean {
  if (!release.minimumReleaseAgeMinutes) return false;
  if (name && release.exclude.includes(name)) return false;
  const published = packument.time[version];
  if (!published) return true;
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return true;
  return now - at < release.minimumReleaseAgeMinutes * 60_000;
}

/** 清单 scope 之外的名字跳过；默认只接受 `@paperkite/`。 */
export function filterScopes(
  dependencies: Readonly<Record<string, string>>,
  scopes: readonly string[]
): { readonly accepted: Record<string, string>; readonly skipped: readonly string[] } {
  const accepted: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [name, range] of Object.entries(dependencies)) {
    if (scopes.some((scope) => name.startsWith(scope))) accepted[name] = range;
    else skipped.push(name);
  }
  return { accepted, skipped };
}

/** 与 pnpm 对齐的供应链延迟设置，取自 profile 的 pnpm-workspace.yaml。 */
export async function readReleasePolicy(directory: string): Promise<ReleasePolicy> {
  try {
    const data = parseYaml(await readFile(join(directory, "pnpm-workspace.yaml"), "utf8")) as unknown;
    if (!isRecord(data)) return { minimumReleaseAgeMinutes: 0, exclude: [] };
    const age = Number(data.minimumReleaseAge ?? 0);
    const exclude = Array.isArray(data.minimumReleaseAgeExclude)
      ? data.minimumReleaseAgeExclude.filter((item): item is string => typeof item === "string")
      : [];
    return {
      minimumReleaseAgeMinutes: Number.isFinite(age) && age > 0 ? age : 0,
      exclude
    };
  } catch {
    return { minimumReleaseAgeMinutes: 0, exclude: [] };
  }
}

export function cacheDirectory(options: { readonly cacheDir?: string } = {}): string {
  return options.cacheDir ?? join(paperkiteHome(), "cache");
}

function registryUrl(registry: string, name: string): string {
  const base = (registry.trim() || "https://registry.npmjs.org").replace(/\/+$/, "");
  return base + "/" + encodeURIComponent(name);
}

function isHttpSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function parsePackument(document: unknown): Packument {
  if (!isRecord(document)) throw new Error("packument is not an object");
  const versions = isRecord(document.versions) ? (document.versions as Record<string, PackumentVersion>) : {};
  const distTags = isRecord(document["dist-tags"])
    ? Object.fromEntries(
        Object.entries(document["dist-tags"]).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    : {};
  const time = isRecord(document.time)
    ? Object.fromEntries(
        Object.entries(document.time).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      )
    : {};
  return {
    name: typeof document.name === "string" ? document.name : undefined,
    versions,
    distTags,
    time
  };
}

function latestRelease(packument: Packument): { name: string; version?: string; dependencies: Record<string, string> } {
  const latest = packument.distTags.latest;
  const entry = latest ? packument.versions[latest] : undefined;
  if (!entry) throw new Error("packument declares no latest release");
  const dependencies = parseDependencyRecord(entry.dependencies);
  if (!Object.keys(dependencies).length) throw new Error("latest release declares no dependencies");
  return { name: packument.name ?? "", version: entry.version ?? latest, dependencies };
}

function parseDependencyRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const dependencies: Record<string, string> = {};
  for (const [name, range] of Object.entries(value)) {
    if (typeof range === "string" && range.trim()) dependencies[name] = range.trim();
  }
  return dependencies;
}

function fresh(fetchedAt: string, ttlHours: number, now: () => number = Date.now): boolean {
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return false;
  return now() - at < Math.max(0, ttlHours) * 3_600_000;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function safeName(name: string): string {
  return name.replace(/[^0-9A-Za-z._-]+/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
