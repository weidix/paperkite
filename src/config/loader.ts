import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { updateItemInFile } from "./editor.js";
import {
  FlowCatalog,
  type ActionSpec,
  type CommandDefinition,
  type FlowDefinition,
  type FlowKind,
  type FlowSection,
  type ScheduleDefinition,
  type ServiceDefinition,
  type TriggerDefinition,
  isRecord,
  normalizeBool,
  normalizeKind,
  normalizeMaxRuns,
  normalizePositiveInt,
  normalizeSession
} from "./model.js";

export const DEFAULT_FLOWS_PATH = "data/flows.yml";

export async function loadCatalog(path = DEFAULT_FLOWS_PATH, strict = true): Promise<FlowCatalog> {
  const absolutePath = resolve(path);
  let text = "";
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return fromMapping({}, absolutePath, strict);
    throw error;
  }
  const parsed = parse(text, { merge: true }) as unknown;
  return fromMapping(isRecord(parsed) ? parsed : {}, absolutePath, strict);
}

export function fromMapping(value: Record<string, unknown>, path?: string, strict = true): FlowCatalog {
  const definitions = {
    trigger: parseTriggers(value.triggers, strict),
    command: parseCommands(value.commands, strict),
    schedule: parseSchedules(value.schedules, strict),
    service: parseServices(value.services, strict)
  } satisfies Record<FlowKind, FlowDefinition[]>;
  for (const [kind, items] of Object.entries(definitions) as [FlowKind, FlowDefinition[]][]) {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`duplicate ${kind} id: ${item.id}`);
      ids.add(item.id);
    }
  }
  return new FlowCatalog(definitions, path);
}

const PATCH_FIELDS: Readonly<Record<FlowKind, readonly string[]>> = {
  trigger: ["enabled", "config", "session", "maxRuns", "logFile", "actions"],
  command: ["title", "symbol", "run"],
  schedule: ["enabled", "session", "cron", "intervalSeconds", "logFile", "run"],
  service: ["enabled", "config", "session", "autoStart", "logFile"]
};

export async function updateFlowItem(
  catalog: FlowCatalog,
  identifier: string,
  patch: Record<string, unknown>,
  kind?: FlowKind
): Promise<FlowCatalog | undefined> {
  const item = catalog.find(identifier, kind);
  if (!item || !item.explicitId || !catalog.path) return undefined;
  const allowed = PATCH_FIELDS[item.kind];
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) throw new Error(`flow ${item.id} does not accept field ${key}`);
  }
  const section = sectionFor(item.kind);
  const root = parse(await readFile(catalog.path, "utf8"), { merge: true }) as Record<string, unknown>;
  const entries = list(root[section], section, true);
  const index = entries.findIndex((entry) => String(entry.id ?? "").trim() === item.id);
  if (index < 0) throw new Error(`missing ${section} item: ${item.id}`);
  entries[index] = { ...entries[index], ...patch };
  const next = fromMapping({ ...root, [section]: entries }, catalog.path);
  await updateItemInFile(catalog.path, section, item.id, patch);
  return next;
}

function parseTriggers(value: unknown, strict: boolean): TriggerDefinition[] {
  return list(value, "triggers", strict).map((item, index) => {
    const capability = text(item.capability, "trigger capability");
    const actions = list(item.actions, "trigger actions", strict).map((action) => parseAction(action, undefined, strict));
    return {
      kind: "trigger",
      id: makeId(capability, item.id, index),
      capability,
      enabled: normalizeBool(item.enabled, true),
      session: normalizeSession(item.session),
      config: item.config ?? {},
      actions,
      maxRuns: normalizeMaxRuns(item.maxRuns),
      logFile: normalizeBool(item.logFile, false),
      sourceIndex: index,
      explicitId: hasId(item.id)
    };
  });
}

function parseCommands(value: unknown, strict: boolean): CommandDefinition[] {
  return list(value, "commands", strict).map((item, index) => {
    if (strict && "enabled" in item) throw new Error("commands do not support enabled; remove the entry to hide it");
    const action = parseAction(item.run ?? item.action, item.config, strict);
    const id = makeId(action.capability, item.id, index);
    return {
      kind: "command",
      id,
      title: text(item.title, "command title", false) || id,
      symbol: text(item.symbol, "command symbol", false) || undefined,
      action,
      sourceIndex: index,
      explicitId: hasId(item.id)
    };
  });
}

function parseSchedules(value: unknown, strict: boolean): ScheduleDefinition[] {
  return list(value, "schedules", strict).map((item, index) => {
    const action = parseAction(item.run ?? item.action, item.config, strict);
    const cron = text(item.cron, "schedule cron", false) || undefined;
    const intervalSeconds = normalizePositiveInt(item.intervalSeconds ?? item.everySeconds, "intervalSeconds");
    if ((cron ? 1 : 0) + (intervalSeconds ? 1 : 0) !== 1) {
      throw new Error(`schedule ${item.id ?? index + 1} needs exactly one of cron or intervalSeconds`);
    }
    return {
      kind: "schedule",
      id: makeId(action.capability, item.id, index),
      enabled: normalizeBool(item.enabled, true),
      session: normalizeSession(item.session),
      action,
      cron,
      intervalSeconds,
      logFile: normalizeBool(item.logFile, false),
      sourceIndex: index,
      explicitId: hasId(item.id)
    };
  });
}

function parseServices(value: unknown, strict: boolean): ServiceDefinition[] {
  return list(value, "services", strict).map((item, index) => {
    const capability = text(item.capability, "service capability");
    if (strict && ("endpoint" in item || "processMode" in item)) {
      throw new Error(`service ${item.id ?? index + 1} does not accept endpoint or processMode`);
    }
    return {
      kind: "service",
      id: makeId(capability, item.id, index),
      capability,
      enabled: normalizeBool(item.enabled, true),
      session: normalizeSession(item.session),
      config: item.config ?? {},
      autoStart: normalizeBool(item.autoStart, true),
      logFile: normalizeBool(item.logFile, false),
      sourceIndex: index,
      explicitId: hasId(item.id)
    };
  });
}

function parseAction(value: unknown, fallbackConfig: unknown, strict: boolean): ActionSpec {
  if (typeof value === "string") return { capability: value.trim(), config: fallbackConfig ?? {} };
  if (!isRecord(value)) throw new Error("action requires a capability string or mapping");
  const capability = text(value.capability, "action capability");
  if (strict && "enabled" in value) throw new Error("inline actions do not support enabled");
  const hook = text(value.hook, "action hook", false) || undefined;
  return {
    capability,
    session: normalizeSession(value.session),
    config: value.config ?? fallbackConfig ?? {},
    hook
  };
}

function list(value: unknown, field: string, strict: boolean): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (!strict) return [];
    throw new Error(`${field} must be a list`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${field}[${index + 1}] must be a mapping`);
    return item;
  });
}

function text(value: unknown, field: string, required = true): string {
  const result = value === undefined || value === null ? "" : String(value).trim();
  if (required && !result) throw new Error(`${field} is required`);
  return result;
}

function hasId(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function makeId(capability: string, value: unknown, index: number): string {
  if (hasId(value)) return String(value).trim();
  return `${capability.replaceAll(/[^a-zA-Z0-9._-]+/g, "-")}-${index + 1}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function sectionFor(kind: FlowKind): FlowSection {
  return `${kind}s` as FlowSection;
}

export function kindFor(value: FlowKind | FlowSection): FlowKind {
  return normalizeKind(value);
}
