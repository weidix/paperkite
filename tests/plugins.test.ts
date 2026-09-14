import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectPlugins, loadExtensions, isHandlerConstructor } from "../src/extensions/loader.js";

const pluginDirectories = [
  "messages",
  "notify-bark",
  "messages-watch",
  "account-health",
  "archive",
  "process-run",
  "runtime-console",
  "favorites-cleanup",
  "favorites-repost"
];

test("each actual plugin owns one manifest and shared packages stay ordinary", async () => {
  for (const directory of pluginDirectories) {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "packages", directory, "package.json"), "utf8")) as {
      name: string;
      peerDependencies?: Record<string, string>;
      paperkite?: { plugin?: unknown };
    };
    assert.ok(manifest.paperkite?.plugin, directory);
    assert.equal(manifest.peerDependencies, undefined, directory);
  }
  for (const directory of ["sdk"]) {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "packages", directory, "package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
      paperkite?: unknown;
    };
    assert.equal(manifest.paperkite, undefined, directory);
    assert.deepEqual(manifest.exports?.["."], { types: "./dist/index.d.ts" }, directory);
  }
});

const ALL_CAPABILITIES = [
  "account.health",
  "archive.sync",
  "archive.console",
  "favorites.cleanup",
  "favorites.repost",
  "messages.send",
  "messages.watch",
  "messages.poll",
  "notify.bark",
  "process.run",
  "runtime.console"
];

test("bundles load through the extension loader and bind declared handlers", async () => {
  const { registry, installed, packages } = await loadExtensions(ALL_CAPABILITIES);
  assert.equal(installed.length, 9);
  assert.equal(packages.length, 9);
  assert.equal(registry.actions.size, 6);
  assert.equal(registry.triggers.size, 3);
  assert.equal(registry.services.size, 2);
  assert.ok(registry.getAction("archive.sync"));
  assert.ok(registry.getAction("favorites.cleanup"));
  assert.ok(registry.getAction("favorites.repost"));
  assert.ok(registry.getAction("messages.send"));
  assert.ok(registry.getAction("process.run"));
  assert.ok(registry.getTrigger("messages.watch"));
  assert.ok(registry.getTrigger("messages.poll"));
  assert.ok(registry.getService("archive.console"));
  assert.ok(registry.getService("runtime.console"));
  assert.equal(registry.grantsControl("trigger", "account.health"), true);
  assert.equal(registry.grantsControl("service", "runtime.console"), true);
  assert.equal(registry.grantsControl("action", "notify.bark"), false);
});

test("manifest validator symbols resolve into callable config validators", async () => {
  const { registry } = await loadExtensions(["messages.watch"]);
  const validateConfig = registry.validatorOf("trigger", "messages.watch");
  assert.equal(typeof validateConfig, "function");
  assert.deepEqual(validateConfig?.({ chats: ["@channel_name", "https://t.me/+AAAAAEabcdefgh"] }), []);
  assert.deepEqual(validateConfig?.({ chats: ["乱填"] }), [
    "无法解析的聊天引用 乱填，请使用群数字 ID、@用户名或邀请链接"
  ]);
  assert.equal(typeof registry.validatorOf("trigger", "messages.poll"), "function");
  assert.equal(registry.validatorOf("action", "notify.bark"), undefined);
});

test("handler checks accept any class whose prototype exposes run", () => {
  class Handler {
    async run(): Promise<void> {}
  }

  assert.equal(isHandlerConstructor(Handler), true);
  assert.equal(isHandlerConstructor(class {}), false);
  assert.equal(isHandlerConstructor({ run() {} }), false);
  assert.equal(isHandlerConstructor((): void => undefined), false);
});

test("bundled plugins resolve from the core root while the profile is empty", async () => {
  const home = await mkdtemp(join(tmpdir(), "paperkite-core-root-"));
  const previous = process.env.PAPERKITE_HOME;
  process.env.PAPERKITE_HOME = home;
  try {
    const views = await inspectPlugins();
    assert.equal(views.length, 9);
    for (const view of views) {
      assert.equal(view.source, "manifest", view.name);
      assert.equal(view.root, "core", view.name);
      assert.equal(view.compatibility?.verdict, "load", view.name);
      assert.ok(view.version, view.name);
    }
  } finally {
    if (previous === undefined) delete process.env.PAPERKITE_HOME;
    else process.env.PAPERKITE_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});