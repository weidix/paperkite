import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Api, utils } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { coreRoot, diagnosePlugin, hostOwnedNames, loadExtensions } from "../src/extensions/loader.js";
import { coreDependencyClosure, healDependencyFallback, healModuleFallback, mirrorModuleFallback } from "../src/extensions/dependency-fallback.js";
import { ensureProfile, profileDirectory } from "../src/extensions/profile.js";

const TELEGRAM = "telegram";

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "paperkite-fallback-"));
  const previous = process.env.PAPERKITE_HOME;
  process.env.PAPERKITE_HOME = home;
  try {
    await run(home);
  } finally {
    if (previous === undefined) delete process.env.PAPERKITE_HOME;
    else process.env.PAPERKITE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

interface PackageSpec {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Record<string, string>;
}

/** 在指定目录下装出一份最小依赖树，模拟一个安装根。 */
async function writePackages(root: string, packages: readonly PackageSpec[]): Promise<void> {
  for (const spec of packages) {
    const directory = join(root, "node_modules", spec.name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: spec.name,
        version: spec.version,
        dependencies: spec.dependencies ?? {}
      }),
      "utf8"
    );
  }
}

async function writeCore(root: string, version: string): Promise<string> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "paperkite", version: "0.0.0", dependencies: { [TELEGRAM]: version } }),
    "utf8"
  );
  return root;
}

interface PluginSpec {
  readonly name: string;
  readonly capability: string;
  readonly handler: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly source?: string;
}

async function writePlugin(profile: string, spec: PluginSpec): Promise<string> {
  const directory = join(profile, "node_modules", spec.name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: spec.name,
      version: "1.0.0",
      type: "module",
      main: "./index.js",
      dependencies: spec.dependencies,
      peerDependencies: spec.peerDependencies,
      paperkite: { plugin: { capabilities: [{ kind: "action", name: spec.capability, handler: spec.handler }] } }
    }),
    "utf8"
  );
  await writeFile(
    join(directory, "index.js"),
    spec.source ?? `export class ${spec.handler} { async run() {} }\n`,
    "utf8"
  );
  return directory;
}

async function writeProfile(profile: string, plugins: readonly string[]): Promise<void> {
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, "package.json"),
    JSON.stringify({
      name: "paperkite-profile-test",
      version: "0.0.0",
      private: true,
      paperkite: { profile: { plugins } }
    }),
    "utf8"
  );
}

function canonical(path: string): string {
  return realpathSync.native(path);
}

function resolveFrom(directory: string, name: string): string {
  return createRequire(join(directory, "package.json")).resolve(name + "/package.json");
}

async function versionAt(file: string): Promise<string> {
  return (JSON.parse(await readFile(file, "utf8")) as { version: string }).version;
}

test("profile pnpm settings enable the hoisted shared layout", async () => {
  await withHome(async () => {
    const first = await ensureProfile("default");
    assert.equal(first.created, true);
    assert.equal(first.migration, undefined);
    const workspace = await readFile(join(first.directory, "pnpm-workspace.yaml"), "utf8");
    assert.match(workspace, /nodeLinker: hoisted/);
    assert.match(workspace, /autoInstallPeers: false/);

    const second = await ensureProfile("default");
    assert.equal(second.created, false);
    assert.equal(second.migration, undefined);
  });
});

test("an existing profile without the hoisted settings keeps them and reports the migration path", async () => {
  await withHome(async () => {
    const directory = profileDirectory("default");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "pnpm-workspace.yaml"), "packages:\n  - .\n", "utf8");
    const result = await ensureProfile("default");
    assert.equal(await readFile(join(directory, "pnpm-workspace.yaml"), "utf8"), "packages:\n  - .\n");
    assert.match(result.migration ?? "", /nodeLinker: hoisted/);
    assert.match(result.migration ?? "", /paperkite init/);
  });
});

test("a profile workspace carrying extra pnpm policy is not reported as a migration", async () => {
  await withHome(async () => {
    const directory = profileDirectory("default");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "pnpm-workspace.yaml"),
      "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n\n"
        + "minimumReleaseAgeExclude:\n  - '@paperkite/plugin-favorites-repost@0.1.1'\n",
      "utf8"
    );
    const result = await ensureProfile("default");
    assert.equal(result.migration, undefined);
  });
});

