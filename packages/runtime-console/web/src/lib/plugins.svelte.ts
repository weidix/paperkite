import { api } from "$lib/api";
import type { PluginInfo } from "$lib/runtime";

let cached: Promise<readonly PluginInfo[]> | null = null;

export function loadPlugins(): Promise<readonly PluginInfo[]> {
  if (!cached) cached = api.plugins();
  return cached;
}

export function actionCapabilities(plugins: readonly PluginInfo[]): string[] {
  const names = new Set<string>();
  for (const plugin of plugins) {
    for (const item of plugin.capabilities) {
      if (item.kind === "action") names.add(item.name);
    }
  }
  return [...names].sort();
}
