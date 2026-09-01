import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { profileDirectory, type ProfileManifest } from "./profile.js";

export function managePlugins(profile: string, args: readonly string[]): number {
  const directory = profileDirectory(profile);
  initProfileSync(directory, profile);
  const before = readProfileSync(directory);
  const anchored = args.map((value) => anchorPath(value, process.cwd()));
  const result = spawnSync("pnpm", anchored, {
    cwd: directory,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write("paperkite: pnpm is required for plugin management\n");
      return 127;
    }
    process.stderr.write("paperkite: " + formatError(result.error) + "\n");
    return 1;
  }
  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    process.stderr.write("paperkite: pnpm failed in " + directory + "\n");
    return exitCode;
  }
  reconcileProfileSync(directory, before);
  return 0;
}

function initProfileSync(directory: string, profile: string): void {
  mkdirSync(directory, { recursive: true });
  const packagePath = join(directory, "package.json");
  if (!existsSync(packagePath)) {
    writeFileSync(
      packagePath,
      JSON.stringify(
        {
          name: "paperkite-profile-" + profile,
          version: "0.0.0",
          private: true,
          type: "module",
          dependencies: {},
          paperkite: { profile: { plugins: [] } }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }
  const workspacePath = join(directory, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    writeFileSync(workspacePath, "packages:\n  - .\n\nautoInstallPeers: false\n", "utf8");
  }
}

function reconcileProfileSync(directory: string, before: ProfileManifest): void {
  const after = readProfileSync(directory);
  const dependencies = Object.keys(after.dependencies ?? {});
  const previous = new Set(Object.keys(before.dependencies ?? {}));
  const configured = [...(after.paperkite?.profile?.plugins ?? [])];
  let changed = false;
  for (const dependency of dependencies) {
    const plugin = readPluginMeta(dependency, directory);
    if (plugin && !configured.includes(dependency)) {
      configured.push(dependency);
      changed = true;
    } else if (!plugin && !previous.has(dependency)) {
      process.stderr.write(
        "paperkite: " + dependency + " has no plugin declaration; kept as a normal dependency\n"
      );
    }
  }
  const dependencySet = new Set(dependencies);
  for (const name of [...configured]) {
    if (!dependencySet.has(name) || !readPluginMeta(name, directory)) {
      configured.splice(configured.indexOf(name), 1);
      changed = true;
    }
  }
  if (!changed) return;
  writeProfileSync(directory, {
    ...after,
    paperkite: {
      ...(after.paperkite ?? {}),
      profile: { ...(after.paperkite?.profile ?? {}), plugins: configured }
    }
  });
}

function readPluginMeta(name: string, directory: string): unknown {
  try {
    const packageJson = resolvePackageJson(name, directory);
    if (!packageJson) return undefined;
    const value = JSON.parse(readFileSync(packageJson, "utf8")) as {
      paperkite?: { plugin?: unknown };
    };
    return value.paperkite?.plugin;
  } catch {
    return undefined;
  }
}

function resolvePackageJson(name: string, directory: string): string | undefined {
  const candidates = [
    join(directory, "node_modules", name, "package.json"),
    join(process.cwd(), "node_modules", name, "package.json")
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function anchorPath(value: string, cwd: string): string {
  const match = /^(?:(file|link):)?(\.\.?[\\/].*)$/.exec(value);
  if (!match?.[2]) return value;
  return (match[1] ? match[1] + ":" : "") + resolve(cwd, match[2]);
}

function readProfileSync(directory: string): ProfileManifest {
  try {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as ProfileManifest;
  } catch {
    return {};
  }
}

function writeProfileSync(directory: string, value: ProfileManifest): void {
  writeFileSync(join(directory, "package.json"), JSON.stringify(value, null, 2) + "\n", "utf8");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
