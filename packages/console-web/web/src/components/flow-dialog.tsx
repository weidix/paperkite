import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { Mono } from "@/components/code";
import { parseJson, prettyJson } from "@/lib/format";
import type { FlowKind, FlowPatch, FlowSnapshot } from "@/lib/runtime";
import { useRuntime } from "@/lib/runtime-context";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<FlowKind, string> = {
  trigger: "触发器",
  command: "命令",
  schedule: "定时任务",
  service: "服务"
};

const PATCHABLE_FIELDS: Record<FlowKind, readonly string[]> = {
  trigger: ["enabled", "config", "session", "maxRuns", "logFile", "actions"],
  command: ["title", "symbol", "run"],
  schedule: ["enabled", "session", "cron", "intervalSeconds", "logFile", "run"],
  service: ["enabled", "config", "session", "autoStart", "logFile"]
};

interface FlowDialogProps {
  readonly flow: FlowSnapshot;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function FlowDialog({ flow, open, onOpenChange }: FlowDialogProps) {
  const { refresh } = useRuntime();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(flow.enabled);
  const [session, setSession] = useState(flow.session ?? "");
  const [title, setTitle] = useState(flow.title ?? "");
  const [symbol, setSymbol] = useState(flow.symbol ?? "");
  const [cron, setCron] = useState(flow.cron ?? "");
  const [intervalSeconds, setIntervalSeconds] = useState(flow.intervalSeconds ? String(flow.intervalSeconds) : "");
  const [autoStart, setAutoStart] = useState(flow.autoStart ?? false);
  const [maxRuns, setMaxRuns] = useState(flow.maxRuns === undefined ? "" : String(flow.maxRuns));
  const [logFile, setLogFile] = useState(flow.logFile);
  const [configText, setConfigText] = useState(prettyJson(flow.config ?? {}));
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(flow.enabled);
    setSession(flow.session ?? "");
    setTitle(flow.title ?? "");
    setSymbol(flow.symbol ?? "");
    setCron(flow.cron ?? "");
    setIntervalSeconds(flow.intervalSeconds ? String(flow.intervalSeconds) : "");
    setAutoStart(flow.autoStart ?? false);
    setMaxRuns(flow.maxRuns === undefined ? "" : String(flow.maxRuns));
    setLogFile(flow.logFile);
    setConfigText(prettyJson(flow.config ?? {}));
    setConfigError(null);
  }, [flow, open]);

  const save = async (): Promise<void> => {
    const patch: FlowPatch = {};
    const allowed = PATCHABLE_FIELDS[flow.kind];
    if (allowed.includes("enabled")) patch.enabled = enabled;
    if (allowed.includes("session")) patch.session = session.trim() || undefined;
    if (allowed.includes("title")) patch.title = title.trim() || flow.id;
    if (allowed.includes("symbol")) patch.symbol = symbol.trim() || undefined;
    if (allowed.includes("maxRuns")) {
      patch.maxRuns = maxRuns.trim() === "" || maxRuns.trim() === "-1" ? undefined : Number(maxRuns);
      if (patch.maxRuns !== undefined && (!Number.isInteger(patch.maxRuns) || patch.maxRuns <= 0)) {
        setConfigError("maxRuns 须为正整数或留空");
        return;
      }
    }
    if (allowed.includes("logFile")) patch.logFile = logFile;
    if (allowed.includes("cron")) {
      const value = cron.trim();
      if (value && flow.kind === "schedule" && !intervalSeconds.trim()) {
        patch.cron = value;
      } else if (value) {
        setConfigError("cron 与 intervalSeconds 只能保留其一");
        return;
      }
    }
    if (allowed.includes("intervalSeconds")) {
      const value = intervalSeconds.trim();
      if (value && flow.kind === "schedule" && !cron.trim()) {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          setConfigError("intervalSeconds 须为正整数");
          return;
        }
        patch.intervalSeconds = parsed;
      } else if (value) {
        setConfigError("cron 与 intervalSeconds 只能保留其一");
        return;
      }
    }
    if (allowed.includes("autoStart")) patch.autoStart = autoStart;
    if (allowed.includes("config")) {
      try {
        const parsed = parseJson(configText);
        if (parsed !== undefined) patch.config = parsed;
      } catch {
        setConfigError("config 不是合法 JSON");
        return;
      }
    }
    setBusy(true);
    try {
      const result = await api.updateFlow(flow.id, patch);
      toast.success(result.changed ? "已保存并写回 flows.yml" : "没有变更");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const reload = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.reloadFlow(flow.id);
      toast.success("已按最新定义重载");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重载失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleService = async (): Promise<void> => {
    setBusy(true);
    try {
      if (flow.active) await api.stopService(flow.id);
      else await api.startService(flow.id);
      toast.success(flow.active ? "服务已停止" : "服务已启动");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const allowed = PATCHABLE_FIELDS[flow.kind];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-display">
            <Badge variant="outline">{KIND_LABEL[flow.kind]}</Badge>
            <Mono className="text-base">{flow.id}</Mono>
            {flow.active ? (
              <Badge variant="secondary">运行中</Badge>
            ) : flow.enabled ? (
              <Badge variant="outline">已启用</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                已停用
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            能力 <Mono>{flow.capability}</Mono>
            {flow.logFile ? " · 记录日志文件" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {allowed.includes("enabled") ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="flow-enabled">启用</Label>
              <Switch id="flow-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          ) : null}
          {allowed.includes("logFile") ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="flow-logfile">写入日志文件</Label>
              <Switch id="flow-logfile" checked={logFile} onCheckedChange={setLogFile} />
            </div>
          ) : null}
          {allowed.includes("autoStart") ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <Label htmlFor="flow-autostart">随运行时自动启动</Label>
              <Switch id="flow-autostart" checked={autoStart} onCheckedChange={setAutoStart} />
            </div>
          ) : null}
          {allowed.includes("session") ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-session">会话</Label>
              <Input id="flow-session" value={session} onChange={(event) => setSession(event.target.value)} placeholder="留空则无会话" />
            </div>
          ) : null}
          {allowed.includes("title") ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-title">标题</Label>
              <Input id="flow-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
          ) : null}
          {allowed.includes("symbol") ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-symbol">符号</Label>
              <Input id="flow-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="可选" />
            </div>
          ) : null}
          {allowed.includes("maxRuns") ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-maxruns">最多触发次数</Label>
              <Input id="flow-maxruns" value={maxRuns} onChange={(event) => setMaxRuns(event.target.value)} placeholder="留空无限制" />
            </div>
          ) : null}
          {flow.kind === "schedule" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="flow-cron">cron 表达式</Label>
                <Input id="flow-cron" value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 8 * * *" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="flow-interval">间隔（秒）</Label>
                <Input id="flow-interval" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)} placeholder="每 N 秒" />
              </div>
            </>
          ) : null}
        </div>

        {allowed.includes("config") ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flow-config">config（JSON）</Label>
            <Textarea
              id="flow-config"
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              className={cn("min-h-28 font-mono text-xs", configError && "border-destructive")}
              spellCheck={false}
            />
            {configError ? <p className="text-xs text-destructive">{configError}</p> : null}
          </div>
        ) : null}

        {flow.kind === "trigger" && flow.actions && flow.actions.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label>动作链</Label>
            <div className="flex flex-col gap-1">
              {flow.actions.map((action, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
                  <span className="font-mono text-muted-foreground">{index + 1}.</span>
                  <Mono>{action.capability}</Mono>
                  {action.session ? <span className="font-mono text-muted-foreground">{action.session}</span> : null}
                  {action.hook ? <Badge variant="outline">hook {action.hook}</Badge> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {flow.kind === "command" || flow.kind === "schedule" ? (
          <div className="flex flex-col gap-1.5">
            <Label>动作</Label>
            <div className="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs">{flow.capability}</div>
          </div>
        ) : null}

        <Separator />

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {flow.kind === "service" ? (
              <Button variant="outline" onClick={() => void toggleService()} disabled={busy}>
                {flow.active ? "停止服务" : "启动服务"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void reload()} disabled={busy}>
              重载此条
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button onClick={() => void save()} disabled={busy || configError !== null}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}