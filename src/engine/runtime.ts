import type {
  ActionContext,
  ActionSpecInput,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeLogger,
  RuntimeSnapshot,
  ServiceContext,
  TriggerContext,
  TriggerEmission,
  Unsubscribe
} from "@paperkite/sdk";
import { basename, join } from "node:path";
import type {
  ActionSpec,
  FlowCatalog,
  ScheduleDefinition,
  ServiceDefinition,
  TriggerDefinition
} from "../config/model.js";
import { AppLogger } from "./logger.js";
import { loadHook } from "./hooks.js";
import { RuntimeScheduler } from "./scheduler.js";
import { CapabilityRegistry } from "../extensions/registry.js";
import type { SessionPool } from "../telegram/pool.js";

export interface RuntimeOptions {
  readonly catalog: FlowCatalog;
  readonly registry: CapabilityRegistry;
  readonly sessions: SessionPool;
  readonly logger: AppLogger;
  readonly reloadCatalog?: () => Promise<FlowCatalog>;
}

export class Runtime {
  private readonly scheduler = new RuntimeScheduler();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runs = new Map<string, Promise<void>>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private catalog: FlowCatalog;
  private lifecycle = new AbortController();
  private started = false;
  private startedAt = 0;
  private stopping: Promise<void> | undefined;

