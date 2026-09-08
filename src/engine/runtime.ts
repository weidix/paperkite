import type {
  ActionContext,
  ActionSpecInput,
  ActionSpecView,
  FlowKind,
  FlowPatch,
  FlowRef,
  FlowSnapshot,
  FlowSuspension,
  PluginInfo,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeLogger,
  RuntimeSnapshot,
  ServiceContext,
  SessionSnapshot,
  SessionState,
  SessionLoginReply,
  TriggerContext,
  TriggerEmission,
  Unsubscribe
} from "@paperkite/sdk";
import { SessionUnavailableError } from "@paperkite/sdk";
import { basename, join } from "node:path";
import type {
  ActionSpec,
  FlowCatalog,
  FlowDefinition,
  ScheduleDefinition,
  ServiceDefinition,
  TriggerDefinition
} from "../config/model.js";
import { updateFlowItem } from "../config/loader.js";
import { AppLogger } from "./logger.js";
import { loadHook } from "./hooks.js";
import { RuntimeScheduler } from "./scheduler.js";
import { CapabilityRegistry } from "../extensions/registry.js";
import type { SessionPool, SessionStateChange, SessionStateInfo } from "../telegram/pool.js";

export interface RuntimeOptions {
  readonly catalog: FlowCatalog;
  readonly registry: CapabilityRegistry;
  readonly sessions: SessionPool;
  readonly logger: AppLogger;
  readonly installed: readonly PluginInfo[];
  readonly reloadCatalog?: () => Promise<FlowCatalog>;
  readonly stopGraceMs?: number;
}

export class Runtime {
  private static readonly DEFAULT_STOP_GRACE_MS = 10_000;
  private readonly scheduler = new RuntimeScheduler();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly serviceStartedAt = new Map<string, number>();
  private readonly activeActionEntries = new Map<string, ActiveActionEntry>();
  private readonly suspended = new Map<string, Suspension>();
  private catalog: FlowCatalog;
  private lifecycle = new AbortController();
  private started = false;
  private startedAt = 0;
  private stopping: Promise<void> | undefined;
  private reloading: Promise<void> | undefined;

  constructor(private readonly options: RuntimeOptions) {
    this.catalog = options.catalog;
    const pool = options.sessions as unknown as { subscribe?: (listener: (change: SessionStateChange) => void) => Unsubscribe };
    if (typeof pool.subscribe === "function") {
      this.sessionUnsub = pool.subscribe((change) => this.handleSessionChange(change));
    }
  }

  private sessionUnsub: Unsubscribe | undefined;

  get snapshot(): RuntimeSnapshot {
    return {
      running: this.started,
      pid: process.pid,
      uptimeSeconds: this.started ? (Date.now() - this.startedAt) / 1000 : 0,
      triggers: this.catalog.enabled("trigger").map((item) => item.id),
      services: this.catalog.enabled("service").map((item) => item.id),
      schedules: this.catalog.enabled("schedule").map((item) => item.id),
      activeServices: [...this.controllers.keys()]
        .filter((key) => key.startsWith("service:"))
        .map((key) => key.slice("service:".length)),
      activeActions: [...this.activeActionEntries.values()].map((entry) => ({
        id: entry.id,
        capability: entry.capability,
        session: entry.session,
        flow: entry.flow,
        startedAt: new Date(entry.startedAt).toISOString()
      })),
      flows: this.catalog.definitions().map((item) => this.flowSnapshot(item)),
      sessions: this.sessionSnapshots(),
      logs: this.logScopes()
    };
  }

  listPlugins(): readonly PluginInfo[] {
    return this.options.installed;
  }

  subscribe(listener: RuntimeEventListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.settleStopping();
    if (this.lifecycle.signal.aborted) this.lifecycle = new AbortController();
    const sessions = collectSessions(this.catalog);
    try {
      if (sessions.size) await this.options.sessions.ensure(sessions);
      this.started = true;
      this.startedAt = Date.now();
      this.startFlows();
    } catch (error) {
      this.started = false;
      this.lifecycle.abort();
      await this.stopFlows();
      await this.options.sessions.closeAll();
      throw error;
    }
  }

