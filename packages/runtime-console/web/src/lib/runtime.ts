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

export type SessionState = "starting" | "connected" | "isolated" | "waiting-auth";

export interface SessionSnapshot {
  readonly name: string;
  readonly state: SessionState;
  readonly since: string;
  readonly reason?: string;
  readonly attempts: number;
  readonly flows: readonly FlowRef[];
}

export interface FlowSuspension {
  readonly since: string;
  readonly reason: string;
  readonly session?: string;
  readonly error?: string;
}

export type StopReason = "error" | "stop" | "maxruns" | "finished";

export interface FlowLastStop {
  readonly reason: StopReason;
  readonly error?: string;
  readonly at: string;
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
  readonly actionSession?: string;
  readonly autoStart?: boolean;
  readonly cron?: string;
  readonly intervalSeconds?: number;
  readonly maxRuns?: number;
  readonly config?: unknown;
  readonly actions?: readonly ActionSpecView[];
  readonly hook?: string;
  readonly logFile: boolean;
  readonly startedAt?: string;
  readonly suspended?: FlowSuspension;
  readonly lastStop?: FlowLastStop;
  readonly warnings?: readonly string[];
  readonly pendingReload?: boolean;
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
  readonly configDirty: boolean;
  readonly flowsFile?: string;
  readonly triggers: readonly string[];
  readonly services: readonly string[];
  readonly schedules: readonly string[];
  readonly activeServices: readonly string[];
  readonly activeActions: readonly ActiveActionView[];
  readonly sessions: readonly SessionSnapshot[];
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
  readonly used?: boolean;
}

export interface ActionSpecInput {
  readonly capability: string;
  readonly config?: unknown;
  readonly session?: string;
  readonly hook?: string;
  readonly label?: string;
}

export interface FlowPatch {
  readonly enabled?: boolean;
  readonly config?: unknown;
  readonly session?: string;
  readonly cron?: string;
  readonly intervalSeconds?: number;
  readonly title?: string;
  readonly symbol?: string;
  readonly autoStart?: boolean;
  readonly maxRuns?: number;
  readonly logFile?: boolean;
  readonly actions?: readonly ActionSpecInput[];
  readonly run?: ActionSpecInput | string;
}

export interface ActionStartedEvent {
  readonly type: "action.started";
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly flow?: FlowRef;
  readonly hook?: string;
  readonly config?: unknown;
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
  readonly effectiveConfig?: unknown;
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
  readonly reason: StopReason;
  readonly error?: string;
  readonly durationMs: number;
  readonly at: string;
}

export interface TriggerStoppedEvent {
  readonly type: "trigger.stopped";
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly reason: StopReason;
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

export interface FlowsReloadingEvent {
  readonly type: "flows.reloading";
  readonly at: string;
}

export interface FlowsReloadedEvent {
  readonly type: "flows.reloaded";
  readonly ok: boolean;
  readonly error?: string;
  readonly at: string;
}

export interface SessionStateEvent {
  readonly type: "session.state";
  readonly name: string;
  readonly state: SessionState;
  readonly reason?: string;
  readonly since: string;
  readonly at: string;
}

export interface FlowSuspendedEvent {
  readonly type: "flow.suspended";
  readonly id: string;
  readonly kind: FlowKind;
  readonly session: string;
  readonly error?: string;
  readonly at: string;
}

export interface FlowResumedEvent {
  readonly type: "flow.resumed";
  readonly id: string;
  readonly kind: FlowKind;
  readonly session: string;
  readonly at: string;
}

export type RuntimeEvent =
  | ActionStartedEvent
  | ActionFinishedEvent
  | ServiceStartedEvent
  | ServiceStoppedEvent
  | TriggerStoppedEvent
  | FlowUpdatedEvent
  | FlowReloadedEvent
  | FlowFinishedEvent
  | ScheduleFiredEvent
  | FlowsReloadingEvent
  | FlowsReloadedEvent
  | SessionStateEvent
  | FlowSuspendedEvent
  | FlowResumedEvent;

export const RUNTIME_EVENT_TYPES = [
  "action.started",
  "action.finished",
  "service.started",
  "service.stopped",
  "trigger.stopped",
  "flow.updated",
  "flow.reloaded",
  "flow.finished",
  "schedule.fired",
  "flows.reloading",
  "flows.reloaded",
  "session.state",
  "flow.suspended",
  "flow.resumed"
] as const;