import type { FlowSnapshot } from "$lib/runtime";

export type FlowStatusTone = "ok" | "warn" | "bad" | "idle";

export interface FlowStatus {
  readonly tone: FlowStatusTone;
  readonly pulse: boolean;
  readonly label: string;
}

/** 状态点只反映真实运行情况：绿色即正在运行，启用但未运行按异常或待命区分。 */
export function flowStatus(flow: FlowSnapshot): FlowStatus {
  if (flow.suspended) return { tone: "bad", pulse: false, label: "会话隔离" };
  if (flow.active) return { tone: "ok", pulse: true, label: "运行中" };
  if (flow.kind === "command") return { tone: "ok", pulse: false, label: "按需执行" };
  if (!flow.enabled) return { tone: "idle", pulse: false, label: "已停用" };
  if (flow.kind === "schedule") return { tone: "ok", pulse: false, label: "已挂上调度" };
  if (flow.kind === "service" && !flow.autoStart) return { tone: "idle", pulse: false, label: "手动待命" };
  return { tone: "warn", pulse: false, label: "已启用 · 未运行" };
}
