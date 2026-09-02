import { useCallback, useEffect, useRef, useState } from "react";
import { FileTextIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Mono } from "@/components/code";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import { useRuntime } from "@/lib/runtime-context";

const LINE_OPTIONS = [100, 200, 500, 2000] as const;
const REFRESH_INTERVAL_MS = 3_000;

export default function Logs() {
  const { snapshot, refresh } = useRuntime();
  const scopes = snapshot?.logs ?? [];
  const [scope, setScope] = useState<string>("");
  const [lines, setLines] = useState<number>(200);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [content, setContent] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const effectiveScope = scopes.some((item) => item.scope === scope) ? scope : (scopes[0]?.scope ?? "");

  const load = useCallback(async (): Promise<void> => {
    if (!effectiveScope) return;
    setBusy(true);
    try {
      const result = await api.logLines(effectiveScope, lines);
      setContent(result.lines);
      viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "日志读取失败");
    } finally {
      setBusy(false);
    }
  }, [effectiveScope, lines]);

  useEffect(() => {
    void load();
  }, [load, snapshot?.pid]);

  useEffect(() => {
    if (!autoRefresh || !effectiveScope) return;
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, effectiveScope, load]);

  if (scopes.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="没有可用的日志文件"
        hint="在 settings.yml 中配置 logging.directory 后，运行时会为核心与每个插件写入日志文件。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={effectiveScope} onValueChange={setScope}>
          <SelectTrigger className="w-64" aria-label="日志来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scopes.map((item) => (
              <SelectItem key={item.scope} value={item.scope}>
                <span className="font-mono">{item.scope}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(lines)} onValueChange={(value) => setLines(Number(value))}>
          <SelectTrigger className="w-28" aria-label="显示行数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINE_OPTIONS.map((count) => (
              <SelectItem key={count} value={String(count)}>
                最近 {count} 行
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="自动刷新" />
          自动刷新
        </label>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCwIcon data-icon="inline-start" className={busy ? "animate-spin" : undefined} />
          刷新
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          更新日志列表
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <FileTextIcon className="size-4 text-muted-foreground" />
            <Mono className="text-xs text-muted-foreground">{scopes.find((item) => item.scope === effectiveScope)?.path}</Mono>
          </div>
          <div
            ref={viewportRef}
            className="h-[60vh] overflow-auto"
          >
            {content.length === 0 ? (
              <p className="px-4 py-10 text-center font-mono text-xs text-muted-foreground">暂无日志内容</p>
            ) : (
              <pre className="whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed">{content.join("\n")}</pre>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}