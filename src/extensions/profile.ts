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
    paperkite: { profile: { plugins: [] } }
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