  async reload(): Promise<void> {
    if (this.reloading) return this.reloading;
    const reloading = this.performReload();
    this.reloading = reloading;
    try {
      await reloading;
    } finally {
      if (this.reloading === reloading) this.reloading = undefined;
    }
  }

  private async performReload(): Promise<void> {
    await this.settleStopping();
    if (!this.options.reloadCatalog) throw new Error("config reload is not configured");
    this.emit({ type: "flows.reloading" });
    let next: FlowCatalog;
    try {
      next = await this.options.reloadCatalog();
    } catch (error) {
      this.emit({ type: "flows.reloaded", ok: false, error: messageOf(error) });
      throw error;
    }
    const wasStarted = this.started;
    await this.stopFlows();
    this.catalog = next;
    if (wasStarted) {
      const sessions = collectSessions(this.catalog);
      if (sessions.size) await this.options.sessions.ensure(sessions);
      this.startFlows();
    }
    this.emit({ type: "flows.reloaded", ok: true });
  }

  async executeAction(spec: ActionSpecInput, flow?: FlowRef): Promise<void> {
    const capability = String(spec.capability ?? "").trim();
    if (!capability) throw new Error("executeAction needs capability");
    const action: ActionSpec = {
      capability,
      config: spec.config ?? {},
      session: spec.session,
      hook: spec.hook
    };
    const sessions = collectActionSessions(action);
    if (sessions.size) await this.options.sessions.ensure(sessions);
    await this.runAction(action, spec.label ?? `action:${capability}`, undefined, spec.session, this.lifecycle.signal, flow);
  }

  async runFlow(identifier: string): Promise<void> {
    const command = this.catalog.find(identifier, "command");
    const definition = command ?? this.catalog.find(identifier, "schedule");
    if (!definition || (definition.kind !== "command" && definition.kind !== "schedule")) {
      throw new Error("unknown flow: " + identifier);
    }
    if (definition.kind === "schedule" && !definition.enabled) {
      throw new Error("schedule is disabled: " + definition.id);
    }
    const action: ActionSpec = {
      ...definition.action,
      session: definition.action.session ?? (definition.kind === "schedule" ? definition.session : undefined)
    };
    await this.completeFlow(definition.kind, definition.id, action.capability, () =>
      this.executeAction(
        { ...action, label: `${definition.kind}:${definition.id}` },
        { kind: definition.kind, id: definition.id }
      )
    );
  }

