export type CapabilityKind = "action" | "trigger" | "service";

export interface RuntimeLogger {
  debug(message: string, ...values: unknown[]): void;
  info(message: string, ...values: unknown[]): void;
  warn(message: string, ...values: unknown[]): void;
  error(message: string, ...values: unknown[]): void;
  child(scope: string): RuntimeLogger;
}

export interface TriggerEvent {
  readonly id?: number;
  readonly text: string;
  readonly senderId?: string;
  readonly senderUsername?: string;
  readonly senderName?: string;
  readonly chatId?: string;
  readonly chatTitle?: string;
  readonly date?: string;
  readonly raw: unknown;
}

export interface TriggerEmission {
  readonly source: {
    readonly id: string;
    readonly capability: string;
  };
  readonly event: TriggerEvent | Record<string, unknown>;
}

export type SessionState = "starting" | "connected" | "isolated" | "waiting-auth";

/** 会话不可用的数据描述；判别按 `code` 字段进行。 */
export interface SessionUnavailable {
  readonly code: "session_unavailable";
  readonly session: string;
  readonly state: SessionState;
}

export interface SessionAccess {
  run<T>(operation: (client: unknown) => T | Promise<T>): Promise<T>;
}

export interface ActionContext<P = unknown> {
  readonly id: string;
  readonly abi: number;
  readonly config: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly control?: RuntimeControl;
  readonly logger: RuntimeLogger;
  readonly emission: TriggerEmission | undefined;
  spawn(task: Promise<unknown>): void;
}

export interface TriggerContext<P = unknown> {
  readonly id: string;
  readonly abi: number;
  readonly capability: string;
  readonly config: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly control?: RuntimeControl;
  readonly logger: RuntimeLogger;
  readonly emit?: (event: TriggerEvent | Record<string, unknown>) => Promise<void>;
}

export interface ServiceContext<P = unknown> {
  readonly id: string;
  readonly abi: number;
  readonly capability: string;
  readonly config: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly control?: RuntimeControl;
  readonly logger: RuntimeLogger;
}

export interface ActionHandler<P = unknown> {
  run(context: ActionContext<P>): Promise<void>;
}

export interface TriggerHandler<P = unknown> {
  run(context: TriggerContext<P>): Promise<void>;
}

export interface ServiceHandler<P = unknown> {
  run(context: ServiceContext<P>): Promise<void>;
}

export interface ActionHookResult {
  config?: unknown;
  skip?: boolean;
}

export type ActionHook = (input: {
  config: unknown;
  emission: TriggerEmission | undefined;
  signal: AbortSignal;
}) => ActionHookResult | unknown | Promise<ActionHookResult | unknown>;

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

export interface FlowSuspension {
  readonly since: string;
  readonly reason: string;
  readonly session?: string;
  readonly error?: string;
}

export interface LogScopeInfo {
  readonly scope: string;
  readonly path: string;
}

export interface SessionSnapshot {
  readonly name: string;
  readonly state: SessionState;
  readonly since: string;
  readonly reason?: string;
  readonly attempts: number;
  readonly flows: readonly FlowRef[];
}

export interface ActiveActionView {
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly flow?: FlowRef;
  readonly startedAt: string;
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

export interface ActionSpecInput {
  readonly capability: string;
  readonly config?: unknown;
  readonly session?: string;
  readonly hook?: string;
  readonly label?: string;
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

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export type Unsubscribe = () => void;

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

export interface RuntimeControl {
  readonly snapshot: RuntimeSnapshot;
  executeAction(spec: ActionSpecInput): Promise<void>;
  runFlow(identifier: string): Promise<void>;
  updateFlow(identifier: string, patch: FlowPatch): Promise<boolean>;
  reloadFlow(identifier: string): Promise<boolean>;
  startService(identifier: string): Promise<void>;
  stopService(identifier: string): Promise<void>;
  reload(): Promise<void>;
  reconnectSession(name: string): Promise<void>;
  listPlugins(): readonly PluginInfo[];
  subscribe(listener: RuntimeEventListener): Unsubscribe;
}

export type ConfigValidator = (config: unknown) => readonly string[];

export interface CapabilityOptions {
  readonly control?: boolean;
  readonly validateConfig?: ConfigValidator;
}

export type ActionConstructor = new () => ActionHandler<any>;
export type TriggerConstructor = new () => TriggerHandler<any>;
export type ServiceConstructor = new () => ServiceHandler<any>;

export interface PluginCapability {
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly handler?: string;
  readonly control?: boolean;
  /** 校验器本身，或插件模块导出的符号名（清单为 JSON 时只能写符号名）。 */
  readonly validateConfig?: ConfigValidator | string;
}

export interface PluginInfo {
  readonly name: string;
  readonly version?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly loaded: boolean;
  /** 任一启用流程引用了该插件的能力。 */
  readonly used: boolean;
}

export interface PluginModule {
  readonly [handler: string]: unknown;
}
