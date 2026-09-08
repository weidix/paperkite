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
  normalizeMaxRuns,
  normalizePositiveInt,
  normalizeSession
} from "./model.js";

export const DEFAULT_FLOWS_PATH = "data/flows.yml";

export async function loadCatalog(path = DEFAULT_FLOWS_PATH): Promise<FlowCatalog> {
  const absolutePath = resolve(path);
  let text = "";
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return fromMapping({}, absolutePath);
    throw error;
  }
  const parsed = parse(text, { merge: true }) as unknown;
  return fromMapping(isRecord(parsed) ? parsed : {}, absolutePath);
}

export function fromMapping(value: Record<string, unknown>, path?: string): FlowCatalog {
  const definitions = {
    trigger: parseTriggers(value.triggers),
    command: parseCommands(value.commands),
    schedule: parseSchedules(value.schedules),
    service: parseServices(value.services)
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
  const entries = list(root[section], section);
  const index = entries.findIndex((entry) => String(entry.id ?? "").trim() === item.id);
  if (index < 0) throw new Error(`missing ${section} item: ${item.id}`);
  entries[index] = { ...entries[index], ...patch };
  const next = fromMapping({ ...root, [section]: entries }, catalog.path);
  await updateItemInFile(catalog.path, section, item.id, patch);
  return next;
}

function parseTriggers(value: unknown): TriggerDefinition[] {
  return list(value, "triggers").map((item, index) => {
    const capability = text(item.capability, "trigger capability");
    const actions = list(item.actions, "trigger actions").map((action) => parseAction(action));
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

function parseCommands(value: unknown): CommandDefinition[] {
  return list(value, "commands").map((item, index) => {
    if ("enabled" in item) throw new Error("commands do not support enabled; remove the entry to hide it");
    const action = parseAction(item.run);
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

function parseSchedules(value: unknown): ScheduleDefinition[] {
  return list(value, "schedules").map((item, index) => {
    const action = parseAction(item.run);
    const cron = text(item.cron, "schedule cron", false) || undefined;
    const intervalSeconds = normalizePositiveInt(item.intervalSeconds, "intervalSeconds");
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

function parseServices(value: unknown): ServiceDefinition[] {
  return list(value, "services").map((item, index) => {
    const capability = text(item.capability, "service capability");
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

function parseAction(value: unknown): ActionSpec {
  if (typeof value === "string") return { capability: value.trim(), config: {} };
  if (!isRecord(value)) throw new Error("action requires a capability string or mapping");
  const capability = text(value.capability, "action capability");
  if ("enabled" in value) throw new Error("inline actions do not support enabled");
  const hook = text(value.hook, "action hook", false) || undefined;
  return {
    capability,
    session: normalizeSession(value.session),
    config: value.config ?? {},
    hook
  };
}

function list(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
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

