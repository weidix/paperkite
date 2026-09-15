import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterScopes,
  readBundleManifest,
  readSnapshot,
  selectPluginVersion,
  type HttpResponseLike,
  type HttpFetch,
  type Packument
} from "../src/extensions/manifest.js";
import { listPlugins, syncBundles, updatePlugins, type PnpmRunner } from "../src/extensions/manager.js";
import { inspectPlugins, loadExtensions } from "../src/extensions/loader.js";
import { bundleRanges, readProfile } from "../src/extensions/profile.js";
import { DEFAULT_PLUGIN_SETTINGS, loadSettings, type PluginSettings } from "../src/config/settings.js";

const SETTINGS: PluginSettings = {
  ...DEFAULT_PLUGIN_SETTINGS,
  registry: "https://registry.test"
};

const MESSAGES = "@paperkite/plugin-messages";
const NOTIFY = "@paperkite/plugin-notify-bark";
const BROKEN = "@acme/plugin-broken";
const UNIT = "@acme/plugin-unit";

const DIST_SETTINGS: PluginSettings = {
  ...SETTINGS,
  scopes: ["@paperkite/", "@acme/"]
};

interface VersionSpec {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly published?: string;
}

function versionsMap(name: string, versions: Record<string, VersionSpec>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(versions).map(([version, spec]) => [
      version,
      {
        name,
        version,
        dependencies: spec.dependencies ?? {},
        devDependencies: spec.devDependencies ?? {},
        dist: { tarball: "https://registry.test/" + name + "/-/" + name + "-" + version + ".tgz" }
      }
    ])
  );
}

function timeMap(versions: Record<string, VersionSpec>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(versions)
      .filter(([, spec]) => spec.published)
      .map(([version, spec]) => [version, spec.published as string])
  );
}

function newestOf(versions: Record<string, VersionSpec>, latest?: string): string {
  const keys = Object.keys(versions);
  return latest ?? keys[keys.length - 1] ?? "0.0.0";
}

/** registry 上的原始 packument 文档。 */
function registryDocument(name: string, versions: Record<string, VersionSpec>, latest?: string): unknown {
  return {
    name,
    "dist-tags": { latest: newestOf(versions, latest) },
    versions: versionsMap(name, versions),
    time: timeMap(versions)
  };
}

/** 解析后的 packument，用于直接驱动版本选择。 */
function parsedPackument(name: string, versions: Record<string, VersionSpec>, latest?: string): Packument {
  return {
    name,
    distTags: { latest: newestOf(versions, latest) },
    versions: versionsMap(name, versions) as Packument["versions"],
    time: timeMap(versions)
  };
}

function response(document: unknown, status = 200, etag?: string): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "etag" ? (etag ?? null) : null) },
    json: async () => document
  };
}

function fakeFetch(routes: Record<string, unknown>): { fetch: HttpFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: HttpFetch = async (url) => {
    calls.push(url);
    const document = routes[url];
    if (document === undefined) return response({ error: "not found" }, 404);
    return response(document, 200, '"etag-1"');
  };
  return { fetch, calls };
}

function registryUrl(name: string): string {
  return "https://registry.test/" + encodeURIComponent(name);
}

/** 假 pnpm：按 profile 的 dependencies 生成 node_modules 版本，模拟一次安装。 */
function installRunner(): { runner: PnpmRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: PnpmRunner = (args, cwd) => {
    calls.push([...args]);
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      const directory = join(cwd, "node_modules", name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: spec }), "utf8");
    }
    return 0;
  };
  return { runner, calls };
}

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "paperkite-dist-"));
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

async function writePlugin(
  home: string,
  profile: string,
  name: string,
  version: string,
  capabilities: readonly { kind: string; name: string; handler: string }[]
): Promise<void> {
  const directory = join(home, "profiles", profile, "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name,
      version,
      type: "module",
      main: "./index.js",
      paperkite: { plugin: { capabilities } }
    }),
    "utf8"
  );
  await writeFile(
    join(directory, "index.js"),
    capabilities.map((capability) => `export class ${capability.handler} { async run() {} }\n`).join(""),
    "utf8"
  );
}

