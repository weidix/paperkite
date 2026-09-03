import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { CrosshairIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker } from "@/components/ui/marker";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaGallery } from "@/components/media-gallery";
import { api } from "@/lib/api";
import { formatMessageDate, formatSender, messageTypeLabel } from "@/lib/format";
import { HighlightedText } from "@/lib/highlight";
import type { ContextPayload, LightboxItem, MediaItem, SearchRow } from "@/lib/types";

const CONTEXT_INITIAL_WINDOW = 120;
const ROW_GAP = 16;
const ROW_BOTTOM_PAD = 8;
const SCROLL_BUFFER = 600;
const VIEWPORT_PAD_Y = 32;
const ANCHOR_SLICE_EXTENT = 30;

interface ContextEntry {
  readonly id: string;
  rows: SearchRow[];
  anchor: boolean;
}

function representativeRow(rows: readonly SearchRow[]): SearchRow {
  return (rows.find((row) => row.text) ?? rows[0])!;
}

function mergeAlbumMedia(rows: readonly SearchRow[]): readonly MediaItem[] {
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  for (const row of rows) {
    for (const media of row.media_items) {
      if (seen.has(media.media_url)) continue;
      seen.add(media.media_url);
      items.push(media);
    }
  }
  return items;
}

function estimateItemHeight(row: SearchRow): number {
  const textLines = row.text ? Math.max(1, Math.ceil(row.text.length / 40)) : 1;
  const mediaHeight = row.has_preview ? 84 : 0;
  return 26 + textLines * 21 + mediaHeight + 20;
}

function estimateEntryHeight(entry: ContextEntry): number {
  const base = estimateItemHeight(representativeRow(entry.rows));
  return entry.rows.length > 1 ? base + 24 : base;
}

function mergeMeasured(prev: Readonly<Record<string, number>>, measured: Readonly<Record<string, number>>): Record<string, number> {
  let changed = false;
  const next = { ...prev };
  for (const [id, height] of Object.entries(measured)) {
    if (height > 0 && Math.abs(height - (next[id] ?? -1)) > 0.5) {
      next[id] = height;
      changed = true;
    }
  }
  return changed ? next : prev;
}

function windowFromScroll(scrollTop: number, offsets: readonly number[], contentHeight: number): readonly [number, number] {
  const itemCount = offsets.length - 1;
  if (itemCount <= 0) return [0, 0];
  const top = Math.max(0, scrollTop - SCROLL_BUFFER);
  const bottom = scrollTop + contentHeight + SCROLL_BUFFER;
  let start = 0;
  while (start < itemCount && (offsets[start + 1] ?? 0) <= top) start += 1;
  let end = itemCount;
  while (end > 0 && (offsets[end - 1] ?? 0) >= bottom) end -= 1;
  if (end <= start) {
    const mid = Math.max(0, Math.min(start, itemCount - 1));
    start = Math.max(0, mid - 1);
    end = Math.min(itemCount, mid + 2);
  }
  return [start, end];
}

function centerTarget(anchorIndex: number, offsets: readonly number[], anchorHeight: number, contentHeight: number): number {
  return Math.max(0, (offsets[anchorIndex] ?? 0) + anchorHeight / 2 - contentHeight / 2);
}

function centerAnchorDom(viewport: HTMLDivElement | null, anchor: HTMLDivElement | null, smooth: boolean): void {
  if (!viewport || !anchor) return;
  const viewportRect = viewport.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const target = Math.max(0, viewport.scrollTop + anchorRect.top + anchorRect.height / 2 - (viewportRect.top + viewportRect.height / 2));
  if (smooth) {
    viewport.scrollTo({ top: target, behavior: "smooth" });
  } else {
    viewport.scrollTop = target;
  }
}

