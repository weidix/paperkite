import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { paperkiteHome } from "../config/paths.js";

export const SDK_PACKAGE = "@paperkite/sdk";

export const PROFILE_WORKSPACE = "packages:\n  - .\n\nautoInstallPeers: false\n";

export function defaultProfileManifest(profile: string): ProfileManifest {
  return {
    name: "paperkite-profile-" + profile,
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: {},
    paperkite: { profile: { plugins: [] } }
  };
}

/**
 * 插件以 peer 方式依赖 SDK，profile 需自带宿主运行的那一份，插件的导入才有解析目标。
 * 范围跟随宿主 SDK 版本，宿主升级后重新初始化 profile 即完成对齐。
 */
export function withSdkDependency(manifest: ProfileManifest): ProfileManifest {
  const range = sdkRange();
  if (!range) return manifest;
  const dependencies = { ...(manifest.dependencies ?? {}) };
  if (dependencies[SDK_PACKAGE] === range) return manifest;
  dependencies[SDK_PACKAGE] = range;
  return { ...manifest, dependencies };
}

function sdkRange(): string | undefined {
  try {
    const manifest = createRequire(import.meta.url).resolve(SDK_PACKAGE + "/package.json");
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? "^" + parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function profileDirectory(profile = "default"): string {
  return resolve(paperkiteHome(), "profiles", profile);
}

export async function ensureProfile(profile = "default"): Promise<string> {
  const directory = profileDirectory(profile);
  await mkdir(directory, { recursive: true });
  const current = await readProfile(directory);
  const manifest = Object.keys(current).length ? current : defaultProfileManifest(profile);
  const next = withSdkDependency(manifest);
  if (next !== manifest) await writeProfile(directory, next);
  const workspacePath = join(directory, "pnpm-workspace.yaml");
  try {
    await access(workspacePath);
  } catch {
    await writeFile(workspacePath, PROFILE_WORKSPACE, "utf8");
  }
  return directory;
}

export interface ProfileManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly paperkite?: {
    readonly profile?: { readonly plugins?: readonly string[] };
  };
  [key: string]: unknown;
}

export async function readProfile(directory: string): Promise<ProfileManifest> {
  try {
    const data = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as unknown;
    return isRecord(data) ? data : {};
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeProfile(directory: string, value: ProfileManifest): Promise<void> {
  await writeJson(join(directory, "package.json"), value);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