test("a profile plugin resolves telegram through the core installation", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    await healDependencyFallback();
    await writeProfile(directory.directory, ["@acme/plugin-shared"]);
    await writePlugin(directory.directory, {
      name: "@acme/plugin-shared",
      capability: "shared.inspect",
      handler: "SharedAction",
      peerDependencies: { [TELEGRAM]: "^2.26.0" }
    });

    const loaded = await loadExtensions(["shared.inspect"]);
    assert.ok(loaded.packages.includes("@acme/plugin-shared"));
    assert.deepEqual(hostOwnedNames().includes(TELEGRAM), true);

    const resolved = resolveFrom(directory.directory, TELEGRAM);
    assert.equal(resolved, resolveFrom(coreRoot(), TELEGRAM));
    assert.equal(await versionAt(resolved), "2.26.22");
  });
});

test("a profile plugin shares gramjs instances and peer helpers with core", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    await healDependencyFallback();
    await writeProfile(directory.directory, ["@acme/plugin-live"]);
    await writePlugin(directory.directory, {
      name: "@acme/plugin-live",
      capability: "live.inspect",
      handler: "LiveAction",
      peerDependencies: { [TELEGRAM]: "^2.26.0" },
      source: [
        'import { Api, utils } from "telegram";',
        'import { NewMessage } from "telegram/events/index.js";',
        "export const ApiRef = Api;",
        "export class LiveAction { async run() {} }",
        "export function describe() {",
        "  const peer = new Api.PeerUser({ userId: 42 });",
        "  const document = new Api.Document({",
        "    id: 7n, accessHash: 1n, fileReference: Buffer.from([1]), dcId: 2, mimeType: 'a', size: 5, attributes: []",
        "  });",
        "  const update = new Api.UpdateNewMessage({",
        "    message: new Api.Message({ id: 3, peerId: new Api.PeerUser({ userId: 42 }), message: 'hi', date: 1 }),",
        "    pts: 1, ptsCount: 1",
        "  });",
        "  return {",
        "    peerId: utils.getPeerId(peer),",
        "    dcId: utils.getFileInfo(new Api.MessageMediaDocument({ document })).dcId,",
        "    built: new NewMessage({}).build(update, undefined, 1)?.message?.message",
        "  };",
        "}"
      ].join("\n")
    });

    await loadExtensions(["live.inspect"]);
    const plugin = (await import(join(directory.directory, "node_modules", "@acme/plugin-live", "index.js"))) as {
      ApiRef: unknown;
      describe(): { peerId: string; dcId: number; built: string };
    };
    assert.equal(plugin.ApiRef, Api);
    const apiRef = plugin.ApiRef as typeof Api;
    assert.ok(new apiRef.PeerUser({ userId: 1 as never }) instanceof apiRef.PeerUser);
    assert.deepEqual(plugin.describe(), { peerId: "42", dcId: 2, built: "hi" });
  });
});

test("two plugins keep different versions of the same private dependency apart", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    await healDependencyFallback();
    await writeProfile(directory.directory, ["@acme/plugin-one", "@acme/plugin-two"]);
    const sourceFor = (handler: string): string =>
      [
        'import { createRequire } from "node:module";',
        `export class ${handler} { async run() {} }`,
        'export function ownVersion() { return createRequire(import.meta.url)("private-dep/package.json").version; }'
      ].join("\n");
    const one = await writePlugin(directory.directory, {
      name: "@acme/plugin-one",
      capability: "one.run",
      handler: "OneAction",
      dependencies: { "private-dep": "1.0.0" },
      source: sourceFor("OneAction")
    });
    const two = await writePlugin(directory.directory, {
      name: "@acme/plugin-two",
      capability: "two.run",
      handler: "TwoAction",
      dependencies: { "private-dep": "2.0.0" },
      source: sourceFor("TwoAction")
    });
    await writePackages(one, [{ name: "private-dep", version: "1.0.0" }]);
    await writePackages(two, [{ name: "private-dep", version: "2.0.0" }]);

    await loadExtensions(["one.run", "two.run"]);
    const first = (await import(join(one, "index.js"))) as { ownVersion(): string };
    const second = (await import(join(two, "index.js"))) as { ownVersion(): string };
    assert.equal(first.ownVersion(), "1.0.0");
    assert.equal(second.ownVersion(), "2.0.0");
  });
});

