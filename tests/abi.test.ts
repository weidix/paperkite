import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORE_SDK_VERSION,
  evaluateCompatibility,
  sdkDeclarations,
  type CoreAbiPolicy
} from "../src/extensions/abi.js";
import { loadExtensions } from "../src/extensions/loader.js";

const CORE: CoreAbiPolicy = { sdkVersion: "0.2.0", abi: 0, unsupported: [] };

test("sdk declarations are read from every dependency region", () => {
  assert.deepEqual(
    sdkDeclarations({
      dependencies: { "@paperkite/sdk": ">=1.0.0" },
      devDependencies: { "@paperkite/sdk": "^2.0.0", other: "1.0.0" },
      peerDependencies: { "@paperkite/sdk": "~3.0.0" }
    }),
    [">=1.0.0", "^2.0.0", "~3.0.0"]
  );
  assert.deepEqual(sdkDeclarations({ dependencies: { "@paperkite/sdk": 1 } }), []);
  assert.deepEqual(sdkDeclarations({}), []);
});

test("lenient and unparsable declarations add no version constraint", () => {
  for (const declaration of ["", "*", "x", "latest", "next", "workspace:*", "file:../sdk", "not a range"]) {
    assert.deepEqual(evaluateCompatibility([declaration]), { verdict: "load" }, declaration);
  }
  assert.deepEqual(evaluateCompatibility([]), { verdict: "load" });
});

test("a declaration the core does not satisfy rejects the plugin", () => {
  const verdict = evaluateCompatibility(["^1.0.0"]);
  assert.equal(verdict.verdict, "reject");
  assert.match(verdict.detail, /@paperkite\/sdk \^1\.0\.0/);
  assert.ok(verdict.detail.includes(CORE_SDK_VERSION));
});

test("a satisfied declaration within the core ABI loads silently", () => {
  assert.deepEqual(evaluateCompatibility(["^0.2.0"]), { verdict: "load", abi: 0 });
  assert.deepEqual(evaluateCompatibility([">=0.1.0 <0.3.0"]), { verdict: "load", abi: 0 });
});

test("a satisfied declaration above the core ABI warns and still loads", () => {
  assert.deepEqual(evaluateCompatibility([">=0.1.0 <2"]), {
    verdict: "warn",
    abi: 1,
    detail: "declares ABI 1 while core provides ABI 0; it may rely on capabilities this core lacks"
  });
});

test("the ABI is the highest generation the declaration admits", () => {
  const core: CoreAbiPolicy = { sdkVersion: "2.5.1", abi: 2, unsupported: [] };
  assert.deepEqual(evaluateCompatibility([">=2.4.0 <3"], core), { verdict: "load", abi: 2 });
  assert.deepEqual(evaluateCompatibility([">=1.0.0 <4.0.0"], core), {
    verdict: "warn",
    abi: 3,
    detail: "declares ABI 3 while core provides ABI 2; it may rely on capabilities this core lacks"
  });
});

test("an unsupported ABI rejects even when the range is satisfied", () => {
  const verdict = evaluateCompatibility([">=1.0.0 <2"], {
    sdkVersion: "1.5.0",
    abi: 1,
    unsupported: [1]
  });
  assert.equal(verdict.verdict, "reject");
  assert.match(verdict.detail, /ABI 1/);
});

test("lenient declarations alongside explicit ones add no constraint", () => {
  assert.equal(evaluateCompatibility(["*", "^1.0.0"]).verdict, "reject");
  assert.deepEqual(evaluateCompatibility(["latest", "^0.2.0"]), { verdict: "load", abi: 0 });
});

async function withProfile(
  manifest: Record<string, unknown>,
  run: () => Promise<void>
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "paperkite-abi-"));
  const profile = join(home, "profiles", "default");
  const plugin = join(profile, "node_modules", "@acme", "plugin-demo");
  await mkdir(plugin, { recursive: true });
  await writeFile(
    join(profile, "package.json"),
    JSON.stringify({
      name: "paperkite-profile-default",
      version: "0.0.0",
      paperkite: { profile: { plugins: ["@acme/plugin-demo"] } }
    }),
    "utf8"
  );
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "@acme/plugin-demo",
      version: "1.0.0",
      type: "module",
      main: "./index.js",
      paperkite: { plugin: { capabilities: [{ kind: "action", name: "demo.warn", handler: "DemoAction" }] } },
      ...manifest
    }),
    "utf8"
  );
  await writeFile(join(plugin, "index.js"), "export class DemoAction { async run() {} }\n", "utf8");
  const previous = process.env.PAPERKITE_HOME;
  process.env.PAPERKITE_HOME = home;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.PAPERKITE_HOME;
    else process.env.PAPERKITE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

test("discovery reports a plugin above the core ABI and keeps it loadable", async () => {
  await withProfile({ devDependencies: { "@paperkite/sdk": ">=0.1.0 <2" } }, async () => {
    const { warnings, installed, packages } = await loadExtensions(["demo.warn"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /@acme\/plugin-demo/);
    assert.match(warnings[0] ?? "", /ABI 1/);
    assert.ok(packages.includes("@acme/plugin-demo"));
    assert.equal(installed.find((entry) => entry.name === "@acme/plugin-demo")?.loaded, true);
  });
});

test("discovery rejects a plugin whose declaration the core does not satisfy", async () => {
  await withProfile({ peerDependencies: { "@paperkite/sdk": ">=1.0.0 <2" } }, async () => {
    await assert.rejects(loadExtensions(["demo.warn"]), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /@acme\/plugin-demo/);
      assert.match(message, />=1\.0\.0 <2/);
      return true;
    });
  });
});