test("the built-in bundle snapshot mirrors the published manifest package", async () => {
  const snapshot = await readSnapshot();
  const manifest = JSON.parse(
    await readFile(join(process.cwd(), "packages", "bundles", "package.json"), "utf8")
  ) as { name: string; version: string; dependencies: Record<string, string> };
  assert.equal(snapshot.name, manifest.name);
  assert.equal(snapshot.version, manifest.version);
  assert.deepEqual(snapshot.dependencies, manifest.dependencies);

  const core = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    paperkite: { bundles: readonly string[] };
  };
  assert.deepEqual(
    Object.keys(snapshot.dependencies).sort(),
    [...core.paperkite.bundles].sort()
  );
  assert.deepEqual(
    Object.keys(core.dependencies).filter((name) => name.startsWith("@paperkite/")),
    []
  );
});

test("the bundle manifest is read online, cached, refreshed, and used offline", async () => {
  await withHome(async () => {
    const online = registryDocument(
      "@paperkite/bundles",
      { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1", [NOTIFY]: "^0.1.1" } } },
      "0.1.0"
    );
    const first = fakeFetch({ [registryUrl("@paperkite/bundles")]: online });
    const manifest = await readBundleManifest({ settings: SETTINGS, fetch: first.fetch });
    assert.equal(manifest.origin, "online");
    assert.equal(manifest.version, "0.1.0");
    assert.deepEqual(manifest.dependencies, { [MESSAGES]: "^0.1.1", [NOTIFY]: "^0.1.1" });

    const second = fakeFetch({});
    const cached = await readBundleManifest({ settings: SETTINGS, fetch: second.fetch });
    assert.equal(cached.origin, "cache");
    assert.deepEqual(second.calls, []);
    assert.deepEqual(cached.dependencies, manifest.dependencies);

    const refreshed = fakeFetch({ [registryUrl("@paperkite/bundles")]: online });
    assert.equal(
      (await readBundleManifest({ settings: SETTINGS, fetch: refreshed.fetch, refresh: true })).origin,
      "online"
    );
    assert.equal(refreshed.calls.length, 1);

    const offline = await readBundleManifest({ settings: SETTINGS, fetch: fakeFetch({}).fetch, offline: true });
    assert.equal(offline.origin, "cache");
  });
});

test("a manifest fetch failure falls back to cache and then to the built-in snapshot", async () => {
  await withHome(async () => {
    const broken: HttpFetch = async () => {
      throw new Error("network down");
    };
    const snapshot = await readBundleManifest({ settings: SETTINGS, fetch: broken });
    assert.equal(snapshot.origin, "snapshot");
    assert.equal(snapshot.warnings.length, 1);
    assert.match(snapshot.warnings[0] ?? "", /network down/);
    assert.ok(Object.keys(snapshot.dependencies).includes(MESSAGES));

    const online = registryDocument(
      "@paperkite/bundles",
      { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1" } } },
      "0.1.0"
    );
    await readBundleManifest({ settings: SETTINGS, fetch: fakeFetch({ [registryUrl("@paperkite/bundles")]: online }).fetch });
    const cached = await readBundleManifest({ settings: SETTINGS, fetch: broken, refresh: true });
    assert.equal(cached.origin, "cache");
    assert.match(cached.warnings[0] ?? "", /network down/);
  });
});

test("version selection takes the highest stable release the core ABI accepts", () => {
  const document = parsedPackument("demo", {
    "0.1.0": {},
    "0.1.1": { devDependencies: { "@paperkite/sdk": "^0.2.0" } },
    "0.1.2": { devDependencies: { "@paperkite/sdk": "^1.0.0" } },
    "0.2.0-beta.1": {},
    "0.2.0": {}
  });
  assert.deepEqual(selectPluginVersion(document, "^0.1.0")?.version, "0.1.1");
  assert.deepEqual(selectPluginVersion(document, "^0.2.0")?.version, "0.2.0");
  assert.equal(selectPluginVersion(document, "^2.0.0"), undefined);
});

test("the supply-chain delay keeps releases newer than the pnpm cutoff out of selection", () => {
  const document = parsedPackument("demo", {
    "0.1.0": { published: "2024-01-01T00:00:00.000Z" },
    "0.1.1": { published: "2024-06-01T00:00:00.000Z" }
  });
  const now = () => Date.parse("2024-06-02T00:00:00.000Z");
  assert.equal(selectPluginVersion(document, "^0.1.0", { now })?.version, "0.1.1");
  assert.equal(
    selectPluginVersion(document, "^0.1.0", {
      now,
      release: { minimumReleaseAgeMinutes: 7 * 24 * 60, exclude: [] }
    })?.version,
    "0.1.0"
  );
  assert.equal(
    selectPluginVersion(document, "^0.1.0", {
      name: "demo",
      now,
      release: { minimumReleaseAgeMinutes: 7 * 24 * 60, exclude: ["demo"] }
    })?.version,
    "0.1.1"
  );
});

test("bundle scopes filter manifest entries", () => {
  const { accepted, skipped } = filterScopes(
    { [MESSAGES]: "^0.1.1", "@acme/plugin-extra": "^1.0.0" },
    ["@paperkite/"]
  );
  assert.deepEqual(accepted, { [MESSAGES]: "^0.1.1" });
  assert.deepEqual(skipped, ["@acme/plugin-extra"]);
});

test("sync installs manifest plugins once and stays idempotent afterwards", async () => {
  await withHome(async () => {
    const manifestDoc = registryDocument(
      "@paperkite/bundles",
      { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1", [NOTIFY]: "^0.1.1" } } },
      "0.1.0"
    );
    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: manifestDoc,
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, {
        "0.1.0": {},
        "0.1.1": {},
        "0.1.2": { devDependencies: { "@paperkite/sdk": "^1.0.0" } }
      }),
      [registryUrl(NOTIFY)]: registryDocument(NOTIFY, { "0.1.0": {}, "0.1.1": {} })
    });
    const { runner, calls } = installRunner();
    const first = await syncBundles("default", { settings: SETTINGS, fetch, runner });
    assert.deepEqual(
      first.added.map((item) => [item.name, item.version]),
      [
        [MESSAGES, "0.1.1"],
        [NOTIFY, "0.1.1"]
      ]
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["install", "--ignore-scripts"]);

    const profile = await readProfile(join(process.env.PAPERKITE_HOME as string, "profiles", "default"));
    assert.deepEqual(profile.dependencies, { [MESSAGES]: "0.1.1", [NOTIFY]: "0.1.1" });
    assert.deepEqual(bundleRanges(profile), { [MESSAGES]: "^0.1.1", [NOTIFY]: "^0.1.1" });

    const second = await syncBundles("default", { settings: SETTINGS, fetch, runner });
    assert.deepEqual(second.added, []);
    assert.deepEqual(second.kept, [MESSAGES, NOTIFY]);
    assert.equal(second.applied, false);
    assert.equal(calls.length, 1);
  });
});