test("declaring telegram on dependencies is diagnosed with the plugin, package, and field", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    const plugin = await writePlugin(directory.directory, {
      name: "@acme/plugin-broken",
      capability: "broken.run",
      handler: "BrokenAction",
      dependencies: { [TELEGRAM]: "^2.26.0" }
    });
    await writePackages(join(directory.directory, "node_modules", "@acme/plugin-broken"), [
      { name: TELEGRAM, version: "2.26.22" }
    ]);

    const report = diagnosePlugin(plugin, { dependencies: { [TELEGRAM]: "^2.26.0" } }, hostOwnedNames(), coreRoot(), directory.directory);
    assert.equal(report.verdict, "reject");
    assert.deepEqual(
      report.deviations.map((item) => [item.code, item.package, item.field]),
      [
        ["dependency", TELEGRAM, "dependencies"],
        ["shadow", TELEGRAM, "realpath"]
      ]
    );
  });
});

test("a peer range that misses the core version is diagnosed", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    const plugin = await writePlugin(directory.directory, {
      name: "@acme/plugin-old",
      capability: "old.run",
      handler: "OldAction",
      peerDependencies: { [TELEGRAM]: "^3.0.0" }
    });
    const report = diagnosePlugin(plugin, { peerDependencies: { [TELEGRAM]: "^3.0.0" } }, hostOwnedNames(), coreRoot(), directory.directory);
    assert.equal(report.verdict, "reject");
    assert.deepEqual(
      report.deviations.map((item) => [item.code, item.package, item.field]),
      [["peer-range", TELEGRAM, "peerDependencies"]]
    );
  });
});

test("a transitive telegram copy below the plugin directory is diagnosed", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    await healDependencyFallback();
    const plugin = await writePlugin(directory.directory, {
      name: "@acme/plugin-transitive",
      capability: "transitive.run",
      handler: "TransitiveAction",
      peerDependencies: { [TELEGRAM]: "^2.26.0" }
    });
    await writePackages(plugin, [{ name: TELEGRAM, version: "2.26.22" }]);

    const manifest = { peerDependencies: { [TELEGRAM]: "^2.26.0" } };
    const report = diagnosePlugin(plugin, manifest, hostOwnedNames(), coreRoot(), directory.directory);
    // peer 声明过也要报：profile 里的第二份把共享目录遮住，插件拿到的与 core 那份不是同一实例
    assert.deepEqual(
      report.deviations.map((item) => [item.code, item.package, item.field]),
      [["shadow", TELEGRAM, "realpath"]]
    );

    const withDependency = diagnosePlugin(
      plugin,
      { ...manifest, dependencies: { [TELEGRAM]: "^2.26.0" } },
      hostOwnedNames(),
      coreRoot(),
      directory.directory
    );
    assert.deepEqual(
      withDependency.deviations.map((item) => [item.code, item.package, item.field]),
      [
        ["dependency", TELEGRAM, "dependencies"],
        ["shadow", TELEGRAM, "realpath"]
      ]
    );
  });
});

test("a profile without the shared directory still diagnoses the dependency declaration", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    const plugin = await writePlugin(directory.directory, {
      name: "@acme/plugin-offline",
      capability: "offline.run",
      handler: "OfflineAction",
      dependencies: { [TELEGRAM]: "^2.26.0" }
    });
    const report = diagnosePlugin(plugin, { dependencies: { [TELEGRAM]: "^2.26.0" } }, hostOwnedNames(), coreRoot(), directory.directory);
    assert.deepEqual(
      report.deviations.map((item) => [item.code, item.package, item.field]),
      [["dependency", TELEGRAM, "dependencies"]]
    );
  });
});

