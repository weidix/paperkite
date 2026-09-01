import { CronExpressionParser } from "cron-parser";
import type { ScheduleDefinition } from "../config/model.js";

export type ScheduledTask = () => Promise<void>;

export class RuntimeScheduler {
  private readonly stops = new Map<string, () => void>();

  add(definition: ScheduleDefinition, task: ScheduledTask, signal: AbortSignal): void {
    this.remove(definition.id);
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      this.stops.delete(definition.id);
    };

    const nextDelay = (): number => {
      if (definition.intervalSeconds) return definition.intervalSeconds * 1_000;
      const next = CronExpressionParser.parse(definition.cron as string, {
        currentDate: new Date()
      }).next().toDate();
      return Math.max(0, next.getTime() - Date.now());
    };

    const arm = (): void => {
      if (stopped || signal.aborted) return;
      timer = setTimeout(async () => {
        if (stopped || signal.aborted) return;
        try {
          await task();
        } catch {
          return;
        } finally {
          arm();
        }
      }, nextDelay());
    };

    this.stops.set(definition.id, stop);
    signal.addEventListener("abort", stop, { once: true });
    arm();
  }

  remove(id: string): void {
    this.stops.get(id)?.();
  }

  stopAll(): void {
    for (const stop of [...this.stops.values()]) stop();
  }
}
