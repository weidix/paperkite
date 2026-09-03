import { useRef, useState } from "react";
import { ImageIcon, TriangleAlertIcon } from "lucide-react";
import {
  Attachment,
  AttachmentMedia,
  AttachmentTrigger
} from "@/components/ui/attachment";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LightboxItem, MediaItem, SearchRow } from "@/lib/types";

function MediaThumb({
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

  return (
    <Attachment size="xs" orientation="vertical" className="relative">
      <AttachmentMedia variant={loaded ? "image" : "icon"}>
        {failed ? (
          <TriangleAlertIcon aria-label="图片加载失败" />
        ) : !requested ? (
          <ImageIcon />
        ) : (
          <>
            <img
              key={attempt}
              src={media.media_url}
              alt={`消息图片 ${index + 1}`}
              className={cn("absolute inset-0 size-full object-cover", !loaded && "opacity-0")}
              onLoad={() => {
                setLoaded(true);
                setFailed(false);
              }}
              onError={() => setFailed(true)}
            />
            {!loaded ? <Spinner /> : null}
          </>
        )}
      </AttachmentMedia>
      <AttachmentTrigger
        aria-label={failed ? `重试加载图片 ${index + 1}` : loaded ? `查看图片 ${index + 1}` : `加载图片 ${index + 1}`}
        title={failed ? "图片加载失败，点击重试" : undefined}
        onClick={activate}
      />
    </Attachment>
  );
}

export function MediaGallery({
  row,
  onOpen,
  className
}: {
  readonly row: SearchRow;
  readonly onOpen: (item: LightboxItem) => void;
  readonly className?: string;
}) {
  const initial = row.media_items.filter((media) => media && media.media_url);
  const [items, setItems] = useState<readonly MediaItem[]>(initial);
  const expanded = useRef(false);

  const expandAlbum = (): void => {
    if (expanded.current || initial.length > 1) return;
    expanded.current = true;
    api
      .album(row.id)
      .then((album) => {
        if (album.length > initial.length) setItems(album);
      })
      .catch(() => undefined);
  };

  if (!items.length) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((media, index) => (
        <MediaThumb
          key={media.media_url + String(media.message_id ?? "")}
          media={media}
          index={index}
          onOpen={onOpen}
          onExpand={expandAlbum}
        />
      ))}
    </div>
  );
}