  constructor(private readonly options: RuntimeOptions) {
    this.catalog = options.catalog;
    options.logger.attachLogSink((entry) =>
      this.emit({ type: "log", scope: entry.scope, level: entry.level, message: entry.message })
    );
  }

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
      flows: this.catalog.definitions().map((item) => ({
        kind: item.kind,
        id: item.id,
        capability: "capability" in item ? item.capability : item.action.capability,
        title: item.kind === "command" ? item.title : undefined,
        enabled: item.kind === "command" ? true : item.enabled,
        active:
          item.kind === "service" || item.kind === "trigger"
            ? this.controllers.has(`${item.kind}:${item.id}`)
            : false,
        session: "session" in item ? item.session : undefined,
        autoStart: item.kind === "service" ? item.autoStart : undefined,
        schedule:
          item.kind === "schedule"
            ? item.cron ?? (item.intervalSeconds !== undefined ? `${item.intervalSeconds}s` : undefined)
            : undefined,
        logFile: "logFile" in item ? item.logFile : false
      })),
      logs: this.logScopes()
    };
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
      this.scheduler.stopAll();
      for (const controller of this.controllers.values()) controller.abort();
      this.controllers.clear();
      await Promise.allSettled([...this.tasks]);
      await this.options.sessions.closeAll();
      throw error;
    }
  }

  async reload(): Promise<void> {
    await this.settleStopping();
    if (!this.options.reloadCatalog) throw new Error("config reload is not configured");
    this.emit({ type: "config.reloading" });
    let next: FlowCatalog;
    try {
      next = await this.options.reloadCatalog();
    } catch (error) {
      this.emit({ type: "config.reloaded", ok: false, error: messageOf(error) });
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
    this.emit({ type: "config.reloaded", ok: true });
  }

  async runCommand(identifier: string, payload: unknown = {}): Promise<void> {
    const command = this.catalog.find(identifier, "command");
    if (!command || command.kind !== "command") throw new Error("unknown command: " + identifier);
    if (!this.started) {
      const sessions = collectActionSessions(command.action);
      if (sessions.size) await this.options.sessions.ensure(sessions);
    }
    const contextPayload = mergePayload(command.action.config, payload);
    await this.executeAction({
      ...command.action,
      config: contextPayload,
      label: `command:${command.id}`
    });
  }

  async executeAction(spec: ActionSpecInput): Promise<void> {
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
    await this.runAction(action, spec.label ?? `action:${capability}`, undefined, spec.session, this.lifecycle.signal);
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
    await this.executeAction({ ...definition.action, label: `${definition.kind}:${definition.id}` });
  }

  async startService(identifier: string): Promise<void> {
    await this.settleStopping();
    if (this.lifecycle.signal.aborted) this.lifecycle = new AbortController();
    const definition = this.catalog.find(identifier, "service");
    if (!definition || definition.kind !== "service") throw new Error("unknown service: " + identifier);
    if (!definition.enabled) throw new Error("service is disabled: " + definition.id);
    if (this.controllers.has(`service:${definition.id}`)) return;
    const sessions = new Set<string>();
    if (definition.session) sessions.add(definition.session);
    collectConfigSessions(definition.config, sessions);
    if (sessions.size) await this.options.sessions.ensure(sessions);
    this.launchService(definition);
  }

  async stopService(identifier: string): Promise<void> {
    const definition = this.catalog.find(identifier, "service");
    if (!definition || definition.kind !== "service") throw new Error("unknown service: " + identifier);
    const key = `service:${definition.id}`;
    const run = this.runs.get(key);
    this.controllers.get(key)?.abort();
    await run;
  }

  async restartService(identifier: string): Promise<void> {
    await this.stopService(identifier);
    await this.startService(identifier);
  }

  async setFlowEnabled(identifier: string, enabled: boolean): Promise<boolean> {
    const changed = await this.catalog.setEnabled(identifier, enabled);
    if (changed) {
      const item = this.catalog.find(identifier);
      if (item) this.emit({ type: "flow.enabled", id: item.id, kind: item.kind, enabled });
    }
    return changed;
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
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    await Promise.allSettled([...this.tasks]);
    this.runs.clear();
  }

  private startFlows(): void {
    for (const definition of this.catalog.enabled("trigger")) {
      if (definition.kind !== "trigger") continue;
      this.startTrigger(definition);
    }
    for (const definition of this.catalog.enabled("service")) {
      if (definition.kind !== "service") continue;
      if (definition.autoStart) this.launchService(definition);
    }
    for (const definition of this.catalog.enabled("schedule")) {
      if (definition.kind !== "schedule") continue;
      this.startSchedule(definition);
    }
  }

  private startTrigger(definition: TriggerDefinition): void {
    const key = `trigger:${definition.id}`;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const task = this.runTrigger(definition, controller).catch((error) => {
      if (!controller.signal.aborted) this.options.logger.error("trigger stopped: " + definition.id, error);
    }).finally(() => {
      this.controllers.delete(key);
      this.runs.delete(key);
    });
    this.runs.set(key, task);
    this.track(task);
  }

  private launchService(definition: ServiceDefinition): void {
    const key = `service:${definition.id}`;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    let failure: unknown;
    const task = this.runService(definition, controller).catch((error) => {
      failure = error;
      if (!controller.signal.aborted) this.options.logger.error("service stopped: " + definition.id, error);
    }).finally(() => {
      this.controllers.delete(key);
      this.runs.delete(key);
      this.emit({
        type: "service.stopped",
        id: definition.id,
        error: failure instanceof Error ? failure.message : undefined
      });
    });
    this.runs.set(key, task);
    this.track(task);
    this.emit({ type: "service.started", id: definition.id });
  }

  private startSchedule(definition: ScheduleDefinition): void {
    this.scheduler.add(
      definition,
      () => {
        const task = this.runAction(
          definition.action,
          `schedule:${definition.id}`,
          undefined,
          definition.session,
          this.scheduleSignal
        ).catch((error) => this.options.logger.error("schedule failed: " + definition.id, error));
        this.track(task);
        return task;
      },
      this.scheduleSignal
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
      payload: definition.config,
      session: definition.session,
      signal: controller.signal,
      sessions: this.options.sessions.access(),
      logger: this.capabilityLogger("trigger", definition.capability),
      maxRuns: definition.maxRuns,
      emit: async (event) => {
        if (controller.signal.aborted) return;
        emitted += 1;
        const emission: TriggerEmission = {
          source: { id: definition.id, capability: definition.capability },
          event
        };
        for (const [index, action] of definition.actions.entries()) {
          await this.runAction(
            action,
            `trigger:${definition.id}:${index + 1}`,
            emission,
            action.session ?? definition.session,
            controller.signal
          );
        }
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
      payload: definition.config,
      session: definition.session,
      signal: controller.signal,
      sessions: this.options.sessions.access(),
      control: this,
      logger: this.capabilityLogger("service", definition.capability)
    };
    await new Constructor(context).run();
  }

  private async runAction(
    specification: ActionSpec,
    id: string,
    emission: TriggerEmission | undefined,
    parentSession: string | undefined,
    signal: AbortSignal
  ): Promise<void> {
    const capability = specification.capability;
    const Constructor = this.options.registry.getAction(capability);
    const hook = await loadHook(specification.hook, this.catalog.path);
    const context: ActionContext = {
      id,
      payload: specification.config,
      session: specification.session ?? parentSession,
      signal,
      sessions: this.options.sessions.access(),
      logger: this.capabilityLogger("action", capability),
      emission,
      hook,
      spawn: (task) => this.track(task.then(() => undefined))
    };
    this.emit({
      type: "action.started",
      id,
      capability,
      session: context.session
    });
    let failure: unknown;
    try {
      await new Constructor(context).execute();
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      this.emit({
        type: "action.finished",
        id,
        capability,
        session: context.session,
        error: failure instanceof Error ? failure.message : failure === undefined ? undefined : String(failure)
      });
    }
  }

  private capabilityLogger(kind: "action" | "trigger" | "service", capability: string): RuntimeLogger {
    const scope = this.options.registry.scopeOf(kind, capability) ?? capability;
    return this.options.logger.child(scope);
  }

  private logScopes(): { scope: string; path: string }[] {
    const directory = this.options.logger.logDirectory();
    if (!directory) return [];
    const scopes = ["paperkite", ...this.options.logger.registeredScopes()];
    return scopes.map((scope) => ({ scope, path: join(directory, basename(scope) + ".log") }));
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
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
      collectConfigSessions(definition.config, names);
    } else if (definition.kind === "command" || definition.kind === "schedule") {
      collectActionSessions(definition.action, names);
    } else {
      collectConfigSessions(definition.config, names);
    }
  }
  return names;
}

function collectActionSessions(action: ActionSpec, names = new Set<string>()): Set<string> {
  if (action.session) names.add(action.session);
  collectConfigSessions(action.config, names);
  return names;
}

function collectConfigSessions(value: unknown, names: Set<string>): void {
  if (!isRecord(value)) return;
  const sessions = value.sessions;
  if (Array.isArray(sessions)) {
    for (const item of sessions) if (typeof item === "string" && item.trim()) names.add(item.trim());
  }
  if (typeof value.session === "string" && value.session.trim()) names.add(value.session.trim());
}

function mergePayload(current: unknown, extra: unknown): unknown {
  if (isRecord(current) && isRecord(extra)) return { ...current, ...extra };
  return extra === undefined ? current : extra;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { RuntimeSnapshot };