function ContextMessage({
  row,
  keyword,
  anchor,
  albumCount,
  onOpenMedia
}: {
  readonly row: SearchRow;
  readonly keyword: string;
  readonly anchor: boolean;
  readonly albumCount?: number;
  readonly onOpenMedia: (item: LightboxItem) => void;
}) {
  return (
    <Message align={anchor ? "end" : "start"}>
      <MessageContent>
        <MessageHeader className="flex-wrap gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{formatSender(row)}</span>
          <span className="font-mono">{formatMessageDate(row.date)}</span>
          <Badge variant="secondary" className="text-[11px]">
            {albumCount !== undefined ? `相册 ${albumCount}` : messageTypeLabel(row.message_type)}
          </Badge>
          {anchor ? (
            <Badge variant="default" className="text-[11px]">
              当前消息
            </Badge>
          ) : null}
        </MessageHeader>
        <Bubble variant={anchor ? "tinted" : "outline"} align={anchor ? "end" : "start"}>
          <BubbleContent>
            {row.text ? (
              <HighlightedText text={row.text} keyword={keyword} />
            ) : (
              <span className="text-muted-foreground">（无文本内容）</span>
            )}
          </BubbleContent>
        </Bubble>
        <MediaGallery row={row} onOpen={onOpenMedia} className="px-1" />
      </MessageContent>
    </Message>
  );
}

function ContextThread({
  payload,
  keyword,
  onOpenMedia
}: {
  readonly payload: ContextPayload;
  readonly keyword: string;
  readonly onOpenMedia: (item: LightboxItem) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchorElementRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});
  const [windowIndices, setWindowIndices] = useState<readonly [number, number]>([0, 0]);
  const centeringRef = useRef(false);

  const entries = useMemo<readonly ContextEntry[]>(() => {
    const list: readonly (readonly [SearchRow, boolean])[] = [
      ...payload.before.map((row) => [row, false] as const),
      ...(payload.anchor ? [[payload.anchor, true] as const] : []),
      ...payload.after.map((row) => [row, false] as const)
    ];
    const result: ContextEntry[] = [];
    for (const [row, anchor] of list) {
      const last = result[result.length - 1];
      if (last && row.grouped_id && last.rows[0]!.grouped_id === row.grouped_id) {
        last.rows.push(row);
        if (anchor) last.anchor = true;
      } else {
        result.push({ id: row.grouped_id ?? row.id, rows: [row], anchor });
      }
    }
    return result;
  }, [payload]);

  const anchorIndex = useMemo(() => entries.findIndex((entry) => entry.anchor), [entries]);
  const anchor = anchorIndex >= 0 ? (entries[anchorIndex] ?? null) : null;

  const offsets = useMemo(() => {
    const result = new Array<number>(entries.length + 1);
    let acc = 0;
    for (let i = 0; i < entries.length; i += 1) {
      result[i] = acc;
      const height = heights[entries[i]!.id] ?? estimateEntryHeight(entries[i]!);
      acc += height + (i < entries.length - 1 ? ROW_GAP : ROW_BOTTOM_PAD);
    }
    result[entries.length] = acc;
    return result;
  }, [entries, heights]);

  useLayoutEffect(() => {
    centeringRef.current = true;
    setWindowIndices([0, 0]);
  }, [payload]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const elements = Array.from(viewport.querySelectorAll<HTMLElement>("[data-context-row]"));
    const measured: Record<string, number> = {};
    for (const element of elements) {
      const id = element.dataset.contextRow;
      if (id) measured[id] = element.getBoundingClientRect().height;
    }
    setHeights((prev) => mergeMeasured(prev, measured));
    const observer = new ResizeObserver((entries) => {
      const live: Record<string, number> = {};
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.contextRow;
        if (id) live[id] = entry.target.getBoundingClientRect().height;
      }
      setHeights((prev) => mergeMeasured(prev, live));
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [windowIndices]);

  useLayoutEffect(() => {
    if (!centeringRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport || anchorIndex < 0 || !anchor) return;
    const contentHeight = Math.max(0, viewport.clientHeight - VIEWPORT_PAD_Y);
    const anchorElement = anchorElementRef.current;
    if (!anchorElement) {
      const target = centerTarget(anchorIndex, offsets, heights[anchor.id] ?? estimateEntryHeight(anchor), contentHeight);
      viewport.scrollTop = target;
      const start = Math.max(0, anchorIndex - ANCHOR_SLICE_EXTENT);
      const end = Math.min(entries.length, anchorIndex + ANCHOR_SLICE_EXTENT + 1);
      setWindowIndices((current) => (current[0] === start && current[1] === end ? current : ([start, end] as const)));
    } else {
      centeringRef.current = false;
      centerAnchorDom(viewport, anchorElement, false);
      const [start, end] = windowFromScroll(viewport.scrollTop, offsets, contentHeight);
      setWindowIndices((current) => (current[0] === start && current[1] === end ? current : ([start, end] as const)));
    }
  }, [heights, offsets, entries.length, anchor, anchorIndex, windowIndices]);

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    if (centeringRef.current) return;
    const viewport = event.currentTarget;
    const contentHeight = Math.max(0, viewport.clientHeight - VIEWPORT_PAD_Y);
    const [start, end] = windowFromScroll(viewport.scrollTop, offsets, contentHeight);
    setWindowIndices((current) => (current[0] === start && current[1] === end ? current : ([start, end] as const)));
  };

  const scrollToAnchor = (): void => {
    if (anchorElementRef.current) {
      centerAnchorDom(viewportRef.current, anchorElementRef.current, true);
      const viewport = viewportRef.current;
      if (!viewport) return;
      const contentHeight = Math.max(0, viewport.clientHeight - VIEWPORT_PAD_Y);
      const [start, end] = windowFromScroll(viewport.scrollTop, offsets, contentHeight);
      setWindowIndices((current) => (current[0] === start && current[1] === end ? current : ([start, end] as const)));
      return;
    }
    centeringRef.current = true;
    const start = Math.max(0, anchorIndex - ANCHOR_SLICE_EXTENT);
    const end = Math.min(entries.length, anchorIndex + ANCHOR_SLICE_EXTENT + 1);
    setWindowIndices((current) => (current[0] === start && current[1] === end ? current : ([start, end] as const)));
  };

  const [start, end] = windowIndices;
  const slice = entries.slice(start, end);
  const spacerTop = offsets[start] ?? 0;
  const spacerBottom = (offsets[entries.length] ?? 0) - (offsets[end] ?? 0);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5"
      >
        <div style={{ height: spacerTop }} aria-hidden="true" />
        <div className="flex flex-col gap-4 pb-2">
          {slice.map((entry) => {
            const rows = entry.rows;
            const row = rows.length > 1 ? { ...representativeRow(rows), media_items: mergeAlbumMedia(rows) } : (rows[0]!);
            const message = (
              <ContextMessage
                row={row}
                keyword={keyword}
                anchor={entry.anchor}
                albumCount={rows.length > 1 ? rows.length : undefined}
                onOpenMedia={onOpenMedia}
              />
            );
            return entry.anchor ? (
              <Fragment key={entry.id}>
                <Marker variant="separator">当前消息</Marker>
                <div ref={anchorElementRef} data-context-row={entry.id}>
                  {message}
                </div>
              </Fragment>
            ) : (
              <div key={entry.id} data-context-row={entry.id}>
                {message}
              </div>
            );
          })}
        </div>
        <div style={{ height: spacerBottom }} aria-hidden="true" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <Button size="sm" variant="secondary" className="pointer-events-auto" onClick={scrollToAnchor}>
          <CrosshairIcon data-icon="inline-start" />
          回到当前消息
        </Button>
      </div>
    </div>
  );
}

