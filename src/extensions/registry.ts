import type {
  Action,
  ActionConstructor,
  CapabilityKind,
  PluginContext,
  RuntimeLogger,
  Service,
  ServiceConstructor,
  Trigger,
  TriggerConstructor
} from "@paperkite/sdk";

export class CapabilityRegistry {
  readonly actions = new Map<string, ActionConstructor>();
  readonly triggers = new Map<string, TriggerConstructor>();
  readonly services = new Map<string, ServiceConstructor>();
  private readonly owners = new Map<string, string>();

  /** `scope` 是该插件的日志作用域（插件包名）。 */
  context(logger: RuntimeLogger, scope?: string): PluginContext {
    return {
      logger,
      registerAction: (name, constructor) => this.register("action", name, constructor, scope),
      registerTrigger: (name, constructor) => this.register("trigger", name, constructor, scope),
      registerService: (name, constructor) => this.register("service", name, constructor, scope)
    };
  }

  /** 返回拥有该能力的插件日志作用域（未登记时为 undefined）。 */
  scopeOf(kind: CapabilityKind, name: string): string | undefined {
    return this.owners.get(`${kind}:${name}`);
  }

  register(kind: "action", name: string, constructor: ActionConstructor, scope?: string): void;
  register(kind: "trigger", name: string, constructor: TriggerConstructor, scope?: string): void;
  register(kind: "service", name: string, constructor: ServiceConstructor, scope?: string): void;
  register(
    kind: CapabilityKind,
    name: string,
    constructor: ActionConstructor | TriggerConstructor | ServiceConstructor,
    scope?: string
  ): void {
    const normalized = name.trim();
    if (!normalized) throw new Error(kind + " capability name cannot be empty");
    const target = this.mapFor(kind) as Map<string, ActionConstructor | TriggerConstructor | ServiceConstructor>;
    if (target.has(normalized)) throw new Error("duplicate capability: " + normalized);
    if (this.hasAny(normalized)) throw new Error("capability is registered more than once: " + normalized);
    target.set(normalized, constructor);
    if (scope) this.owners.set(`${kind}:${normalized}`, scope);
  }

  getAction(name: string): ActionConstructor {
    const constructor = this.actions.get(name);
    if (!constructor) throw new Error("unknown action capability: " + name);
    return constructor;
  }

  getTrigger(name: string): TriggerConstructor {
    const constructor = this.triggers.get(name);
    if (!constructor) throw new Error("unknown trigger capability: " + name);
    return constructor;
  }

  getService(name: string): ServiceConstructor {
    const constructor = this.services.get(name);
    if (!constructor) throw new Error("unknown service capability: " + name);
    return constructor;
  }

  has(name: string): boolean {
    return this.hasAny(name);
  }

  private hasAny(name: string): boolean {
    return this.actions.has(name) || this.triggers.has(name) || this.services.has(name);
  }

  private mapFor(kind: CapabilityKind): Map<string, unknown> {
    if (kind === "action") return this.actions;
    if (kind === "trigger") return this.triggers;
    return this.services;
  }
}

export type RegisteredAtom = Action | Trigger | Service;