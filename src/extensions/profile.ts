import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export function profileDirectory(profile = "default"): string {
  const home = process.env.PAPERKITE_HOME?.trim() || join(process.cwd(), "data", ".paperkite");
  return resolve(home, "profiles", profile);
}

export async function ensureProfile(profile = "default"): Promise<string> {
  const directory = profileDirectory(profile);
  await mkdir(directory, { recursive: true });
  const packagePath = join(directory, "package.json");
  try {
    await access(packagePath);
  } catch {
    await writeJson(packagePath, {
      name: "paperkite-profile-" + profile,
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {},
      paperkite: { profile: { plugins: [] } }
    });
  }
  const workspacePath = join(directory, "pnpm-workspace.yaml");
  try {
    await access(workspacePath);
  } catch {
    await writeFile(workspacePath, "packages:\n  - .\n\nautoInstallPeers: false\n", "utf8");
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
