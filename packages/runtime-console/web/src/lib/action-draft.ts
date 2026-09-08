import { parseJson, prettyJson } from "$lib/format";
import type { ActionSpecInput } from "$lib/runtime";

export interface ActionDraft {
  capability: string;
  session: string;
  hook: string;
  configText: string;
  configError: string | null;
}

export function createDraft(
  capability: string,
  session: string | undefined,
  hook: string | undefined,
  config: unknown
): ActionDraft {
  return {
    capability,
    session: session ?? "",
    hook: hook ?? "",
    configText: prettyJson(config ?? {}),
    configError: null
  };
}

export interface DraftResult {
  spec?: ActionSpecInput;
  error?: string;
}

export function parseDraft(draft: ActionDraft): DraftResult {
  const capability = draft.capability.trim();
  if (!capability) return { error: "动作需要能力名" };
  let config: unknown;
  try {
    config = parseJson(draft.configText);
  } catch {
    return { error: "config 不是合法 JSON" };
  }
  return {
    spec: {
      capability,
      session: draft.session.trim() || undefined,
      hook: draft.hook.trim() || undefined,
      config
    }
  };
}

export function isEmptyConfig(config: unknown): boolean {
  if (config === undefined || config === null) return true;
  if (typeof config === "object") return false;
  return String(config).trim() === "";
}