test("sync reports pending work without writing when --check is set", async () => {
  await withHome(async () => {
    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1" } } },
        "0.1.0"
      ),
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, { "0.1.1": {} })
    });
    const { runner, calls } = installRunner();
    const result = await syncBundles("default", { settings: SETTINGS, fetch, runner, check: true });
    assert.deepEqual(result.added.map((item) => item.version), ["0.1.1"]);
    assert.equal(result.applied, false);
    assert.equal(calls.length, 0);
    const profile = await readProfile(join(process.env.PAPERKITE_HOME as string, "profiles", "default"));
    assert.deepEqual(profile.dependencies, {});
  });
});

test("a plugin removed from the manifest stays installed as a user plugin", async () => {
  await withHome(async () => {
    const both = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1", [NOTIFY]: "^0.1.1" } } },
        "0.1.0"
      ),
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, { "0.1.1": {} }),
      [registryUrl(NOTIFY)]: registryDocument(NOTIFY, { "0.1.1": {} })
    });
    const { runner } = installRunner();
    await syncBundles("default", { settings: SETTINGS, fetch: both.fetch, runner });

    const onlyMessages = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.1": { dependencies: { [MESSAGES]: "^0.1.1" } } },
        "0.1.1"
      )
    });
    const result = await syncBundles("default", {
      settings: SETTINGS,
      fetch: onlyMessages.fetch,
      runner,
      refresh: true
    });
    assert.deepEqual(result.removed, [NOTIFY]);
    assert.match(result.warnings.join("\n"), new RegExp(NOTIFY.replace(/[/@]/g, "\\$&")));
    const profile = await readProfile(join(process.env.PAPERKITE_HOME as string, "profiles", "default"));
    assert.equal(profile.dependencies?.[NOTIFY], "0.1.1");
    assert.deepEqual(bundleRanges(profile), { [MESSAGES]: "^0.1.1" });
    assert.ok(profile.paperkite?.profile?.plugins?.includes(NOTIFY));
  });
});

