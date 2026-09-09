import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ActionHook } from "@paperkite/sdk";

const loaded = new Map<string, ActionHook>();

export async function loadHook(reference: string | undefined, configFile: string | undefined): Promise<ActionHook | undefined> {
  if (!reference) return undefined;
  const file = hookFile(reference, configFile);
  const cached = loaded.get(file);
  if (cached) return cached;
  const hook = await importHook(file);
  loaded.set(file, hook);
  return hook;
}

export function invalidateHook(reference: string | undefined, configFile: string | undefined): void {
  if (!reference) return;
  loaded.delete(hookFile(reference, configFile));
}

export function invalidateAllHooks(): void {
  loaded.clear();
}

function hookFile(reference: string, configFile: string | undefined): string {
  const base = configFile ? resolve(configFile, "..") : process.cwd();
  return resolve(base, reference);
}

async function importHook(file: string): Promise<ActionHook> {
  const source = await readFile(file, "utf8");
  const js = stripTypeScriptTypes(source, { sourceUrl: pathToFileURL(file).href });
  const url = `data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`;
  const module = (await import(url)) as { default?: unknown };
  if (typeof module.default !== "function") throw new Error("hook must export a default function: " + file);
  return module.default as ActionHook;
}