  private async completeFlow(
    kind: FlowKind,
    id: string,
    capability: string,
    operation: () => Promise<unknown>
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      await operation();
    } catch (error) {
      this.emit({ type: "flow.finished", kind, id, capability, ok: false, durationMs: Date.now() - startedAt });
      throw error;
    }
    this.emit({ type: "flow.finished", kind, id, capability, ok: true, durationMs: Date.now() - startedAt });
  }

  async startService(identifier: string): Promise<void> {
    await this.settleStopping();
    if (this.lifecycle.signal.aborted) this.lifecycle = new AbortController();
    const definition = this.catalog.find(identifier, "service");
    if (!definition || definition.kind !== "service") throw new Error("unknown service: " + identifier);
    if (!definition.enabled) throw new Error("service is disabled: " + definition.id);
    if (this.controllers.has(`service:${definition.id}`)) return;
    const gate = this.boundSession(definition);
    const state = this.sessionState(gate);
    if (gate && state !== undefined && state !== "connected") {
      throw new SessionUnavailableError(gate, state, this.sessionReason(gate));
    }
    const sessions = new Set<string>();
    if (definition.session) sessions.add(definition.session);
    if (sessions.size) await this.options.sessions.ensure(sessions);
    this.launchService(definition);
  }

  async reconnectSession(name: string): Promise<void> {
    const pool = this.options.sessions as unknown as { reconnectSession?: (value: string) => Promise<void> };
    if (typeof pool.reconnectSession !== "function") throw new Error("session control is not available");
    await pool.reconnectSession(name);
  }

  async beginSessionLogin(name: string): Promise<SessionLoginReply> {
    const pool = this.options.sessions as unknown as { beginSessionLogin?: (value: string) => Promise<SessionLoginReply> };
    if (typeof pool.beginSessionLogin !== "function") throw new Error("session control is not available");
    return pool.beginSessionLogin(name);
  }

  async submitSessionLogin(name: string, value: string): Promise<SessionLoginReply> {
    const pool = this.options.sessions as unknown as { submitSessionLogin?: (value: string, input: string) => Promise<SessionLoginReply> };
    if (typeof pool.submitSessionLogin !== "function") throw new Error("session control is not available");
    return pool.submitSessionLogin(name, value);
  }

  async stopService(identifier: string): Promise<void> {
    const definition = this.catalog.find(identifier, "service");
    if (!definition || definition.kind !== "service") throw new Error("unknown service: " + identifier);
    await this.stopFlow(`service:${definition.id}`);
  }

  async updateFlow(identifier: string, patch: FlowPatch): Promise<boolean> {
    const next = await updateFlowItem(this.catalog, identifier, patch as Record<string, unknown>);
    if (!next) return false;
    this.catalog = next;
    const item = next.find(identifier);
    if (item) this.emit({ type: "flow.updated", id: item.id, kind: item.kind });
    return true;
  }

  async reloadFlow(identifier: string): Promise<boolean> {
    const item = this.catalog.find(identifier);
    if (!item) return false;
    if (item.kind === "schedule") {
      if (this.started && item.enabled) this.startSchedule(item);
    } else if (item.kind === "trigger") {
      await this.stopFlow(`trigger:${item.id}`);
      if (this.started && item.enabled) this.startTrigger(item);
    } else if (item.kind === "service") {
      await this.stopFlow(`service:${item.id}`);
      if (this.started && item.enabled && item.autoStart) this.launchService(item);
    }
    this.emit({ type: "flow.reloaded", id: item.id, kind: item.kind });
    return true;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const stopping = (async () => {
      this.started = false;
      this.lifecycle.abort();
      await this.stopFlows();
      await this.options.sessions.closeAll();
    })();
    this.stopping = stopping;
    await stopping;
    if (this.stopping === stopping) this.stopping = undefined;
  }

  private async settleStopping(): Promise<void> {
    const previousStop = this.stopping;
    if (previousStop) {
      await previousStop;
      if (this.stopping === previousStop) this.stopping = undefined;
    }
  }

  private async stopFlows(): Promise<void> {
    this.scheduler.stopAll();
    const running = [...this.runs.entries()];
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.suspended.clear();
    const tasks = [...this.tasks];
    if (tasks.length) {
      const graceMs = this.stopGraceMs();
      const pending = await settleWithin(tasks, graceMs);
      if (pending > 0) {
        const leftovers = await stillRunning(running);
        const names = leftovers.length ? leftovers.join(", ") : `${pending} unknown`;
        this.options.logger.warn(
          `${pending} flow task(s) did not stop within ${graceMs}ms and keep running: ${names}`
        );
      }
    }
    this.runs.clear();
  }

  private async stopFlow(key: string): Promise<void> {
    const controller = this.controllers.get(key);
    const run = this.runs.get(key);
    this.clearSuspension(key);
    if (!controller && !run) return;
    controller?.abort();
    if (run) await settleWithin([run], this.stopGraceMs());
  }

  private stopGraceMs(): number {
    return this.options.stopGraceMs ?? Runtime.DEFAULT_STOP_GRACE_MS;
  }

  private startFlows(): void {
    for (const definition of this.catalog.enabled("trigger")) {
      if (definition.kind !== "trigger") continue;
      if (this.flowBlocked(definition)) continue;
      this.startTrigger(definition);
    }
    for (const definition of this.catalog.enabled("service")) {
      if (definition.kind !== "service") continue;
      if (!definition.autoStart) continue;
      if (this.flowBlocked(definition)) continue;
      this.launchService(definition);
    }
    for (const definition of this.catalog.enabled("schedule")) {
      if (definition.kind !== "schedule") continue;
      if (this.flowBlocked(definition)) continue;
      this.startSchedule(definition);
    }
  }

  private flowBlocked(definition: FlowDefinition): boolean {
    const session = this.boundSession(definition);
    const state = this.sessionState(session);
    if (!session || state === undefined || state === "connected") return false;
    this.recordSuspension(definition, session, this.sessionReason(session));
    return true;
  }

  private async handleSessionChange(change: SessionStateChange): Promise<void> {
    this.emit({
      type: "session.state",
      name: change.name,
      state: change.state,
      reason: change.reason,
      since: new Date().toISOString()
    });
    if (!this.started) return;
    if (change.state === "connected") {
      this.resumeForSession(change.name);
      return;
    }
    this.suspendForSession(change.name, change.reason);
  }

  private suspendForSession(name: string, error: string | undefined): void {
    for (const definition of this.catalog.definitions()) {
      if (definition.kind === "command") continue;
      const session = this.boundSession(definition);
      if (session !== name) continue;
      const key = `${definition.kind}:${definition.id}`;
      if (this.suspended.has(key)) continue;
      if (definition.kind === "schedule") {
        if (!this.scheduler.has(definition.id)) continue;
        this.scheduler.remove(definition.id);
      } else {
        const controller = this.controllers.get(key);
        if (!controller) continue;
        controller.abort();
      }
      this.recordSuspension(definition, name, error);
      this.emit({ type: "flow.suspended", id: definition.id, kind: definition.kind, session: name, error });
    }
  }

  private resumeForSession(name: string): void {
    for (const [key, suspension] of [...this.suspended.entries()]) {
      if (suspension.session !== name) continue;
      this.suspended.delete(key);
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator) as FlowKind;
      const definition = this.catalog.find(key.slice(separator + 1), kind);
      if (!definition) continue;
      if (definition.kind !== "command" && !definition.enabled) continue;
      if (definition.kind === "schedule") {
        this.startSchedule(definition as ScheduleDefinition);
      } else if (definition.kind === "service") {
        this.launchService(definition as ServiceDefinition);
      } else if (definition.kind === "trigger") {
        this.startTrigger(definition as TriggerDefinition);
      } else {
        continue;
      }
      this.emit({ type: "flow.resumed", id: definition.id, kind: definition.kind, session: name });
    }
  }

  private recordSuspension(definition: FlowDefinition, session: string, error: string | undefined): void {
    this.suspended.set(`${definition.kind}:${definition.id}`, { kind: definition.kind, id: definition.id, session, error, since: Date.now() });
  }

  private clearSuspension(key: string): void {
    this.suspended.delete(key);
  }

  private startTrigger(definition: TriggerDefinition): void {
    const key = `trigger:${definition.id}`;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const task = this.runTrigger(definition, controller).catch((error) => {
      if (!controller.signal.aborted) this.options.logger.error("trigger stopped: " + definition.id, error);
    }).finally(() => {
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
      if (this.runs.get(key) === task) this.runs.delete(key);
    });
    this.runs.set(key, task);
    this.track(task);
  }

  private launchService(definition: ServiceDefinition): void {
    const key = `service:${definition.id}`;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.serviceStartedAt.set(key, Date.now());
    let failure: unknown;
    const task = this.runService(definition, controller).catch((error) => {
      failure = error;
      if (!controller.signal.aborted) this.options.logger.error("service stopped: " + definition.id, error);
    }).finally(() => {
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
      if (this.runs.get(key) === task) this.runs.delete(key);
      const startedAt = this.serviceStartedAt.get(key);
      this.serviceStartedAt.delete(key);
      this.emit({
        type: "service.stopped",
        id: definition.id,
        capability: definition.capability,
        session: definition.session,
        reason: failure !== undefined ? "error" : controller.signal.aborted ? "stop" : "finished",
        error: failure instanceof Error ? failure.message : undefined,
        durationMs: startedAt === undefined ? 0 : Date.now() - startedAt
      });
    });
    this.runs.set(key, task);
    this.track(task);
    this.emit({
      type: "service.started",
      id: definition.id,
      capability: definition.capability,
      session: definition.session
    });
  }

  private startSchedule(definition: ScheduleDefinition): void {
    this.scheduler.add(
      definition,
      () => {
        const task = this.completeFlow("schedule", definition.id, definition.action.capability, () =>
          this.runAction(
            definition.action,
            `schedule:${definition.id}`,
            undefined,
            definition.session,
            this.scheduleSignal,
            { kind: "schedule", id: definition.id }
          )
        ).catch((error) => this.options.logger.error("schedule failed: " + definition.id, error));
        this.track(task);
        return task;
      },
      this.scheduleSignal,
      (item) =>
        this.emit({
          type: "schedule.fired",
          id: item.id,
          cron: item.cron,
          intervalSeconds: item.intervalSeconds
        })
    );
  }

  private get scheduleSignal(): AbortSignal {
    return this.lifecycle.signal;
  }

  private async runTrigger(definition: TriggerDefinition, controller: AbortController): Promise<void> {
    const Constructor = this.options.registry.getTrigger(definition.capability);
    let emitted = 0;
    const context: TriggerContext = {
      id: definition.id,
      capability: definition.capability,
      config: definition.config,
      session: definition.session,
      signal: controller.signal,
      sessions: this.options.sessions.access(definition.session),
      control: this.options.registry.grantsControl("trigger", definition.capability) ? this : undefined,
      logger: this.capabilityLogger("trigger", definition.capability),
      maxRuns: definition.maxRuns,
      emit: async (event) => {
        if (controller.signal.aborted) return;
        emitted += 1;
        const emission: TriggerEmission = {
          source: { id: definition.id, capability: definition.capability },
          event
        };
        const startedAt = Date.now();
        let ok = true;
        try {
          for (const [index, action] of definition.actions.entries()) {
            const outcome = await this.runAction(
              action,
              `trigger:${definition.id}:${index + 1}`,
              emission,
              action.session ?? definition.session,
              controller.signal,
              { kind: "trigger", id: definition.id },
              true
            );
            if (outcome.skipped) ok = false;
          }
        } catch (error) {
          this.emit({
            type: "flow.finished",
            kind: "trigger",
            id: definition.id,
            capability: definition.capability,
            ok: false,
            durationMs: Date.now() - startedAt
          });
          throw error;
        }
        this.emit({
          type: "flow.finished",
          kind: "trigger",
          id: definition.id,
          capability: definition.capability,
          ok,
          durationMs: Date.now() - startedAt
        });
        if (definition.maxRuns && emitted >= definition.maxRuns) controller.abort();
      }
    };
    const trigger = new Constructor(context);
    await trigger.run();
  }

  private async runService(definition: ServiceDefinition, controller: AbortController): Promise<void> {
    const Constructor = this.options.registry.getService(definition.capability);
    const context: ServiceContext = {
      id: definition.id,
      capability: definition.capability,
      config: definition.config,
      session: definition.session,
      signal: controller.signal,
      sessions: this.options.sessions.access(definition.session),
      control: this.options.registry.grantsControl("service", definition.capability) ? this : undefined,
      logger: this.capabilityLogger("service", definition.capability)
    };
    await new Constructor(context).run();
  }

  private async runAction(
    specification: ActionSpec,
    id: string,
    emission: TriggerEmission | undefined,
    parentSession: string | undefined,
    signal: AbortSignal,
    flow?: FlowRef,
    soft = false
  ): Promise<{ skipped: boolean }> {
    const capability = specification.capability;
    const session = specification.session ?? parentSession;
    const state = this.sessionState(session);
    if (session && state !== undefined && state !== "connected") {
      const error = new SessionUnavailableError(session, state, this.sessionReason(session));
      if (soft) {
        this.emit({
          type: "action.finished",
          id,
          capability,
          session,
          flow,
          ok: false,
          skipped: false,
          durationMs: 0,
          error: error.message
        });
        return { skipped: true };
      }
      throw error;
    }
    const Constructor = this.options.registry.getAction(capability);
    const hook = await loadHook(specification.hook, this.catalog.path);
    const context: ActionContext = {
      id,
      config: specification.config,
      session,
      signal,
      sessions: this.options.sessions.access(session),
      control: this.options.registry.grantsControl("action", capability) ? this : undefined,
      logger: this.capabilityLogger("action", capability),
      emission,
      hook,
      outcome: undefined,
      spawn: (task) => this.track(task.then(() => undefined))
    };
    const startedAt = Date.now();
    this.activeActionEntries.set(id, { id, capability, session, flow, startedAt });
    this.emit({
      type: "action.started",
      id,
      capability,
      session,
      flow,
      hook: specification.hook,
      config: exportable(specification.config)
    });
    let failure: unknown;
    try {
      await new Constructor(context).execute();
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      this.activeActionEntries.delete(id);
      this.emit({
        type: "action.finished",
        id,
        capability,
        session,
        flow,
        ok: failure === undefined,
        skipped: context.outcome?.skipped === true,
        durationMs: Date.now() - startedAt,
        error: failure instanceof Error ? failure.message : failure === undefined ? undefined : String(failure),
        effectiveConfig: exportable(context.outcome?.effectiveConfig)
      });
    }
    return { skipped: false };
  }

  private capabilityLogger(kind: "action" | "trigger" | "service", capability: string): RuntimeLogger {
    const scope = this.options.registry.scopeOf(kind, capability) ?? capability;
    return this.options.logger.child(scope);
  }

  private flowSnapshot(definition: FlowDefinition): FlowSnapshot {
    const base = {
      kind: definition.kind,
      id: definition.id,
      capability: "capability" in definition ? definition.capability : definition.action.capability,
      enabled: definition.kind === "command" ? true : definition.enabled,
      active:
        definition.kind === "service" || definition.kind === "trigger"
          ? this.controllers.has(`${definition.kind}:${definition.id}`)
          : false,
      session: "session" in definition ? definition.session : undefined,
      logFile: "logFile" in definition ? definition.logFile : false,
      suspended: this.suspensionOf(definition)
    };
    if (definition.kind === "trigger") {
      return {
        ...base,
        maxRuns: definition.maxRuns,
        config: copyOf(definition.config),
        actions: definition.actions.map((action) => actionView(action))
      };
    }
    if (definition.kind === "service") {
      return {
        ...base,
        autoStart: definition.autoStart,
        config: copyOf(definition.config),
        startedAt:
          this.serviceStartedAt.get(`service:${definition.id}`) === undefined
            ? undefined
            : new Date(this.serviceStartedAt.get(`service:${definition.id}`) as number).toISOString()
      };
    }
    return {
      ...base,
      title: definition.kind === "command" ? definition.title : undefined,
      symbol: definition.kind === "command" ? definition.symbol : undefined,
      cron: definition.kind === "schedule" ? definition.cron : undefined,
      intervalSeconds: definition.kind === "schedule" ? definition.intervalSeconds : undefined,
      hook: definition.action.hook,
      config: copyOf(definition.action.config)
    };
  }

  private suspensionOf(definition: FlowDefinition): FlowSuspension | undefined {
    const suspension = this.suspended.get(`${definition.kind}:${definition.id}`);
    if (!suspension) return undefined;
    return {
      since: new Date(suspension.since).toISOString(),
      reason: "session",
      session: suspension.session,
      error: suspension.error
    };
  }

  private sessionSnapshots(): SessionSnapshot[] {
    const pool = this.options.sessions as unknown as { states?: () => SessionStateInfo[] };
    const states = typeof pool.states === "function" ? pool.states() : [];
    return states.map((info) => ({
      name: info.name,
      state: info.state,
      since: new Date(info.since).toISOString(),
      reason: info.reason,
      attempts: info.attempts,
      flows: [...this.suspended.values()]
        .filter((item) => item.session === info.name)
        .map((item) => ({ kind: item.kind, id: item.id }))
    }));
  }

  private sessionState(name: string | undefined): SessionState | undefined {
    if (!name) return undefined;
    const pool = this.options.sessions as unknown as { state?: (value: string) => SessionState | undefined };
    if (typeof pool.state !== "function") return undefined;
    return pool.state(name);
  }

  private sessionReason(name: string): string | undefined {
    const pool = this.options.sessions as unknown as { states?: () => SessionStateInfo[] };
    if (typeof pool.states !== "function") return undefined;
    return pool.states().find((info) => info.name === name)?.reason;
  }

  private boundSession(definition: FlowDefinition): string | undefined {
    if (definition.kind === "command") return definition.action.session;
    if (definition.kind === "schedule") return definition.action.session ?? definition.session;
    return definition.session;
  }

  private logScopes(): { scope: string; path: string }[] {
    const directory = this.options.logger.logDirectory();
    if (!directory) return [];
    const scopes = ["paperkite", ...this.options.logger.registeredScopes()];
    return scopes.map((scope) => ({ scope, path: join(directory, basename(scope) + ".log") }));
  }

  private emit<E extends RuntimeEvent>(event: EventWithoutAt<E>): void {
    const withAt = { ...event, at: new Date().toISOString() } as E;
    for (const listener of [...this.listeners]) {
      try {
        listener(withAt);
      } catch (error) {
        this.options.logger.error("runtime event listener failed", error);
      }
    }
  }

  private track(task: Promise<void>): void {
    const observed = task.catch((error) => {
      this.options.logger.error("background task failed", error);
    });
    this.tasks.add(observed);
    void observed.then(() => this.tasks.delete(observed));
  }
}

