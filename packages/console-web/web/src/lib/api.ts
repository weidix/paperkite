import type { ActionSpecInput, FlowPatch, PluginInfo, RuntimeSnapshot } from "$lib/runtime";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init.body !== null) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // 非 JSON 响应原样展示
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  snapshot(): Promise<RuntimeSnapshot> {
    return request("/api/snapshot");
  },

  plugins(): Promise<PluginInfo[]> {
    return request("/api/plugins");
  },

  logLines(scope: string, lines: number): Promise<{ scope: string; lines: readonly string[] }> {
    const query = new URLSearchParams({ lines: String(lines) });
    return request(`/api/logs/${encodeURIComponent(scope)}?${query}`);
  },

  runAction(spec: ActionSpecInput): Promise<{ ok: boolean }> {
    return request("/api/action/run", { method: "POST", body: JSON.stringify({ spec }) });
  },

  runFlow(id: string): Promise<{ ok: boolean }> {
    return request(`/api/flows/${encodeURIComponent(id)}/run`, { method: "POST" });
  },

  reloadFlow(id: string): Promise<{ ok: boolean }> {
    return request(`/api/flows/${encodeURIComponent(id)}/reload`, { method: "POST" });
  },

  updateFlow(id: string, patch: FlowPatch): Promise<{ ok: boolean; changed: boolean }> {
    return request(`/api/flows/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  startService(id: string): Promise<{ ok: boolean }> {
    return request(`/api/services/${encodeURIComponent(id)}/start`, { method: "POST" });
  },

  stopService(id: string): Promise<{ ok: boolean }> {
    return request(`/api/services/${encodeURIComponent(id)}/stop`, { method: "POST" });
  },

  reloadRuntime(): Promise<{ ok: boolean }> {
    return request("/api/runtime/reload", { method: "POST" });
  }
};