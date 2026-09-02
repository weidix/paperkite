import { useState } from "react";
import {
  CalendarClockIcon,
  CirclePlayIcon,
  FileClockIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RocketIcon,
  ZapIcon
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mono } from "@/components/code";
import { EmptyState } from "@/components/empty-state";
import { FlowDialog } from "@/components/flow-dialog";
import { StatusDot } from "@/components/status";
import { api } from "@/lib/api";
import type { FlowKind, FlowSnapshot } from "@/lib/runtime";
import { useRuntime } from "@/lib/runtime-context";

type FlowTab = "all" | FlowKind;

const TABS: readonly { value: FlowTab; label: string; icon: typeof ZapIcon }[] = [
  { value: "all", label: "全部", icon: CirclePlayIcon },
  { value: "trigger", label: "触发器", icon: ZapIcon },
  { value: "command", label: "命令", icon: RocketIcon },
  { value: "schedule", label: "定时任务", icon: CalendarClockIcon },
  { value: "service", label: "服务", icon: FileClockIcon }
];

const KIND_LABEL: Record<FlowKind, string> = {
  trigger: "触发器",
  command: "命令",
  schedule: "定时任务",
  service: "服务"
};

function flowSummary(flow: FlowSnapshot): string {
  if (flow.kind === "command") return flow.title ?? flow.id;
  if (flow.kind === "schedule") return flow.cron ?? `每 ${flow.intervalSeconds}s`;
  if (flow.kind === "service") return flow.autoStart ? "自启" : "手动";
  const actionCount = flow.actions?.length ?? 0;
  return `${actionCount} 个动作${flow.maxRuns ? ` · 最多 ${flow.maxRuns} 次` : ""}`;
}

export default function Flows() {
  const { snapshot, refresh } = useRuntime();
  const [tab, setTab] = useState<FlowTab>("all");
  const [selected, setSelected] = useState<FlowSnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const flows = snapshot?.flows ?? [];
  const visible = tab === "all" ? flows : flows.filter((flow) => flow.kind === tab);

  const run = async (flow: FlowSnapshot): Promise<void> => {
    setPending(flow.id);
    try {
      await api.runFlow(flow.id);
      toast.success(`已运行 ${flow.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "运行失败");
    } finally {
      setPending(null);
    }
  };

  const reload = async (flow: FlowSnapshot): Promise<void> => {
    setPending(flow.id);
    try {
      await api.reloadFlow(flow.id);
      toast.success(`已重载 ${flow.id}`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重载失败");
    } finally {
      setPending(null);
    }
  };

  const toggleService = async (flow: FlowSnapshot): Promise<void> => {
    setPending(flow.id);
    try {
      if (flow.active) await api.stopService(flow.id);
      else await api.startService(flow.id);
      toast.success(flow.active ? `${flow.id} 已停止` : `${flow.id} 已启动`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(null);
    }
  };

  const setEnabled = async (flow: FlowSnapshot, enabled: boolean): Promise<void> => {
    setPending(flow.id);
    try {
      const result = await api.updateFlow(flow.id, { enabled });
      toast.success(result.changed ? `已${enabled ? "启用" : "停用"} ${flow.id}` : "没有变更");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(null);
    }
  };

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(value) => setTab(value as FlowTab)}>
        <TabsList>
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="gap-1.5">
              <item.icon className="size-3.5" />
              {item.label}
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {item.value === "all" ? flows.length : flows.filter((flow) => flow.kind === item.value).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          icon={CirclePlayIcon}
          title="没有已配置的流程"
          hint="在 flows.yml 中声明触发器、命令、定时任务或服务后，这里会出现对应条目。"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>流程</TableHead>
                  <TableHead>能力</TableHead>
                  <TableHead className="hidden md:table-cell">会话</TableHead>
                  <TableHead className="hidden sm:table-cell">摘要</TableHead>
                  <TableHead className="w-14 text-center">启用</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((flow) => {
                  const busy = pending === flow.id;
                  return (
                    <TableRow key={`${flow.kind}:${flow.id}`} className="cursor-pointer" onClick={() => setSelected(flow)}>
                      <TableCell>
                        {flow.active ? (
                          <StatusDot tone="ok" pulse />
                        ) : flow.enabled || flow.kind === "command" ? (
                          <StatusDot tone="ok" />
                        ) : (
                          <StatusDot tone="idle" />
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-mono text-sm underline-offset-4 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(flow);
                          }}
                        >
                          {flow.id}
                        </button>
                        <span className="ml-2 text-xs text-muted-foreground">{KIND_LABEL[flow.kind]}</span>
                      </TableCell>
                      <TableCell>
                        <Mono className="text-xs text-muted-foreground">{flow.capability}</Mono>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {flow.session ? <Mono className="text-xs text-muted-foreground">{flow.session}</Mono> : <span className="text-xs text-muted-foreground/60">-</span>}
                      </TableCell>
                      <TableCell className="hidden max-w-56 truncate sm:table-cell">
                        <span className="text-xs text-muted-foreground">{flowSummary(flow)}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        {flow.kind !== "command" ? (
                          <Switch checked={flow.enabled} onCheckedChange={(value) => void setEnabled(flow, value)} disabled={busy} onClick={(event) => event.stopPropagation()} aria-label={`切换 ${flow.id} 启用状态`} />
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            常开
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="size-7" aria-label={`${flow.id} 操作`}>
                              <MoreHorizontalIcon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(flow.kind === "command" || flow.kind === "schedule") && (
                              <DropdownMenuItem onSelect={() => void run(flow)}>
                                <CirclePlayIcon data-icon="inline-start" />
                                运行一次
                              </DropdownMenuItem>
                            )}
                            {flow.kind === "service" && (
                              <DropdownMenuItem onSelect={() => void toggleService(flow)}>
                                {flow.active ? "停止服务" : "启动服务"}
                              </DropdownMenuItem>
                            )}
                            {flow.kind !== "command" && (
                              <DropdownMenuItem onSelect={() => void reload(flow)}>
                                <RefreshCwIcon data-icon="inline-start" />
                                重载此条
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selected ? (
        <FlowDialog flow={selected} open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} />
      ) : null}
    </div>
  );
}