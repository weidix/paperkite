<script lang="ts">
  import { Image, TriangleAlert } from "lucide-svelte";
  import Spinner from "$lib/components/ui/spinner.svelte";
  import { cn } from "$lib/utils";
  import type { LightboxItem, MediaItem } from "$lib/types";

  let {
    media,
    index,
    onOpen,
    onExpand
  }: {
    media: MediaItem;
    index: number;
    onOpen: (item: LightboxItem) => void;
    onExpand?: () => void;
  } = $props();

  let requested = $state(false);
  let loaded = $state(false);
  let failed = $state(false);
  let attempt = $state(0);

  const busy = $derived(requested && !loaded && !failed);
  const label = $derived(
    failed ? `重试加载图片 ${index + 1}` : loaded ? `查看图片 ${index + 1}` : `加载图片 ${index + 1}`
  );

  function activate(): void {
    if (!requested) {
      requested = true;
      onExpand?.();
      return;
    }
    if (failed) {
      failed = false;
      loaded = false;
      attempt += 1;
      return;
    }
    if (loaded) {
      onOpen({ src: media.media_url, alt: `消息图片 ${index + 1}` });
    }
  }
</script>

<button
  type="button"
  aria-label={label}
  title={failed ? "图片加载失败，点击重试" : undefined}
  disabled={busy}
  onclick={activate}
  class="relative block size-20 shrink-0 overflow-hidden rounded-lg border bg-muted/60 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
>
  {#if !requested}
    <Image class="absolute inset-0 m-auto size-6" aria-hidden="true" />
  {:else if busy}
    <Spinner class="absolute inset-0 m-auto size-6" />
  {:else if failed}
    <TriangleAlert class="absolute inset-0 m-auto size-6 text-destructive" aria-hidden="true" />
  {/if}
  {#if requested}
    {#key attempt}
      <img
        src={media.media_url}
        alt=""
        aria-hidden={!loaded}
        loading="lazy"
        decoding="async"
        class={cn("absolute inset-0 size-full object-cover", !loaded && "opacity-0")}
        onload={() => {
          loaded = true;
          failed = false;
        }}
        onerror={() => (failed = true)}
      />
    {/key}
  {/if}
</button>