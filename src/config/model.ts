export const FLOW_SECTIONS = ["triggers", "commands", "schedules", "services"] as const;
export type FlowKind = "trigger" | "command" | "schedule" | "service";

export interface ActionSpec {
  capability: string;
  session?: string;
  config: unknown;
  hook?: string;
}

export interface TriggerDefinition {
  kind: "trigger";
  id: string;
  capability: string;
  enabled: boolean;
  session?: string;
  config: unknown;
  actions: readonly ActionSpec[];
  maxRuns?: number;
  logFile: boolean;
  sourceIndex: number;
  explicitId: boolean;
}

export interface CommandDefinition {
  kind: "command";
  id: string;
  title: string;
  symbol?: string;
  action: ActionSpec;
  sourceIndex: number;
  explicitId: boolean;
}

export interface ScheduleDefinition {
  kind: "schedule";
  id: string;
  enabled: boolean;
  session?: string;
  action: ActionSpec;
  cron?: string;
  intervalSeconds?: number;
  logFile: boolean;
  sourceIndex: number;
  explicitId: boolean;
}

export interface ServiceDefinition {
  kind: "service";
  id: string;
  capability: string;
  enabled: boolean;
  session?: string;
  config: unknown;
  autoStart: boolean;
  logFile: boolean;
  sourceIndex: number;
  explicitId: boolean;
}

export type FlowDefinition = TriggerDefinition | CommandDefinition | ScheduleDefinition | ServiceDefinition;
export type FlowSection = (typeof FLOW_SECTIONS)[number];

export class FlowCatalog {
  constructor(
    readonly definitionsByKind: Readonly<Record<FlowKind, readonly FlowDefinition[]>>,
    readonly path?: string
  ) {}

  definitions(kind?: FlowKind | FlowSection): FlowDefinition[] {
    if (!kind) return FLOW_SECTIONS.flatMap((section) => this.definitionsByKind[sectionToKind(section)] as FlowDefinition[]);
    return [...this.definitionsByKind[normalizeKind(kind)]];
  }

  enabled(kind?: FlowKind | FlowSection): FlowDefinition[] {
    return this.definitions(kind).filter((item) => item.kind === "command" || item.enabled);
  }

  atomRefs(): Set<string> {
    const refs = new Set<string>();
    for (const item of this.enabled()) {
      if ("capability" in item && item.capability) refs.add(item.capability);
      if (item.kind === "schedule" || item.kind === "command") refs.add(item.action.capability);
      if (item.kind === "trigger") {
        for (const action of item.actions) refs.add(action.capability);
      }
    }
    return refs;
  }

  find(identifier: string, kind?: FlowKind): FlowDefinition | undefined {
    const value = identifier.trim();
    const separator = value.indexOf(":");
    const requestedKind = separator >= 0 ? normalizeKind(value.slice(0, separator)) : kind;
    const requestedId = separator >= 0 ? value.slice(separator + 1) : value;
    const candidates = this.definitions(requestedKind);
    const matches = candidates.filter((item) => item.id === requestedId);
    if (matches.length > 1) throw new Error(`flow id is ambiguous: ${identifier}`);
    return matches[0];
  }
}

export function normalizeKind(kind: string): FlowKind {
  if (kind === "triggers" || kind === "trigger") return "trigger";
  if (kind === "commands" || kind === "command") return "command";
  if (kind === "schedules" || kind === "schedule") return "schedule";
  if (kind === "services" || kind === "service") return "service";
  throw new Error(`unknown flow kind: ${kind}`);
}

function sectionToKind(section: FlowSection): FlowKind {
  return normalizeKind(section);
}

export function normalizeBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(normalized)) return true;
    if (["false", "no", "off", "0", ""].includes(normalized)) return false;
    throw new Error(`invalid boolean: ${value}`);
  }
  return Boolean(value);
}

export function normalizeSession(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

export function normalizePositiveInt(value: unknown, field: string, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer`);
  return number;
}

export function normalizeMaxRuns(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "" || Number(value) === -1) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error("maxRuns must be a positive integer or -1");
  return number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