test("sync never rewrites user plugins or pinned versions", async () => {
  await withHome(async () => {
    const profileDir = join(process.env.PAPERKITE_HOME as string, "profiles", "default");
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "package.json"),
      JSON.stringify({
        name: "paperkite-profile-default",
        version: "0.0.0",
        dependencies: { "@acme/plugin-extra": "1.2.3", [MESSAGES]: "0.1.0" },
        paperkite: {
          profile: {
            plugins: ["@acme/plugin-extra"],
            bundles: { [MESSAGES]: "^0.1.0" }
          }
        }
      }),
      "utf8"
    );
    await writePlugin(process.env.PAPERKITE_HOME as string, "default", "@acme/plugin-extra", "1.2.3", [
      { kind: "action", name: "extra.run", handler: "ExtraAction" }
    ]);
    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1", "@acme/plugin-extra": "^1.0.0" } } },
        "0.1.0"
      ),
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, { "0.1.1": {} })
    });
    const { runner, calls } = installRunner();
    const result = await syncBundles("default", { settings: SETTINGS, fetch, runner });
    assert.deepEqual(result.added.map((item) => [item.name, item.version]), [[MESSAGES, "0.1.0"]]);
    assert.match(result.warnings.join("\n"), /@acme\/plugin-extra is outside the configured bundle scopes/);
    assert.match(result.warnings.join("\n"), /@paperkite\/plugin-messages is pinned to 0\.1\.0, outside \^0\.1\.1/);
    const profile = await readProfile(profileDir);
    assert.equal(profile.dependencies?.["@acme/plugin-extra"], "1.2.3");
    assert.equal(profile.dependencies?.[MESSAGES], "0.1.0");
    assert.deepEqual(bundleRanges(profile), { [MESSAGES]: "^0.1.1" });
    assert.deepEqual(profile.paperkite?.profile?.plugins, ["@acme/plugin-extra"]);
    assert.equal(calls.length, 1);
  });
});

test("plugin update advances a pinned plugin and leaves the rest alone", async () => {
  await withHome(async (home) => {
    const profileDir = join(home, "profiles", "default");
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "package.json"),
      JSON.stringify({
        name: "paperkite-profile-default",
        version: "0.0.0",
        dependencies: { [MESSAGES]: "0.1.1" },
        paperkite: { profile: { plugins: [], bundles: { [MESSAGES]: "^0.1.1" } } }
      }),
      "utf8"
    );
    await writePlugin(home, "default", MESSAGES, "0.1.1", [
      { kind: "action", name: "messages.send", handler: "SendAction" }
    ]);
    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1" } } },
        "0.1.0"
      ),
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, {
        "0.1.1": {},
        "0.1.2": {},
        "0.2.0": { devDependencies: { "@paperkite/sdk": "^1.0.0" } }
      })
    });
    const { runner, calls } = installRunner();

    const result = await updatePlugins("default", [MESSAGES], { settings: SETTINGS, fetch, runner });
    assert.deepEqual(result.added.map((item) => item.version), ["0.1.2"]);
    assert.equal(calls.length, 1);
    const profile = await readProfile(profileDir);
    assert.equal(profile.dependencies?.[MESSAGES], "0.1.2");

    const again = await updatePlugins("default", [MESSAGES], { settings: SETTINGS, fetch, runner, refresh: true });
    assert.deepEqual(again.added, []);
    assert.deepEqual(again.kept, [MESSAGES]);
    assert.equal(calls.length, 1);
  });
});

