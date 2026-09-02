import { useState } from "react";
import {
  ActivityIcon,
  CalendarClockIcon,
  CpuIcon,
  FileClockIcon,
  PackageIcon,
  PlayIcon,
  RotateCcwIcon,
  ZapIcon,
  type LucideIcon
} from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { describeEvent } from "@/lib/events";
import { formatClock, formatUptime } from "@/lib/format";
import { useAsync, useNow } from "@/lib/hooks";
import { useRuntime } from "@/lib/runtime-context";
import type { EventEntry } from "@/lib/runtime-context";
import { cn } from "@/lib/utils";
import { Mono } from "@/components/code";
import { EmptyState } from "@/components/empty-state";
import { LiveBadge, StatusDot } from "@/components/status";

function StatCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
          <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ entry }: { entry: EventEntry }) {
  const view = describeEvent(entry.event);
  return (
    <div className="flex items-baseline gap-3 border-b py-2 last:border-b-0">
      <span className={cn("shrink-0 font-mono text-xs tabular-nums", view.tone === "bad" ? "text-destructive" : "text-muted-foreground")}>
        {formatClock(entry.event.at)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className={cn("font-medium", view.tone === "bad" && "text-destructive")}>{view.title}</span>
        {view.detail ? <span className="ml-2 text-xs text-muted-foreground">{view.detail}</span> : null}
      </span>
    </div>
  );
}

export default function Overview({ onNavigate }: { onNavigate: (view: "events") => void }) {
  const { snapshot, snapshotAt, events, connected } = useRuntime();
  const now = useNow(1_000);
  const [reloading, setReloading] = useState(false);
  const plugins = useAsync(() => api.plugins(), []);

  const uptime = snapshot?.running ? Math.floor(snapshot.uptimeSeconds + (now - snapshotAt) / 1_000) : 0;
  const activeActions = snapshot?.activeActions ?? [];

  const reloadRuntime = async (): Promise<void> => {
    setReloading(true);
    try {
      await api.reloadRuntime();
      toast.success("重载已受理，稍后生效");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重载失败");
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <span
              className={cn(
                "flex size-11 items-center justify-center rounded-xl",
                snapshot?.running ? "bg-chart-4/15 text-chart-4" : "bg-muted text-muted-foreground"
              )}
            >
              <CpuIcon className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display text-lg font-semibold tracking-tight">
                  {snapshot ? (snapshot.running ? "运行时运行中" : "运行时已停止") : "读取运行状态…"}
                </p>
                {snapshot?.running ? <StatusDot tone="ok" pulse /> : null}
              </div>
              <p className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span>pid {snapshot?.pid ?? "-"}</span>
                <span aria-hidden="true">·</span>
                <span>
                  已运行 <span className="tabular-nums">{snapshot ? formatUptime(uptime) : "-"}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span>{connected ? "事件流已连接" : "事件流重连中"}</span>
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={reloading}>
                <RotateCcwIcon data-icon="inline-start" className={cn(reloading && "animate-spin")} />
                重载配置
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>重载全部配置？</AlertDialogTitle>
                <AlertDialogDescription>
                  运行时将停止现有流、重读 flows.yml 并按新配置重启，进程与会话池不会退出。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void reloadRuntime()}>重载</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {snapshot ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={ZapIcon}
            label="触发器"
            value={String(snapshot.triggers.length)}
            detail={`${snapshot.flows.filter((flow) => flow.kind === "trigger" && flow.active).length} 个活跃`}
          />
          <StatCard
            icon={CalendarClockIcon}
            label="定时任务"
            value={String(snapshot.schedules.length)}
            detail={snapshot.flows
              .filter((flow) => flow.kind === "schedule")
              .map((flow) => flow.cron ?? `每 ${flow.intervalSeconds}s`)
              .slice(0, 3)
              .join("、")}
          />
          <StatCard
            icon={PlayIcon}
            label="服务"
            value={String(snapshot.services.length)}
            detail={`${snapshot.activeServices.length} 个运行中`}
          />
          <StatCard
            icon={PackageIcon}
            label="插件"
            value={plugins.data ? String(plugins.data.length) : "-"}
            detail={plugins.data ? `${plugins.data.filter((plugin) => plugin.loaded).length} 个加载` : "读取中…"}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ActivityIcon className="size-4 text-muted-foreground" />
              正在执行的动作
              {activeActions.length > 0 ? <Badge variant="secondary">{activeActions.length}</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeActions.length === 0 ? (
              <EmptyState icon={FileClockIcon} title="当前没有执行中的动作" hint="动作开始与结束时，实时事件会出现在这里与事件页。" />
            ) : (
              <div className="flex flex-col gap-2">
                {activeActions.map((action) => (
                  <div key={action.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                    <StatusDot tone="ok" pulse />
                    <Mono className="text-sm">{action.capability}</Mono>
                    <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">#{action.id}</span>
                      {action.session ? <span className="font-mono">{action.session}</span> : null}
                      <span className="tabular-nums">{formatClock(action.startedAt)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ActivityIcon className="size-4 text-muted-foreground" />
              实时活动
              <LiveBadge label={connected ? "实时" : "离线"} tone={connected ? "ok" : "bad"} />
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("events")}>
              查看全部
            </Button>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <EmptyState icon={FileClockIcon} title="等待运行时事件" hint="动作、服务、定时与配置事件会实时出现在这里。" />
            ) : (
              <div>
                {events.slice(-10).reverse().map((entry) => (
                  <ActivityRow key={entry.seq} entry={entry} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}