function collectSessions(catalog: FlowCatalog): Set<string> {
  const names = new Set<string>();
  for (const definition of catalog.enabled()) {
    if ("session" in definition && definition.session) names.add(definition.session);
    if (definition.kind === "trigger") {
      for (const action of definition.actions) collectActionSessions(action, names);
    } else if (definition.kind === "command" || definition.kind === "schedule") {
      collectActionSessions(definition.action, names);
    }
  }
  return names;
}

function collectActionSessions(action: ActionSpec, names = new Set<string>()): Set<string> {
  if (action.session) names.add(action.session);
  return names;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleWithin(tasks: readonly Promise<unknown>[], milliseconds: number): Promise<number> {
  let pending = tasks.length;
  const observed = tasks.map((task) =>
    task.then(
      () => {
        pending -= 1;
      },
      () => {
        pending -= 1;
      }
    )
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  try {
    await Promise.race([Promise.allSettled(observed), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return pending;
}

async function stillRunning(entries: ReadonlyArray<[string, Promise<unknown>]>): Promise<string[]> {
  const keys: string[] = [];
  for (const [key, task] of entries) {
    const settled = await Promise.race([
      task.then(
        () => true,
        () => true
      ),
      new Promise<boolean>((resolve) => queueMicrotask(() => resolve(false)))
    ]);
    if (!settled) keys.push(key);
  }
  return keys;
}

interface ActiveActionEntry {
  readonly id: string;
  readonly capability: string;
  readonly session?: string;
  readonly flow?: FlowRef;
  readonly startedAt: number;
}

interface Suspension {
  readonly kind: FlowKind;
  readonly id: string;
  readonly session: string;
  readonly error?: string;
  readonly since: number;
}

type EventWithoutAt<E extends RuntimeEvent> = E extends RuntimeEvent ? Omit<E, "at"> : never;

function actionView(action: ActionSpec): ActionSpecView {
  return { capability: action.capability, session: action.session, config: copyOf(action.config), hook: action.hook };
}

function exportable(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value);
    if (!text || text.length > 4096) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function copyOf<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export type { RuntimeSnapshot };