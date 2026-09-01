import { test } from "node:test";
import assert from "node:assert/strict";
import { Action, type ActionContext, type RuntimeLogger, Trigger, type TriggerContext } from "@paperkite/sdk";

const logger: RuntimeLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };

test("action hooks can transform or skip a run and payload state is isolated", async () => {
  const seen: unknown[] = [];
  class CaptureAction extends Action<Record<string, unknown>> {
    protected async run(): Promise<void> {
      seen.push(structuredClone(this.payload));
      this.payload.value = "changed";
    }
  }
  const context: ActionContext<Record<string, unknown>> = {
    id: "capture",
    payload: { value: "before" },
    signal: new AbortController().signal,
    logger,
    emission: undefined,
    hook: async () => ({ value: "after" }),
    spawn() {}
  };
  await new CaptureAction(context).execute();
  assert.deepEqual(seen, [{ value: "after" }]);
  assert.deepEqual(context.payload, { value: "before" });
});

test("trigger emission honours maxRuns before invoking downstream work", async () => {
  const events: unknown[] = [];
  class EmitTrigger extends Trigger<Record<string, unknown>> {
    async run(): Promise<void> {
      await this.emit({ value: 1 });
      await this.emit({ value: 2 });
    }
  }
  const context: TriggerContext<Record<string, unknown>> = {
    id: "emit",
    capability: "test.emit",
    payload: {},
    signal: new AbortController().signal,
    logger,
    maxRuns: 1,
    emit: async (event) => {
      events.push(event);
    }
  };
  await new EmitTrigger(context).run();
  assert.deepEqual(events, [{ value: 1 }]);
});
