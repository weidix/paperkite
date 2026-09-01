import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ActionHook } from "@paperkite/sdk";

export async function loadHook(reference: string | undefined, configFile: string | undefined): Promise<ActionHook | undefined> {
  if (!reference) return undefined;
  const base = configFile ? resolve(configFile, "..") : process.cwd();
  const file = resolve(base, reference);
  await readFile(file);
  const loaded = (await import(pathToFileURL(file).href)) as {
    default?: unknown;
    handle?: unknown;
    transform?: unknown;
  };
  const candidate = loaded.default ?? loaded.handle ?? loaded.transform;
  if (typeof candidate !== "function") throw new Error("hook must export a function: " + reference);
  return candidate as ActionHook;
}
