import { definePlugin, Trigger, type PluginContext, type SessionState } from "@paperkite/sdk";

interface HealthConfig {
  readonly notifyOnRecovery?: boolean;
}

class SessionHealthTrigger extends Trigger<HealthConfig> {
  async run(): Promise<void> {
    if (!this.control) throw new Error("watch.session needs the runtime control contract");
    const notifyRecovery = this.config.notifyOnRecovery === true;
    const notify = (name: string, state: SessionState, reason: string | undefined): Promise<void> => {
      return this.emit({ session: name, state, reason });
    };

    for (const info of this.control.snapshot.sessions) {
      if (info.state !== "connected" && info.state !== "starting") {
        await notify(info.name, info.state, info.reason);
      }
    }
    const unsubscribe = this.control.subscribe((event) => {
      if (event.type !== "session.state" || event.state === "starting") return;
      if (event.state === "connected" && !notifyRecovery) return;
      void notify(event.name, event.state, event.reason).catch((error: unknown) => {
        this.context.logger.error("watch.session notification failed", error);
      });
    });
    try {
      await waitForAbort(this.signal);
    } finally {
      unsubscribe();
    }
  }
}

export const manifest = {
  name: "@paperkite/plugin-account-watch",
  version: "0.1.0",
  capabilities: [{ kind: "trigger" as const, name: "watch.session" }]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerTrigger("watch.session", SessionHealthTrigger, { control: true });
}

export default definePlugin({ manifest, register });

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}