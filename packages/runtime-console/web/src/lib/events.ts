import type { RuntimeEvent, StopReason } from "$lib/runtime";

export interface EventPresentation {
  readonly tone: "ok" | "bad" | "warn" | "info";
  readonly title: string;
  readonly detail: string;
}

export const STOP_REASON_LABEL: Record<StopReason, string> = {
  error: "启动失败",
  stop: "已停止",
  maxruns: "配额耗尽",
  finished: "已结束"
};

export function stopReasonLabel(reason: StopReason): string {
  return STOP_REASON_LABEL[reason];
}

export function describeEvent(event: RuntimeEvent): EventPresentation {
  switch (event.type) {
    case "action.started":
      return {
        tone: "info",
        title: event.capability,
        detail: [`#${event.id}`, event.session, event.flow ? `${event.flow.kind}:${event.flow.id}` : undefined]
          .filter(Boolean)
          .join(" · ")
      };
    case "action.finished":
      return {
        tone: event.ok ? "ok" : "bad",
        title: `${event.capability}${event.skipped ? "（跳过）" : ""}`,
        detail: [`#${event.id}`, `${event.durationMs}ms`, event.error].filter(Boolean).join(" · ")
      };
    case "service.started":
      return { tone: "ok", title: event.capability, detail: `#${event.id}${event.session ? ` · ${event.session}` : ""}` };
    case "service.stopped":
    case "trigger.stopped":
      return {
        tone: event.reason === "error" || event.reason === "maxruns" ? "bad" : event.reason === "stop" ? "warn" : "ok",
        title: event.capability,
        detail: [`#${event.id}`, stopReasonLabel(event.reason), `${event.durationMs}ms`, event.error]
          .filter(Boolean)
          .join(" · ")
      };
    case "flow.updated":
      return { tone: "info", title: `流程已更新 · ${event.kind}`, detail: `#${event.id}` };
    case "flow.reloaded":
      return { tone: "info", title: `流程已重载 · ${event.kind}`, detail: `#${event.id}` };
    case "flow.finished":
      return {
        tone: event.ok ? "ok" : "bad",
        title: `${event.kind} 完成 · ${event.capability}`,
        detail: [`#${event.id}`, `${event.durationMs}ms`].filter(Boolean).join(" · ")
      };
    case "schedule.fired":
      return {
        tone: "warn",
        title: "定时触发",
        detail: `#${event.id}${event.cron ? ` · ${event.cron}` : event.intervalSeconds ? ` · 每 ${event.intervalSeconds}s` : ""}`
      };
    case "flows.reloading":
      return { tone: "warn", title: "配置重载中", detail: "读取 flows.yml 并重建流" };
    case "flows.reloaded":
      return { tone: event.ok ? "ok" : "bad", title: "配置重载完成", detail: event.error ?? "已生效" };
    case "session.state":
      return {
        tone: event.state === "connected" ? "ok" : event.state === "waiting-auth" ? "bad" : "warn",
        title: `会话 ${event.state}`,
        detail: `#${event.name}${event.reason ? ` · ${event.reason}` : ""}`
      };
    case "flow.suspended":
      return {
        tone: "bad",
        title: "流程已隔离",
        detail: `${event.kind}:${event.id} · ${event.session}${event.error ? ` · ${event.error}` : ""}`
      };
    case "flow.resumed":
      return {
        tone: "ok",
        title: "流程已恢复",
        detail: `${event.kind}:${event.id} · ${event.session}`
      };
  }
}