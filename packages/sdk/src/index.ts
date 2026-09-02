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

export interface SessionAccess {
  get(name: string): unknown;
  run<T>(name: string, operation: (client: unknown) => T | Promise<T>): Promise<T>;
}

export interface ActionOutcome {
  readonly skipped: boolean;
  readonly effectivePayload?: unknown;
}

export interface ActionContext<P = unknown> {
  readonly id: string;
  payload: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly logger: RuntimeLogger;
  emission: TriggerEmission | undefined;
  readonly hook?: ActionHook;
  spawn(task: Promise<unknown>): void;
  outcome?: ActionOutcome;
}

export interface ActionHookResult {
  payload?: unknown;
  skip?: boolean;
}

export type ActionHook = (input: {
  payload: unknown;
  emission: TriggerEmission | undefined;
  signal: AbortSignal;
}) => ActionHookResult | unknown | Promise<ActionHookResult | unknown>;

export abstract class Action<P = unknown> {
  constructor(protected readonly context: ActionContext<P>) {}

  get id(): string {
    return this.context.id;
  }

  get payload(): P {
    return this.context.payload;
  }

  set payload(value: P) {
    this.context.payload = value;
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

  get emission(): TriggerEmission | undefined {
    return this.context.emission;
  }

  async execute(): Promise<void> {
    const baseline = cloneValue(this.context.payload) as P;
    try {
      if (this.context.hook) {
        const result = await this.context.hook({
          payload: this.context.payload,
          emission: this.context.emission,
          signal: this.context.signal
        });
        const decision = normalizeHookResult(result, this.context.payload);
        this.context.payload = decision.payload as P;
        this.context.outcome = { skipped: decision.skip, effectivePayload: cloneValue(decision.payload) };
        if (decision.skip) return;
      }
      await this.run();
    } finally {
      this.context.payload = baseline;
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

  get payload(): P {
    return this.context.payload;
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
  readonly payload: P;
  readonly session?: string;
  readonly signal: AbortSignal;
  readonly sessions?: SessionAccess;
  readonly logger: RuntimeLogger;
  readonly maxRuns?: number;
  readonly emit?: (event: TriggerEvent | Record<string, unknown>) => Promise<void>;
}

export abstract class Service<P = unknown> {
  constructor(protected readonly context: ServiceContext<P>) {}

  get id(): string {
    return this.context.id;
  }

  get payload(): P {
    return this.context.payload;
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
  readonly payload: P;
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
}

export interface LogScopeInfo {
  readonly scope: string;
  readonly path: string;
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
  listPlugins(): readonly PluginInfo[];
  subscribe(listener: RuntimeEventListener): Unsubscribe;
}

export interface PluginContext {
  readonly logger: RuntimeLogger;
  registerAction(name: string, constructor: ActionConstructor): void;
  registerTrigger(name: string, constructor: TriggerConstructor): void;
  registerService(name: string, constructor: ServiceConstructor): void;
}

export type ActionConstructor = new (context: ActionContext<any>) => Action<any>;
export type TriggerConstructor = new (context: TriggerContext<any>) => Trigger<any>;
export type ServiceConstructor = new (context: ServiceContext<any>) => Service<any>;

export interface PluginCapability {
  readonly kind: CapabilityKind;
  readonly name: string;
}

export interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly capabilities: readonly PluginCapability[];
}

export interface PluginInfo extends PluginManifest {
  readonly loaded: boolean;
}

export interface PluginModule {
  readonly manifest: PluginManifest;
  register(context: PluginContext): void | Promise<void>;
}

export function definePlugin(module: PluginModule): PluginModule {
  return module;
}

function normalizeHookResult(result: unknown, current: unknown): { payload: unknown; skip: boolean } {
  if (isHookResult(result)) {
    return {
      payload: result.payload === undefined ? current : mergePayload(current, result.payload),
      skip: result.skip === true
    };
  }
  return { payload: result === undefined ? current : mergePayload(current, result), skip: false };
}

function isHookResult(value: unknown): value is ActionHookResult {
  return typeof value === "object" && value !== null && ("payload" in value || "skip" in value);
}

function mergePayload(current: unknown, next: unknown): unknown {
  if (isRecord(current) && isRecord(next)) return { ...current, ...next };
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)])) as T;
    }
    return value;
  }
}