function ContextBody({
  payload,
  error,
  loading,
  keyword,
  onOpenMedia
}: {
  readonly payload: ContextPayload | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly keyword: string;
  readonly onOpenMedia: (item: LightboxItem) => void;
}) {
  if (loading && !payload) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-16 w-2/3" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>加载上下文失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!payload?.anchor) {
    return <div className="p-4 text-sm text-muted-foreground">未找到上下文</div>;
  }
  return <ContextThread payload={payload} keyword={keyword} onOpenMedia={onOpenMedia} />;
}

interface ContextPanelProps {
  readonly target: { readonly rowId: string; readonly keyword: string } | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenMedia: (item: LightboxItem) => void;
}

export function ContextPanel({ target, open, onOpenChange, onOpenMedia }: ContextPanelProps) {
  const [payload, setPayload] = useState<ContextPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    api
      .context(target.rowId, CONTEXT_INITIAL_WINDOW, CONTEXT_INITIAL_WINDOW)
      .then((result) => {
        if (!cancelled) setPayload(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const meta = payload?.anchor
    ? `${payload.anchor.chat_title || "未知群组"} · ${formatMessageDate(payload.anchor.date)} · ` +
      `上文 ${payload.before.length} 条 · 下文 ${payload.after.length} 条`
    : "选择一条消息后查看同群上下文";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="font-display">同群上下文</SheetTitle>
          <SheetDescription>{meta}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <ContextBody payload={payload} error={error} loading={loading} keyword={target?.keyword ?? ""} onOpenMedia={onOpenMedia} />
        </div>
      </SheetContent>
    </Sheet>
  );
}