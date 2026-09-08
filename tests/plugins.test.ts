import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeLogger } from "@paperkite/sdk";
import { loadExtensions } from "../src/extensions/loader.js";

const pluginDirectories = [
  "messages",
  "notify-bark",
  "messages-watch",
  "account-health",
  "archive",
  "process-run",
  "runtime-console"
];

const logger: RuntimeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return logger;
  }
};

test("each actual plugin owns one manifest and shared packages stay ordinary", async () => {
  for (const directory of pluginDirectories) {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "packages", directory, "package.json"), "utf8")) as {
      name: string;
      paperkite?: { plugin?: unknown };
    };
    assert.ok(manifest.paperkite?.plugin, directory);
  }
  for (const directory of ["sdk"]) {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "packages", directory, "package.json"), "utf8")) as {
      paperkite?: unknown;
    };
    assert.equal(manifest.paperkite, undefined, directory);
  }
});

const ALL_CAPABILITIES = [
  "account.health",
  "archive.sync",
  "archive.console",
  "messages.send",
  "messages.watch",
  "messages.poll",
  "notify.bark",
  "process.run",
  "runtime.console"
];

test("bundles load through the extension loader and bind declared handlers", async () => {
  const { registry, installed, packages } = await loadExtensions(ALL_CAPABILITIES, { logger });
  assert.equal(installed.length, 7);
  assert.equal(packages.length, 7);
  assert.equal(registry.actions.size, 4);
  assert.equal(registry.triggers.size, 3);
  assert.equal(registry.services.size, 2);
  assert.ok(registry.getAction("archive.sync"));
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