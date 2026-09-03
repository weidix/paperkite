import { useState } from "react";
import { ImageIcon, TriangleAlertIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { LightboxItem, MediaItem } from "@/lib/types";

export function MediaThumb({
  media,
  index,
  onOpen,
  onExpand
}: {
  readonly media: MediaItem;
  readonly index: number;
  readonly onOpen: (item: LightboxItem) => void;
  readonly onExpand?: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const activate = (): void => {
    if (!requested) {
      setRequested(true);
      onExpand?.();
      return;
    }
    if (failed) {
      setFailed(false);
      setLoaded(false);
      setAttempt((current) => current + 1);
      return;
    }
    if (loaded) {
      onOpen({ src: media.media_url, alt: `消息图片 ${index + 1}` });
    }
  };

  const busy = requested && !loaded && !failed;
  const label = failed ? `重试加载图片 ${index + 1}` : loaded ? `查看图片 ${index + 1}` : `加载图片 ${index + 1}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={failed ? "图片加载失败，点击重试" : undefined}
      disabled={busy}
      onClick={activate}
      className="relative block size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/60 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {!requested ? (
        <ImageIcon className="absolute inset-0 m-auto size-6" aria-hidden="true" />
      ) : busy ? (
        <Spinner className="absolute inset-0 m-auto size-6" aria-hidden="true" />
      ) : failed ? (
        <TriangleAlertIcon className="absolute inset-0 m-auto size-6 text-destructive" aria-hidden="true" />
      ) : null}
      {requested ? (
        <img
          key={attempt}
          src={media.media_url}
          alt=""
          aria-hidden={!loaded}
          className={cn("absolute inset-0 size-full object-cover", !loaded && "opacity-0")}
          onLoad={() => {
            setLoaded(true);
            setFailed(false);
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </button>
  );
}