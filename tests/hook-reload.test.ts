import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActionHook } from "@paperkite/sdk";
import { invalidateAllHooks, invalidateHook, loadHook, normalizeHookResult } from "../src/engine/hooks.js";

function run(hook: ActionHook | undefined): string {
  return (hook as unknown as () => string)();
}

function hookSource(version: string): string {
  return `interface Payload { version: string }\nexport default (): string => "${version}";\n`;
}

test("loadHook keeps the loaded hook until invalidated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-hooks-"));
  const flows = join(directory, "flows.yml");
  try {
    await writeFile(join(directory, "hook.ts"), hookSource("v1"));
    const first = await loadHook("hook.ts", flows);
    assert.equal(run(first), "v1");
    await writeFile(join(directory, "hook.ts"), hookSource("v2"));
    const second = await loadHook("hook.ts", flows);
    assert.equal(first, second, "content stays cached without an invalidation");
    assert.equal(run(second), "v1");
    invalidateHook("hook.ts", flows);
    const third = await loadHook("hook.ts", flows);
    assert.notEqual(first, third, "invalidation reloads the hook from disk");
    assert.equal(run(third), "v2");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normalizeHookResult merges a transformed payload and honours a skip", () => {
  assert.deepEqual(normalizeHookResult({ value: "after" }, { value: "before", keep: 1 }), {
    config: { value: "after", keep: 1 },
    skip: false
  });
  assert.deepEqual(normalizeHookResult({ skip: true }, { value: "before" }), {
    config: { value: "before" },
    skip: true
  });
  assert.deepEqual(normalizeHookResult(undefined, { value: "before" }), {
    config: { value: "before" },
    skip: false
  });
  assert.deepEqual(normalizeHookResult("replacement", { value: "before" }), {
    config: "replacement",
    skip: false
  });
});

test("invalidateAllHooks clears every cached hook", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paperkite-hooks-"));
  const flows = join(directory, "flows.yml");
  try {
    await writeFile(join(directory, "a.ts"), hookSource("a"));
    await writeFile(join(directory, "b.ts"), hookSource("b"));
    const firstA = await loadHook("a.ts", flows);
    const firstB = await loadHook("b.ts", flows);
    invalidateAllHooks();
    await writeFile(join(directory, "a.ts"), hookSource("a2"));
    await writeFile(join(directory, "b.ts"), hookSource("b2"));
    const secondA = await loadHook("a.ts", flows);
    const secondB = await loadHook("b.ts", flows);
    assert.notEqual(firstA, secondA);
    assert.notEqual(firstB, secondB);
    assert.equal(run(secondA), "a2");
    assert.equal(run(secondB), "b2");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});