test("offline sync keeps the pinned versions and warns instead of failing", async () => {
  await withHome(async () => {
    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1" } } },
        "0.1.0"
      ),
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, { "0.1.1": {} })
    });
    const { runner } = installRunner();
    await syncBundles("default", { settings: SETTINGS, fetch, runner });
    const offline = await syncBundles("default", { settings: SETTINGS, fetch, runner, offline: true });
    assert.deepEqual(offline.added, []);
    assert.deepEqual(offline.kept, [MESSAGES]);
  });
});

test("profile plugins take precedence over core bundles with the same name", async () => {
  await withHome(async (home) => {
    const profileDir = join(home, "profiles", "default");
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "package.json"),
      JSON.stringify({
        name: "paperkite-profile-default",
        version: "0.0.0",
        paperkite: { profile: { plugins: [], bundles: { [MESSAGES]: "^9.9.9" } } }
      }),
      "utf8"
    );
    await writePlugin(home, "default", MESSAGES, "9.9.9", [
      { kind: "action", name: "stub.echo", handler: "StubAction" }
    ]);

    const loaded = await loadExtensions(["stub.echo"]);
    const messages = loaded.installed.find((entry) => entry.name === MESSAGES);
    assert.equal(messages?.version, "9.9.9");
    assert.equal(messages?.loaded, true);

    const fallback = await loadExtensions(["notify.bark"]);
    assert.ok(fallback.packages.includes(NOTIFY));

    const views = await inspectPlugins();
    const view = views.find((entry) => entry.name === MESSAGES);
    assert.equal(view?.root, "profile");
    assert.equal(view?.source, "manifest");
    assert.equal(view?.range, "^9.9.9");
    assert.equal(view?.version, "9.9.9");
    assert.equal(view?.compatibility?.verdict, "load");
    const core = views.find((entry) => entry.name === NOTIFY);
    assert.equal(core?.root, "core");
    assert.equal(core?.source, "manifest");
    assert.equal(core?.version, (await readSnapshot()).dependencies[NOTIFY]?.replace(/^\D+/, ""));
  });
});

test("plugin list reports source, installed version, available version, and ABI verdict", async () => {
  await withHome(async (home) => {
    const profileDir = join(home, "profiles", "default");
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "package.json"),
      JSON.stringify({
        name: "paperkite-profile-default",
        version: "0.0.0",
        dependencies: { [MESSAGES]: "0.1.1" },
        paperkite: { profile: { plugins: [], bundles: { [MESSAGES]: "^0.1.1" } } }
      }),
      "utf8"
    );
    await writePlugin(home, "default", MESSAGES, "0.1.1", [
      { kind: "action", name: "messages.send", handler: "SendAction" }
    ]);
    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1" } } },
        "0.1.0"
      ),
      [registryUrl(MESSAGES)]: registryDocument(MESSAGES, { "0.1.1": {}, "0.1.2": {} })
    });
    const entries = await listPlugins("default", { settings: SETTINGS, fetch });
    const messages = entries.find((entry) => entry.name === MESSAGES);
    assert.deepEqual(messages, {
      name: MESSAGES,
      source: "manifest",
      root: "profile",
      version: "0.1.1",
      range: "^0.1.1",
      available: "0.1.2",
      compatibility: { verdict: "load" },
      shared: [],
      capabilities: ["messages.send"],
      deviations: undefined,
      note: undefined
    });
    const notify = entries.find((entry) => entry.name === NOTIFY);
    assert.equal(notify?.root, "core");
    assert.equal(notify?.source, "manifest");
  });
});

