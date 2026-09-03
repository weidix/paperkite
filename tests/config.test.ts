import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromMapping, loadCatalog, updateFlowItem } from "../src/config/loader.js";

test("normalizes flow sections and exposes only referenced capabilities", () => {
  const catalog = fromMapping({
    commands: [{ id: "send", run: { capability: "messages.send", config: { text: "hi" } } }],
    triggers: [{ id: "watch", capability: "watch.group", config: {}, actions: [{ capability: "notifications.bark" }] }],
    schedules: [{ id: "archive", intervalSeconds: 60, run: { capability: "archive.sync" } }]
  });

  assert.deepEqual([...catalog.atomRefs()].sort(), ["archive.sync", "messages.send", "notifications.bark", "watch.group"]);
  assert.equal(catalog.find("command:send")?.kind, "command");
  assert.equal(catalog.find("watch")?.kind, "trigger");
});

test("expands YAML merge keys before normalizing flow configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-config-merge-"));
  const file = join(directory, "flows.yml");
  await writeFile(
    file,
    [
      "_storage: &storage",
      "  backend: postgres",
      "  url: postgresql://localhost/archive",
      "services:",
      "  - id: console",
      "    capability: runtime.console_web",
      "    config:",
      "      <<: *storage",
      "      port: 18080",
      ""
    ].join("\n")
  );

  const catalog = await loadCatalog(file);
  const service = catalog.find("service:console");
  assert.equal(service?.kind, "service");
  if (service?.kind !== "service") throw new Error("service was not loaded");
  assert.deepEqual(service.config, {
    backend: "postgres",
    url: "postgresql://localhost/archive",
    port: 18080
  });
});

test("updates an explicitly identified flow without dropping YAML comments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-config-"));
  const file = join(directory, "flows.yml");
  await writeFile(
    file,
    [
      "triggers:",
      "  - id: watcher # stable id",
      "    capability: watch.group",
      "    enabled: true # user note",
      "    config: {}",
      "    actions: []",
      ""
    ].join("\n")
  );
  const catalog = fromMapping({ triggers: [{ id: "watcher", capability: "watch.group", enabled: true, config: {}, actions: [] }] }, file);
  await assert.rejects(updateFlowItem(catalog, "trigger:watcher", { bogus: 1 }), /does not accept field bogus/);
  const next = await updateFlowItem(catalog, "trigger:watcher", { enabled: false });
  assert.ok(next);
  const watcher = next?.find("trigger:watcher");
  assert.equal(watcher?.kind === "trigger" && watcher.enabled, false);
  const updated = await readFile(file, "utf8");
  assert.match(updated, /enabled: false # user note/);
});
