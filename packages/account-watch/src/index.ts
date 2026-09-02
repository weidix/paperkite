import { Trigger, definePlugin, type PluginContext } from "@paperkite/sdk";

interface HealthConfig {
  readonly sessions?: readonly string[];
  readonly intervalSeconds?: number;
  readonly emitInitial?: boolean;
  readonly verifyAccount?: boolean;
  readonly notifyOnRecovery?: boolean;
  readonly repeatAlertIntervalSeconds?: number;
}

interface HealthClient {
  readonly connected?: boolean;
  readonly isConnected?: boolean | (() => boolean | Promise<boolean>);
  getMe(): Promise<unknown>;
}

class AccountHealthTrigger extends Trigger<HealthConfig> {
  async run(): Promise<void> {
    const names = [...new Set([...(this.payload.sessions ?? []), ...(this.session ? [this.session] : [])].map(String).filter(Boolean))];
    if (!names.length) throw new Error("session watcher needs session");
    if (!this.sessions) throw new Error("session watcher needs session access");
    const states = new Map<string, boolean>();
    const interval = normalizeSeconds(this.payload.intervalSeconds, 60);
    const emitInitial = this.payload.emitInitial === true;
    const verifyAccount = this.payload.verifyAccount !== false;
    const notifyOnRecovery = this.payload.notifyOnRecovery === true;
    const repeatInterval = optionalSeconds(this.payload.repeatAlertIntervalSeconds);
    const lastFailureNotice = new Map<string, number>();

    while (!this.signal.aborted) {
      for (const session of names) {
        if (this.signal.aborted) break;
        let healthy = true;
        let detail: unknown;
        try {
          detail = await runUntilAborted(
            this.sessions.run(session, (rawClient) => checkClient(rawClient as HealthClient, verifyAccount)),
            this.signal
          );
        } catch (error) {
          if (this.signal.aborted) break;
          healthy = false;
          detail = error instanceof Error ? error.message : String(error);
        }
        const previous = states.get(session);
        states.set(session, healthy);
        const now = Date.now();
        const recovery = previous === false && healthy;
        const firstFailure = previous === undefined && !healthy;
        const newFailure = previous === true && !healthy;
        const repeatedFailure = !healthy && previous === false && repeatInterval !== undefined &&
          now - (lastFailureNotice.get(session) ?? 0) >= repeatInterval * 1_000;
        const shouldEmit = (previous === undefined && emitInitial) || newFailure || firstFailure || recovery && notifyOnRecovery || repeatedFailure;
        if (shouldEmit) {
          await this.emit({
            session,
            healthy,
            status: healthy ? (recovery ? "recovered" : "up") : "down",
            changed: previous !== undefined,
            checkedAt: new Date().toISOString(),
            reason: healthy ? undefined : detail,
            details: healthy ? detail : undefined
          });
          if (!healthy) lastFailureNotice.set(session, now);
        }
      }
      await wait(interval, this.signal);
    }
  }
}

export const manifest = {
  name: "@paperkite/plugin-account-watch",
  version: "0.1.0",
  capabilities: [{ kind: "trigger" as const, name: "watch.session" }]
};

export async function register(context: PluginContext): Promise<void> {
  context.registerTrigger("watch.session", AccountHealthTrigger);
}

export default definePlugin({ manifest, register });

function normalizeSeconds(value: number | undefined, fallback: number): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number > 0 ? Math.min(86_400, number) : fallback;
}

function optionalSeconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(86_400, number) : undefined;
}

async function checkClient(client: HealthClient, verifyAccount: boolean): Promise<unknown> {
  const state = client.connected ?? client.isConnected;
  const connected = typeof state === "function" ? await state() : state;
  if (connected === false) throw new Error("Telegram client is not connected");
  if (!verifyAccount) return undefined;
  const account = await client.getMe();
  if (account === undefined || account === null) throw new Error("Telegram session is not authorized");
  return account;
}

async function wait(seconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, seconds * 1_000);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function runUntilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("aborted");
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(new Error("aborted")));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}
