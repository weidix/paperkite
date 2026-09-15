import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { acquireProcessLock } from "../control/process-lock.js";
import { coreRoot } from "./loader.js";
import { profilesDirectory } from "./profile.js";

export const MODULE_FALLBACK_LOCK = ".paperkite-modules.lock";

export interface DependencyResolution {
  /** 包名到安装目录的真实路径。 */
  readonly links: ReadonlyMap<string, string>;
  /** 无法从其安装根解析到的包名。 */
  readonly unresolved: readonly string[];
}

export interface FallbackChange {
  readonly name: string;
  readonly kind: "linked" | "relinked" | "removed";
  /** 链接指向的安装目录；移除时为空。 */
  readonly target?: string;
}

export interface FallbackResult {
  readonly modulesDir: string;
  readonly changes: readonly FallbackChange[];
  readonly warnings: readonly string[];
}

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, unknown>;
}

/** 共享目录：所有 profile 向上查找 core 依赖闭包的落脚点。 */
export function moduleFallbackDirectory(): string {
  return join(profilesDirectory(), "node_modules");
}

/** core 持有的运行期包名集合；新增共享包时先把包加进 core 的 dependencies。 */
export function hostOwnedPackages(root = coreRoot()): readonly string[] {
  return [...coreDependencyClosure(join(root, "package.json")).links.keys()].sort();
}

/** 从 core 的安装清单出发，逐层读取各包声明的 dependencies。 */
export function coreDependencyClosure(anchor: string): DependencyResolution {
  const links = new Map<string, string>();
  const unresolved: string[] = [];
  const manifest = readManifest(anchor);
  if (!manifest) return { links, unresolved };
  const root = realDirectory(dirname(anchor));
  if (manifest.name) links.set(manifest.name, root);
  const queue: Array<{ anchor: string; dependencies: readonly string[] }> = [
    { anchor, dependencies: dependencyNames(manifest) }
  ];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const name of next.dependencies) {
      if (links.has(name) || unresolved.includes(name)) continue;
      const directory = resolveDependency(name, next.anchor, root);
      if (!directory) {
        unresolved.push(name);
        continue;
      }
      links.set(name, directory);
      const dependencyManifest = readManifest(join(directory, "package.json"));
      if (dependencyManifest) {
        queue.push({ anchor: join(directory, "package.json"), dependencies: dependencyNames(dependencyManifest) });
      }
    }
  }
  return { links, unresolved };
}

/** 幂等 heal：补齐链接、修正过期链接、清理指向失效目标的链接。 */
export async function healModuleFallback(root = coreRoot()): Promise<FallbackResult> {
  const resolution = coreDependencyClosure(join(root, "package.json"));
  return withModuleFallbackLock(async () => mirrorModuleFallback(moduleFallbackDirectory(), resolution));
}

/** heal 失败只作为告警返回，启动路径据此继续。 */
export async function healDependencyFallback(root = coreRoot()): Promise<readonly string[]> {
  try {
    return (await healModuleFallback(root)).warnings;
  } catch (error) {
    return ["dependency fallback heal failed: " + messageOf(error)];
  }
}

export async function mirrorModuleFallback(
  modulesDir: string,
  resolution: DependencyResolution
): Promise<FallbackResult> {
  mkdirSync(modulesDir, { recursive: true });
  const changes: FallbackChange[] = [];
  const warnings = resolution.unresolved.map(
    (name) => "dependency " + name + " is declared but not installed; the shared fallback omits it"
  );
  for (const [name, target] of resolution.links) {
    const link = join(modulesDir, name);
    const state = await reconcileLink(link, target);
    if (state === "blocked") {
      warnings.push(
        "shared fallback entry " + link + " is not a symlink; remove it so paperkite can mirror the core closure"
      );
      continue;
    }
    if (state !== "current") changes.push({ name, kind: state, target });
  }
  for (const name of pruneFallback(modulesDir, resolution.links)) changes.push({ name, kind: "removed" });
  return { modulesDir, changes, warnings };
}

