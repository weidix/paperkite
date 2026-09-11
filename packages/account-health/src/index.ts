import type { SessionState, TriggerContext, TriggerHandler } from "@paperkite/sdk";

interface HealthConfig {
  readonly notifyOnRecovery?: boolean;
}

export class SessionHealthTrigger implements TriggerHandler<HealthConfig> {
  async run(ctx: TriggerContext<HealthConfig>): Promise<void> {
    if (!ctx.control) throw new Error("session health watcher needs the runtime control contract");
    const notifyRecovery = ctx.config.notifyOnRecovery === true;
    const notify = async (name: string, state: SessionState, reason: string | undefined): Promise<void> => {
      await ctx.emit?.({ session: name, state, reason });
    };

    for (const info of ctx.control.snapshot.sessions) {
      if (info.state !== "connected" && info.state !== "starting") {
        await notify(info.name, info.state, info.reason);
      }
    }
    const unsubscribe = ctx.control.subscribe((event) => {
      if (event.type !== "session.state" || event.state === "starting") return;
      if (event.state === "connected" && !notifyRecovery) return;
      void notify(event.name, event.state, event.reason).catch((error: unknown) => {
        ctx.logger.error("session health watcher notification failed", error);
      });
    });
    try {
      await waitForAbort(ctx.signal);
    } finally {
      unsubscribe();
    }
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
