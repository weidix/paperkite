import { Trigger, type SessionState } from "@paperkite/sdk";

interface HealthConfig {
  readonly notifyOnRecovery?: boolean;
}

export class SessionHealthTrigger extends Trigger<HealthConfig> {
  async run(): Promise<void> {
    if (!this.control) throw new Error("session health watcher needs the runtime control contract");
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
        this.context.logger.error("session health watcher notification failed", error);
      });
    });
    try {
      await waitForAbort(this.signal);
    } finally {
      unsubscribe();
    }
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}