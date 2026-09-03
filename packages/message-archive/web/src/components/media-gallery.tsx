import { useRef, useState } from "react";
import { MediaThumb } from "@/components/media-thumb";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LightboxItem, MediaItem, SearchRow } from "@/lib/types";

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
    <div className={cn("flex flex-wrap gap-2 group-data-[align=end]/message:justify-end", className)}>
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