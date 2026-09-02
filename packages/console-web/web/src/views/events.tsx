import { useMemo, useState } from "react";
import { EraserIcon, PauseIcon, PlayIcon, RadioIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CollapsibleJson, Mono } from "@/components/code";
import { EmptyState } from "@/components/empty-state";
import { describeEvent } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { RUNTIME_EVENT_TYPES } from "@/lib/runtime";
import { useRuntime } from "@/lib/runtime-context";
import type { EventEntry } from "@/lib/runtime-context";
import { cn } from "@/lib/utils";

const TONE_VARIANT = {
  ok: "secondary",
  bad: "destructive",
  warn: "outline",
  info: "outline"
} as const;

function eventPayload(event: EventEntry["event"]): unknown {
  switch (event.type) {
    case "action.started":
      return event.payload === undefined ? undefined : { payload: event.payload };
    case "action.finished":
      return event.error !== undefined || event.effectivePayload !== undefined
        ? { error: event.error, effectivePayload: event.effectivePayload, skipped: event.skipped }
        : undefined;
    case "service.stopped":
      return { reason: event.reason, error: event.error };
    case "config.reloaded":
      return event.error === undefined ? undefined : { error: event.error };
    default:
      return undefined;
  }
}

function EventRow({ entry, expanded, onToggle }: { entry: EventEntry; expanded: boolean; onToggle: () => void }) {
  const view = describeEvent(entry.event);
  const event = entry.event;
  const payload = eventPayload(event);

  return (
    <div className="border-b px-4 py-3 last:border-b-0">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={onToggle}>
        <span className={cn("shrink-0 font-mono text-xs tabular-nums", view.tone === "bad" ? "text-destructive" : "text-muted-foreground")}>
          {formatDateTime(event.at)}
        </span>
        <Badge variant={TONE_VARIANT[view.tone]}>{event.type}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className={cn("font-medium", view.tone === "bad" && "text-destructive")}>{view.title}</span>
          {view.detail ? <span className="ml-2 text-xs text-muted-foreground">{view.detail}</span> : null}
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-2 pl-32">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Mono>#{entry.seq}</Mono>
            {"capability" in event ? <Mono>{event.capability}</Mono> : null}
            {"flow" in event && event.flow ? (
              <Mono>
                {event.flow.kind}:{event.flow.id}
              </Mono>
            ) : null}
          </div>
          {payload !== undefined ? <CollapsibleJson value={payload} label="详情" /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Events() {
  const { events } = useRuntime();
  const [filter, setFilter] = useState<string>("all");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<readonly EventEntry[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [clearedThrough, setClearedThrough] = useState(0);

  const source = paused ? frozen : events;
  const visible = useMemo(() => {
    const afterClear = source.filter((entry) => entry.seq > clearedThrough);
    return filter === "all" ? afterClear : afterClear.filter((entry) => entry.event.type === filter);
  }, [source, paused, filter, clearedThrough]);

  const eventCount = (type: string): number => events.filter((entry) => entry.event.type === type).length;

  const togglePause = (): void => {
    if (!paused) setFrozen(events);
    setPaused((current) => !current);
  };

  const clear = (): void => {
    setClearedThrough(Math.max(clearedThrough, ...events.map((entry) => entry.seq), 0));
    setExpanded(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-56" aria-label="事件类型筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {RUNTIME_EVENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                <span className="font-mono">{type}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">({eventCount(type)})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {paused ? (
          <Badge variant="outline" className="text-muted-foreground">
            已暂停
          </Badge>
        ) : null}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={togglePause}>
          {paused ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}
          {paused ? "继续" : "暂停"}
        </Button>
        <Button variant="outline" size="sm" onClick={clear}>
          <EraserIcon data-icon="inline-start" />
          清空
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={RadioIcon}
          title={paused ? "已暂停接收" : "还没有事件"}
          hint={paused ? "点击「继续」恢复实时事件流。" : "动作、服务、定时与配置事件会实时出现在这里。"}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            {visible.slice().reverse().map((entry) => (
              <EventRow
                key={entry.seq}
                entry={entry}
                expanded={expanded === entry.seq}
                onToggle={() => setExpanded((current) => (current === entry.seq ? null : entry.seq))}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}