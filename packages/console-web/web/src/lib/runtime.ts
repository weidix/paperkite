export type FlowKind = "trigger" | "command" | "schedule" | "service";

export interface FlowRef {
  readonly kind: FlowKind;
  readonly id: string;
}

export interface ActionSpecView {
  readonly capability: string;
  readonly session?: string;
  readonly config?: unknown;
  readonly hook?: string;
}

export interface FlowSnapshot {
  readonly kind: FlowKind;
  readonly id: string;
  readonly capability: string;
  readonly title?: string;
  readonly symbol?: string;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly session?: string;
  readonly autoStart?: boolean;
  readonly cron?: string;
  readonly intervalSeconds?: number;
  readonly maxRuns?: number;
  readonly config?: unknown;
  readonly actions?: readonly ActionSpecView[];
  readonly hook?: string;
  readonly logFile: boolean;
  readonly startedAt?: string;
}

export interface ActiveActionView {
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly flow?: FlowRef;
  readonly startedAt: string;
}

export interface LogScopeInfo {
  readonly scope: string;
  readonly path: string;
}

export interface RuntimeSnapshot {
  readonly running: boolean;
  readonly pid: number;
  readonly uptimeSeconds: number;
  readonly triggers: readonly string[];
  readonly services: readonly string[];
  readonly schedules: readonly string[];
  readonly activeServices: readonly string[];
  readonly activeActions: readonly ActiveActionView[];
  readonly flows: readonly FlowSnapshot[];
  readonly logs: readonly LogScopeInfo[];
}

export interface PluginCapability {
  readonly kind: "action" | "trigger" | "service";
  readonly name: string;
}

export interface PluginInfo {
  readonly name: string;
  readonly version?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly loaded: boolean;
}

export interface ActionSpecInput {
  readonly capability: string;
  readonly config?: unknown;
  readonly session?: string;
  readonly hook?: string;
  readonly label?: string;
}

export interface FlowPatch {
  enabled?: boolean;
  config?: unknown;
  session?: string;
  cron?: string;
  intervalSeconds?: number;
  title?: string;
  symbol?: string;
  autoStart?: boolean;
  maxRuns?: number;
  logFile?: boolean;
  actions?: readonly ActionSpecInput[];
  run?: ActionSpecInput | string;
}

export interface ActionStartedEvent {
  readonly type: "action.started";
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly flow?: FlowRef;
  readonly hook?: string;
  readonly payload?: unknown;
  readonly at: string;
}

export interface ActionFinishedEvent {
  readonly type: "action.finished";
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly flow?: FlowRef;
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly durationMs: number;
  readonly error?: string;
  readonly effectivePayload?: unknown;
  readonly at: string;
}

export interface ServiceStartedEvent {
  readonly type: "service.started";
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly at: string;
}

export interface ServiceStoppedEvent {
  readonly type: "service.stopped";
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly reason: "stop" | "error" | "finished";
  readonly error?: string;
  readonly durationMs: number;
  readonly at: string;
}

export interface FlowUpdatedEvent {
  readonly type: "flow.updated";
  readonly id: string;
  readonly kind: FlowKind;
  readonly at: string;
}

export interface FlowReloadedEvent {
  readonly type: "flow.reloaded";
  readonly id: string;
  readonly kind: FlowKind;
  readonly at: string;
}

export interface FlowFinishedEvent {
  readonly type: "flow.finished";
  readonly kind: FlowKind;
  readonly id: string;
  readonly capability: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly at: string;
}

export interface ScheduleFiredEvent {
  readonly type: "schedule.fired";
  readonly id: string;
  readonly cron?: string;
  readonly intervalSeconds?: number;
  readonly at: string;
}

export interface ConfigReloadingEvent {
  readonly type: "config.reloading";
  readonly at: string;
}

export interface ConfigReloadedEvent {
  readonly type: "config.reloaded";
  readonly ok: boolean;
  readonly error?: string;
  readonly at: string;
}

export type RuntimeEvent =
  | ActionStartedEvent
  | ActionFinishedEvent
  | ServiceStartedEvent
  | ServiceStoppedEvent
  | FlowUpdatedEvent
  | FlowReloadedEvent
  | FlowFinishedEvent
  | ScheduleFiredEvent
  | ConfigReloadingEvent
  | ConfigReloadedEvent;

export const RUNTIME_EVENT_TYPES = [
  "action.started",
  "action.finished",
  "service.started",
  "service.stopped",
  "flow.updated",
  "flow.reloaded",
  "flow.finished",
  "schedule.fired",
  "config.reloading",
  "config.reloaded"
] as const;