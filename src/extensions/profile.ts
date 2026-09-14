import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { paperkiteHome } from "../config/paths.js";

export const PROFILE_WORKSPACE = "packages:\n  - .\n";

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

export async function ensureProfile(profile = "default"): Promise<string> {
  const directory = profileDirectory(profile);
  await mkdir(directory, { recursive: true });
  const current = await readProfile(directory);
  if (!Object.keys(current).length) await writeProfile(directory, defaultProfileManifest(profile));
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
