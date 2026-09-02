import { useMemo, useState } from "react";
import { ArrowRightIcon, PlayIcon, SlidersHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import { describeEvent } from "@/lib/events";
import { formatClock } from "@/lib/format";
import { parseJson } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import { useRuntime } from "@/lib/runtime-context";
import { cn } from "@/lib/utils";

export default function Actions() {
  const { events } = useRuntime();
  const plugins = useAsync(() => api.plugins(), []);
  const [capability, setCapability] = useState("");
  const [session, setSession] = useState("");
  const [hook, setHook] = useState("");
  const [configText, setConfigText] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const capabilities = useMemo(() => {
    const names = new Set<string>();
    for (const plugin of plugins.data ?? []) {
      for (const item of plugin.capabilities) {
        if (item.kind === "action") names.add(item.name);
      }
    }
    return [...names].sort();
  }, [plugins.data]);

  const run = async (): Promise<void> => {
    const trimmed = capability.trim();
    if (!trimmed) {
      toast.error("需要填写能力名");
      return;
    }
    let config: unknown;
    try {
      config = parseJson(configText);
    } catch {
      setConfigError("config 不是合法 JSON");
      return;
    }
    setBusy(true);
    try {
      await api.runAction({
        capability: trimmed,
        session: session.trim() || undefined,
        hook: hook.trim() || undefined,
        config
      });
      toast.success(`已执行 ${trimmed}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "执行失败");
    } finally {
      setBusy(false);
    }
  };

  const recent = events.filter((entry) => entry.event.type.startsWith("action.")).slice(-8).reverse();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <PlayIcon className="size-4 text-muted-foreground" />
            执行动作
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert>
            <SlidersHorizontalIcon />
            <AlertTitle>临时执行原语</AlertTitle>
            <AlertDescription>
              按能力名 + 配置执行任意动作，结果与事件会出现在事件页。不写入 flows.yml。
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="action-capability">能力 *</Label>
            <Input
              id="action-capability"
              list="action-capabilities"
              value={capability}
              onChange={(event) => setCapability(event.target.value)}
              placeholder={plugins.loading ? "读取能力清单…" : "如 notifications.bark"}
              className="font-mono"
              spellCheck={false}
            />
            <datalist id="action-capabilities">
              {capabilities.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="action-session">会话（可选）</Label>
              <Input id="action-session" value={session} onChange={(event) => setSession(event.target.value)} className="font-mono" placeholder="会话名" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="action-hook">hook（可选）</Label>
              <Input id="action-hook" value={hook} onChange={(event) => setHook(event.target.value)} className="font-mono" placeholder="hooks/xxx.ts" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="action-config">config（JSON，可选）</Label>
            <Textarea
              id="action-config"
              value={configText}
              onChange={(event) => {
                setConfigText(event.target.value);
                setConfigError(null);
              }}
              className={cn("min-h-28 font-mono text-xs", configError && "border-destructive")}
              placeholder={'{\n  "peer": "@someone",\n  "text": "hello"\n}'}
              spellCheck={false}
            />
            {configError ? <p className="text-xs text-destructive">{configError}</p> : null}
          </div>

          <Button onClick={() => void run()} disabled={busy} className="self-start">
            <ArrowRightIcon data-icon="inline-end" />
            执行
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            最近动作
            <Badge variant="secondary">{recent.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState icon={PlayIcon} title="还没有动作事件" hint="执行动作后，开始与结束事件会在这里列出。" />
          ) : (
            <div className="flex flex-col">
              {recent.map((entry) => {
                const view = describeEvent(entry.event);
                return (
                  <div key={entry.seq} className="flex items-baseline gap-3 border-b py-2 last:border-b-0">
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatClock(entry.event.at)}</span>
                    <span className={cn("min-w-0 flex-1 truncate text-sm", view.tone === "bad" ? "font-medium text-destructive" : "font-medium")}>
                      {view.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{view.detail}</span>
                  </div>
                );
              })}
            </div>
          )}
          {plugins.loading ? <Skeleton className="mt-2 h-4 w-40" /> : null}
          {plugins.error ? <p className="mt-2 text-xs text-destructive">能力清单读取失败：{plugins.error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}