test("strict mode refuses to load a plugin that keeps telegram as a runtime dependency", async () => {
  await withHome(async () => {
    const directory = await ensureProfile("default");
    await healDependencyFallback();
    await writeProfile(directory.directory, ["@acme/plugin-broken"]);
    await writePlugin(directory.directory, {
      name: "@acme/plugin-broken",
      capability: "broken.run",
      handler: "BrokenAction",
      dependencies: { [TELEGRAM]: "^2.26.0" }
    });
    await writePackages(join(directory.directory, "node_modules", "@acme/plugin-broken"), [
      { name: TELEGRAM, version: "2.26.22" }
    ]);

    const lenient = await loadExtensions(["broken.run"]);
    assert.match(lenient.warnings.join("\n"), /host-owned telegram \(dependencies\)/);
    await assert.rejects(loadExtensions(["broken.run"], { strict: true }), /dependencies/);
  });
});

test("heal is idempotent and relinks when the core dependency version changes", async () => {
  const home = await mkdtemp(join(tmpdir(), "paperkite-heal-"));
  const previous = process.env.PAPERKITE_HOME;
  process.env.PAPERKITE_HOME = home;
  try {
    const core = await writeCore(join(home, "core"), "2.26.22");
    const firstTarget = await installToStore(core, TELEGRAM, "2.26.22");
    const modulesDir = join(home, "profiles", "node_modules");
    const first = await healModuleFallback(core);
    assert.deepEqual(
      first.changes.map((item) => [item.name, item.kind]).sort(),
      [["paperkite", "linked"], [TELEGRAM, "linked"]].sort()
    );
    const link = join(modulesDir, TELEGRAM);
    assert.equal(canonical(readlinkSync(link)), canonical(firstTarget));

    const second = await healModuleFallback(core);
    assert.deepEqual(second.changes, []);

    const nextTarget = await installToStore(core, TELEGRAM, "2.26.30");
    const third = await healModuleFallback(core);
    assert.deepEqual(
      third.changes.map((item) => [item.name, item.kind]),
      [[TELEGRAM, "relinked"]]
    );
    assert.equal(canonical(readlinkSync(link)), canonical(nextTarget));
    assert.equal(await versionAt(resolveFrom(join(home, "profiles"), TELEGRAM)), "2.26.30");
  } finally {
    if (previous === undefined) delete process.env.PAPERKITE_HOME;
    else process.env.PAPERKITE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});

/** 把某个版本装进独立的 store 目录并在安装根挂上链接，模拟 core 的依赖版本变化。 */
async function installToStore(core: string, name: string, version: string): Promise<string> {
  const target = join(core, "store", name + "-" + version);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "package.json"), JSON.stringify({ name, version }), "utf8");
  const link = join(core, "node_modules", name);
  await rm(link, { recursive: true, force: true });
  await mkdir(dirname(link), { recursive: true });
  symlinkSync(target, link);
  await writeFile(
    join(core, "package.json"),
    JSON.stringify({ name: "paperkite", version: "0.0.0", dependencies: { [name]: version } }),
    "utf8"
  );
  return target;
}

test("the dependency closure walks nested dependency manifests", async () => {
  const home = await mkdtemp(join(tmpdir(), "paperkite-closure-"));
  try {
    const core = await writeCore(join(home, "core"), "2.26.22");
    await writePackages(core, [
      { name: TELEGRAM, version: "2.26.22", dependencies: { "big-integer": "^1.6.0" } },
      { name: "big-integer", version: "1.6.52" }
    ]);
    const closure = coreDependencyClosure(join(core, "package.json"));
    assert.deepEqual([...closure.links.keys()].sort(), ["big-integer", "paperkite", TELEGRAM].sort());
    assert.deepEqual(closure.unresolved, []);

    const result = await mirrorModuleFallback(join(home, "profiles", "node_modules"), closure);
    assert.equal(result.changes.some((item) => item.name === "big-integer" && item.kind === "linked"), true);
    const stale = join(home, "profiles", "node_modules", "gone");
    await mkdir(dirname(stale), { recursive: true });
    symlinkSync(join(home, "vanished"), stale);
    const pruned = await mirrorModuleFallback(join(home, "profiles", "node_modules"), closure);
    assert.deepEqual(pruned.changes.filter((item) => item.kind === "removed").map((item) => item.name), ["gone"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
