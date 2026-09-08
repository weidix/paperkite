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

export class SessionUnavailableError extends Error {
  constructor(
    readonly session: string,
    readonly state: SessionState,
    reason?: string
  ) {
    super("session " + session + " is " + state + (reason ? ": " + reason : ""));
  }
}

export function isSessionUnavailable(error: unknown): error is SessionUnavailableError {
  return error instanceof SessionUnavailableError;
}

export interface SessionAccess {
  run<T>(operation: (client: unknown) => T | Promise<T>): Promise<T>;
}

export interface ActionOutcome {
  readonly skipped: boolean;
  readonly effectiveConfig?: unknown;
}

export interface ActionContext<P = unknown> {
  readonly id: string;
  config: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly control?: RuntimeControl;
  readonly logger: RuntimeLogger;
  emission: TriggerEmission | undefined;
  readonly hook?: ActionHook;
  spawn(task: Promise<unknown>): void;
  outcome?: ActionOutcome;
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

export abstract class Action<P = unknown> {
  constructor(protected readonly context: ActionContext<P>) {}

  get id(): string {
    return this.context.id;
  }

  get config(): P {
    return this.context.config;
  }

  set config(value: P) {
    this.context.config = value;
  }

  get session(): string | undefined {
    return this.context.session;
  }

  get signal(): AbortSignal {
    return this.context.signal;
  }

  get sessions(): SessionAccess | undefined {
    return this.context.sessions;
  }

  get control(): RuntimeControl | undefined {
    return this.context.control;
  }

  get emission(): TriggerEmission | undefined {
    return this.context.emission;
  }

  async execute(): Promise<void> {
    const baseline = cloneValue(this.context.config) as P;
    try {
      if (this.context.hook) {
        const result = await this.context.hook({
          config: this.context.config,
          emission: this.context.emission,
          signal: this.context.signal
        });
        const decision = normalizeHookResult(result, this.context.config);
        this.context.config = decision.config as P;
        this.context.outcome = { skipped: decision.skip, effectiveConfig: cloneValue(decision.config) };
        if (decision.skip) return;
      }
      await this.run();
    } finally {
      this.context.config = baseline;
    }
  }

  protected abstract run(): Promise<void>;
}

export abstract class Trigger<P = unknown> {
  private runCount = 0;

  constructor(protected readonly context: TriggerContext<P>) {}

  get id(): string {
    return this.context.id;
  }

  get config(): P {
    return this.context.config;
  }

  get session(): string | undefined {
    return this.context.session;
  }

  get signal(): AbortSignal {
    return this.context.signal;
  }

  get sessions(): SessionAccess | undefined {
    return this.context.sessions;
  }

  get control(): RuntimeControl | undefined {
    return this.context.control;
  }

  protected async emit(event: TriggerEvent | Record<string, unknown>): Promise<void> {
    if (!this.context.emit || !this.canRun()) return;
    this.recordRun();
    await this.context.emit(event);
  }

  protected canRun(): boolean {
    return this.context.maxRuns === undefined || this.runCount < this.context.maxRuns;
  }

  protected recordRun(): boolean {
    this.runCount += 1;
    return this.context.maxRuns === undefined || this.runCount < this.context.maxRuns;
  }

  abstract run(): Promise<void>;
}

export interface TriggerContext<P = unknown> {
  readonly id: string;
  readonly capability: string;
  readonly config: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly control?: RuntimeControl;
  readonly logger: RuntimeLogger;
  readonly maxRuns?: number;
  readonly emit?: (event: TriggerEvent | Record<string, unknown>) => Promise<void>;
}

export abstract class Service<P = unknown> {
  constructor(protected readonly context: ServiceContext<P>) {}

  get id(): string {
    return this.context.id;
  }

  get config(): P {
    return this.context.config;
  }

  get session(): string | undefined {
    return this.context.session;
  }

  get signal(): AbortSignal {
    return this.context.signal;
  }

  get sessions(): SessionAccess | undefined {
    return this.context.sessions;
  }

  get control(): RuntimeControl | undefined {
    return this.context.control;
  }

  abstract run(): Promise<void>;
}

export interface ServiceContext<P = unknown> {
  readonly id: string;
  readonly capability: string;
  readonly config: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly control?: RuntimeControl;
  readonly logger: RuntimeLogger;
}

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
  readonly suspended?: FlowSuspension;
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
  readonly triggers: readonly string[];
  readonly services: readonly string[];
  readonly schedules: readonly string[];
  readonly activeServices: readonly string[];
  readonly activeActions: readonly ActiveActionView[];
  readonly sessions: readonly SessionSnapshot[];
  readonly flows: readonly FlowSnapshot[];
  readonly logs: readonly LogScopeInfo[];
}

export type SessionLoginReply =
  | { readonly status: "ok" }
  | {
      readonly status: "prompt";
      readonly kind: "phone" | "code" | "password";
      readonly message?: string;
    }
  | { readonly status: "error"; readonly message: string };

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
  beginSessionLogin(name: string): Promise<SessionLoginReply>;
  submitSessionLogin(name: string, value: string): Promise<SessionLoginReply>;
  listPlugins(): readonly PluginInfo[];
  subscribe(listener: RuntimeEventListener): Unsubscribe;
}

export interface CapabilityOptions {
  readonly control?: boolean;
}

export type ActionConstructor = new (context: ActionContext<any>) => Action<any>;
export type TriggerConstructor = new (context: TriggerContext<any>) => Trigger<any>;
export type ServiceConstructor = new (context: ServiceContext<any>) => Service<any>;

export interface PluginCapability {
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly handler?: string;
  readonly control?: boolean;
}

export interface PluginInfo {
  readonly name: string;
  readonly version?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly loaded: boolean;
}

export interface PluginModule {
  readonly [handler: string]: unknown;
}

function normalizeHookResult(result: unknown, current: unknown): { config: unknown; skip: boolean } {
  if (isHookResult(result)) {
    return {
      config: result.config === undefined ? current : mergeConfig(current, result.config),
      skip: result.skip === true
    };
  }
  return { config: result === undefined ? current : mergeConfig(current, result), skip: false };
}

function isHookResult(value: unknown): value is ActionHookResult {
  return typeof value === "object" && value !== null && ("config" in value || "skip" in value);
}

function mergeConfig(current: unknown, next: unknown): unknown {
  if (isRecord(current) && isRecord(next)) return { ...current, ...next };
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}
