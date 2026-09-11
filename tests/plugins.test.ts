import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadExtensions, isHandlerConstructor } from "../src/extensions/loader.js";

const pluginDirectories = [
  "messages",
  "notify-bark",
  "messages-watch",
  "account-health",
  "archive",
  "process-run",
  "runtime-console",
  "favorites-cleanup"
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
  "messages.send",
  "messages.watch",
  "messages.poll",
  "notify.bark",
  "process.run",
  "runtime.console"
];

test("bundles load through the extension loader and bind declared handlers", async () => {
  const { registry, installed, packages } = await loadExtensions(ALL_CAPABILITIES);
  assert.equal(installed.length, 8);
  assert.equal(packages.length, 8);
  assert.equal(registry.actions.size, 5);
  assert.equal(registry.triggers.size, 3);
  assert.equal(registry.services.size, 2);
  assert.ok(registry.getAction("archive.sync"));
  assert.ok(registry.getAction("favorites.cleanup"));
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