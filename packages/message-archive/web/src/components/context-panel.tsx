import { useEffect, useRef, useState } from "react";
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
import type { ContextPayload, LightboxItem, SearchRow } from "@/lib/types";

const CONTEXT_INITIAL_WINDOW = 120;

function ContextMessage({
  row,
  keyword,
  anchor,
  onOpenMedia
}: {
  readonly row: SearchRow;
  readonly keyword: string;
  readonly anchor: boolean;
  readonly onOpenMedia: (item: LightboxItem) => void;
}) {
  return (
    <Message align={anchor ? "end" : "start"}>
      <MessageContent>
        <MessageHeader className="flex-wrap gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{formatSender(row)}</span>
          <span className="font-mono">{formatMessageDate(row.date)}</span>
          <Badge variant="secondary" className="text-[11px]">
            {messageTypeLabel(row.message_type)}
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
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    centerAnchor(viewportRef.current, anchorRef.current, false);
  }, [payload]);

  const scrollToAnchor = (): void => {
    centerAnchor(viewportRef.current, anchorRef.current, true);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        <div className="flex flex-col gap-4 pb-2">
          {payload.before.map((row) => (
            <ContextMessage key={row.id} row={row} keyword={keyword} anchor={false} onOpenMedia={onOpenMedia} />
          ))}
          {payload.anchor ? (
            <>
              <Marker variant="separator">当前消息</Marker>
              <div ref={anchorRef}>
                <ContextMessage row={payload.anchor} keyword={keyword} anchor onOpenMedia={onOpenMedia} />
              </div>
            </>
          ) : null}
          {payload.after.map((row) => (
            <ContextMessage key={row.id} row={row} keyword={keyword} anchor={false} onOpenMedia={onOpenMedia} />
          ))}
        </div>
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

function centerAnchor(viewport: HTMLDivElement | null, anchor: HTMLDivElement | null, smooth: boolean): void {
  if (!viewport || !anchor) return;
  const viewportRect = viewport.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const top = viewport.scrollTop + anchorRect.top + anchorRect.height / 2 - (viewportRect.top + viewportRect.height / 2);
  const target = Math.max(top, 0);
  if (smooth) {
    viewport.scrollTo({ top: target, behavior: "smooth" });
  } else {
    viewport.scrollTop = target;
  }
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