test("plugin list surfaces host-owned conflicts with the plugin and package", async () => {
  await withHome(async (home) => {
    const profileDir = join(home, "profiles", "default");
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(profileDir, "package.json"),
      JSON.stringify({
        name: "paperkite-profile-default",
        version: "0.0.0",
        dependencies: { [BROKEN]: "1.0.0" },
        paperkite: { profile: { plugins: [BROKEN] } }
      }),
      "utf8"
    );
    await writePlugin(home, "default", BROKEN, "1.0.0", [
      { kind: "action", name: "broken.run", handler: "BrokenAction" }
    ]);
    const manifestPath = join(profileDir, "node_modules", BROKEN, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.dependencies = { telegram: "^2.26.0" };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await mkdir(join(profileDir, "node_modules", BROKEN, "node_modules", "telegram"), { recursive: true });

    const { fetch } = fakeFetch({
      [registryUrl("@paperkite/bundles")]: registryDocument(
        "@paperkite/bundles",
        { "0.1.0": { dependencies: { [MESSAGES]: "^0.1.1" } } },
        "0.1.0"
      )
    });
    const entries = await listPlugins("default", { settings: DIST_SETTINGS, fetch });
    const broken = entries.find((entry) => entry.name === BROKEN);
    assert.deepEqual(broken?.deviations, [
      {
        code: "dependency",
        package: "telegram",
        field: "dependencies",
        declared: "^2.26.0",
        detail: "host-owned package declared as a runtime dependency; the profile installs a second copy"
      }
    ]);
    assert.match(broken?.note ?? "", /host-owned telegram \(dependencies\)/);
  });
});

test("a self-hosted manifest url is read as a plain document", async () => {
  await withHome(async () => {
    const settings: PluginSettings = { ...SETTINGS, manifest: "https://mirror.test/bundles.json" };
    const { fetch, calls } = fakeFetch({
      "https://mirror.test/bundles.json": {
        name: "@acme/bundles",
        version: "2.0.0",
        dependencies: { "@acme/plugin-thing": "^2.1.0" }
      }
    });
    const manifest = await readBundleManifest({ settings, fetch });
    assert.equal(manifest.origin, "online");
    assert.deepEqual(manifest.dependencies, { "@acme/plugin-thing": "^2.1.0" });
    assert.deepEqual(calls, ["https://mirror.test/bundles.json"]);
  });
});

test("plugin settings default and override through settings.yml", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-plugin-settings-"));
  try {
    const file = join(directory, "settings.yml");
    const telegram = ["telegram:", "  apiId: 1", "  apiHash: hash", ""].join("\n");
    await writeFile(file, telegram, "utf8");
    assert.deepEqual((await loadSettings(file)).plugins, DEFAULT_PLUGIN_SETTINGS);

    await writeFile(
      file,
      telegram +
        [
          "plugins:",
          '  manifest: "https://mirror.test/bundles.json"',
          '  registry: "https://mirror.test"',
          "  autoInstall: false",
          "  manifestTtlHours: 0",
          "  scopes:",
          '    - "@acme/"',
          ""
        ].join("\n"),
      "utf8"
    );
    assert.deepEqual((await loadSettings(file)).plugins, {
      manifest: "https://mirror.test/bundles.json",
      registry: "https://mirror.test",
      autoInstall: false,
      manifestTtlHours: 0,
      scopes: ["@acme/"],
      strict: false
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync failure does not stop startup and leaves the profile readable", async () => {
  await withHome(async (home) => {
    const failing: HttpFetch = async () => {
      throw new Error("offline");
    };
    const result = await syncBundles("default", { settings: SETTINGS, fetch: failing });
    assert.equal(result.origin, "snapshot");
    assert.ok(result.problems.length > 0);
    const files = await readdir(join(home, "profiles", "default"));
    assert.ok(files.includes("package.json"));
    const profile = await readProfile(join(home, "profiles", "default"));
    assert.deepEqual(profile.dependencies, {});
  });
});
