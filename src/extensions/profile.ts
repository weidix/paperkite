import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { paperkiteHome } from "../config/paths.js";

export const PROFILE_WORKSPACE = "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n";

/** profile 目录与共享目录之间的中间层；插件向上查找命中 core 的依赖闭包。 */
export function profilesDirectory(): string {
  return resolve(paperkiteHome(), "profiles");
}

export async function readProfileWorkspace(directory: string): Promise<string | undefined> {
  try {
    return await readFile(join(directory, "pnpm-workspace.yaml"), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** 已存在的 pnpm 设置缺少共享闭包所需的选项时给出的重建路径。 */
export function profileWorkspaceMigration(profile: string): string {
  const directory = profileDirectory(profile);
  return (
    "paperkite: " + profile + " keeps its existing pnpm-workspace.yaml; plugins resolve host-owned " +
    "packages from " + directory + "/node_modules unless that file sets nodeLinker: hoisted and " +
    "autoInstallPeers: false. Rebuild the profile (remove " + directory + " and run paperkite init) " +
    "or add both options to that file\n"
  );
}

export function defaultProfileManifest(profile: string): ProfileManifest {
  return {
    name: "paperkite-profile-" + profile,
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: {},
    paperkite: { profile: { plugins: [], bundles: {} } }
  };
}

export function profileDirectory(profile = "default"): string {
  return resolve(paperkiteHome(), "profiles", profile);
}

export interface ProfileInit {
  readonly directory: string;
  /** 本次调用新建了 profile 目录，pnpm 设置由此处写入。 */
  readonly created: boolean;
  /** 已有 pnpm 设置与当前布局不符时给出重建或迁移路径。 */
  readonly migration?: string;
}

export async function ensureProfile(profile = "default"): Promise<ProfileInit> {
  const directory = profileDirectory(profile);
  const created = !(await exists(directory));
  await mkdir(directory, { recursive: true });
  const current = await readProfile(directory);
  if (!Object.keys(current).length) await writeProfile(directory, defaultProfileManifest(profile));
  const workspace = await readProfileWorkspace(directory);
  if (workspace === undefined) await writeFile(join(directory, "pnpm-workspace.yaml"), PROFILE_WORKSPACE, "utf8");
  if (created || workspace === PROFILE_WORKSPACE) return { directory, created };
  return { directory, created, migration: profileWorkspaceMigration(profile) };
}

export interface ProfileManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly paperkite?: {
    readonly profile?: {
      readonly plugins?: readonly string[];
      readonly bundles?: Readonly<Record<string, string>>;
    };
  };
  [key: string]: unknown;
}

/** 由清单管理的插件与范围；sync 只管理这一段。 */
export function bundleRanges(manifest: ProfileManifest): Record<string, string> {
  const bundles = manifest.paperkite?.profile?.bundles;
  if (typeof bundles !== "object" || bundles === null || Array.isArray(bundles)) return {};
  const ranges: Record<string, string> = {};
  for (const [name, range] of Object.entries(bundles)) {
    if (typeof range === "string" && range.trim()) ranges[name] = range.trim();
  }
  return ranges;
}

/** 用户显式安装的插件名，清单接管的同名条目不再计入。 */
export function userPlugins(manifest: ProfileManifest): readonly string[] {
  const declared = manifest.paperkite?.profile?.plugins;
  if (!Array.isArray(declared)) return [];
  const managed = new Set(Object.keys(bundleRanges(manifest)));
  return declared.filter((name): name is string => typeof name === "string" && Boolean(name.trim()) && !managed.has(name));
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