/** 清理不在托管集合里的失效链接，并收走空 scope 目录。 */
export function pruneFallback(modulesDir: string, managed: ReadonlyMap<string, string>): readonly string[] {
  const removed: string[] = [];
  for (const name of ownedEntries(modulesDir)) {
    if (managed.has(name)) continue;
    const link = join(modulesDir, name);
    const target = symlinkTarget(link);
    if (target === undefined) continue;
    if (reachable(target)) continue;
    try {
      rmSync(link);
      removed.push(name);
    } catch {
      // 并发清理已经移除该链接
    }
  }
  for (const directory of scopeDirectories(modulesDir)) {
    try {
      if (readdirSync(directory).length === 0) rmSync(directory);
    } catch {
      // 并发清理已经移除该目录
    }
  }
  return removed;
}

/** 共享目录内的包名，含 scope 目录下的条目。 */
export function ownedEntries(modulesDir: string): readonly string[] {
  const names: string[] = [];
  for (const entry of readdirIfPresent(modulesDir)) {
    if (entry.startsWith("@") && isDirectory(join(modulesDir, entry))) {
      for (const child of readdirIfPresent(join(modulesDir, entry))) names.push(entry + "/" + child);
      continue;
    }
    names.push(entry);
  }
  return names;
}

export async function withModuleFallbackLock<T>(run: () => Promise<T>): Promise<T> {
  mkdirSync(profilesDirectory(), { recursive: true });
  const lock = await acquireProcessLock(join(profilesDirectory(), MODULE_FALLBACK_LOCK));
  try {
    return await run();
  } finally {
    await lock.release();
  }
}

async function reconcileLink(link: string, target: string): Promise<"current" | "linked" | "relinked" | "blocked"> {
  mkdirSync(dirname(link), { recursive: true });
  let existing;
  try {
    existing = lstatSync(link);
  } catch {
    existing = undefined;
  }
  if (existing === undefined) {
    symlinkSync(target, link);
    return "linked";
  }
  if (!existing.isSymbolicLink()) return "blocked";
  if (symlinkTarget(link) === canonical(target)) return "current";
  await unlink(link).catch(() => undefined);
  symlinkSync(target, link);
  return "relinked";
}

function scopeDirectories(modulesDir: string): readonly string[] {
  return readdirIfPresent(modulesDir)
    .filter((entry) => entry.startsWith("@") && isDirectory(join(modulesDir, entry)))
    .map((entry) => join(modulesDir, entry));
}

/**
 * 从 `anchor` 出发解析包目录；`anchor` 是某个包的 package.json，`root` 是安装根。
 * 逐层查找不走 require 缓存，core 升级后同一路径上的链接改写能立即被看到。
 */
function resolveDependency(name: string, anchor: string, root: string): string | undefined {
  for (let current = realDirectory(dirname(anchor)); ; ) {
    const candidate = join(current, "node_modules", name, "package.json");
    if (existsSync(candidate)) return realDirectory(dirname(candidate));
    if (current === root) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function dependencyNames(manifest: PackageManifest): readonly string[] {
  const declared = manifest.dependencies;
  if (typeof declared !== "object" || declared === null) return [];
  return Object.keys(declared);
}

function readManifest(anchor: string): PackageManifest | undefined {
  try {
    const value = JSON.parse(readFileSync(anchor, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return value as PackageManifest;
  } catch {
    return undefined;
  }
}

function realDirectory(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function symlinkTarget(link: string): string | undefined {
  try {
    if (!lstatSync(link).isSymbolicLink()) return undefined;
    const target = resolve(dirname(link), readlinkSync(link));
    return existsSync(target) ? canonical(target) : target;
  } catch {
    return undefined;
  }
}

function canonical(path: string): string {
  return realpathSync.native(resolve(path));
}

/** 链接目标存在才算有效；指向已消失目标的链接由清理阶段移除。 */
function reachable(path: string): boolean {
  return existsSync(path);
}

function readdirIfPresent(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
