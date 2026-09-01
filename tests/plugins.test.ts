import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const pluginDirectories = [
  "telegram-messages",
  "bark",
  "conversation-watch",
  "account-watch",
  "message-archive",
  "process-command"
];

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
