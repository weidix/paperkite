<script lang="ts">
  import MediaThumb from "$lib/components/media-thumb.svelte";
  import { api } from "$lib/api";
  import { cn } from "$lib/utils";
  import type { LightboxItem, MediaItem, SearchRow } from "$lib/types";

  let {
    row,
    onOpen,
    class: className = ""
  }: { row: SearchRow; onOpen: (item: LightboxItem) => void; class?: string } = $props();

  function initialMedia(): MediaItem[] {
    return row.media_items.filter((media) => media && media.media_url);
  }
  let items: readonly MediaItem[] = $state(initialMedia());
  let expanded = false;

  function expandAlbum(): void {
    if (expanded || initialMedia().length > 1) return;
    expanded = true;
    api
      .album(row.id)
      .then((album) => {
        if (album.length > initialMedia().length) items = album;
      })
      .catch(() => undefined);
  }
</script>

{#if items.length > 0}
  <div class={cn("flex flex-wrap gap-2", className)}>
    {#each items as media, index (`${media.media_url}${media.message_id ?? ""}`)}
      <MediaThumb {media} {index} {onOpen} onExpand={expandAlbum} />
    {/each}
  </div>
{/if}