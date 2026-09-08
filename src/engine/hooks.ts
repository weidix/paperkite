import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ActionHook } from "@paperkite/sdk";

export async function loadHook(reference: string | undefined, configFile: string | undefined): Promise<ActionHook | undefined> {
  if (!reference) return undefined;
  const base = configFile ? resolve(configFile, "..") : process.cwd();
  const file = resolve(base, reference);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") throw new Error("hook must export a default function: " + reference);
  return loaded.default as ActionHook;
}