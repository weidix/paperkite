<script lang="ts">
  import { ChevronLeft, ChevronRight, X } from "lucide-svelte";
  import { closeLightbox, lightbox, stepLightbox } from "$lib/state.svelte";
  import Button from "$lib/components/button.svelte";
  import { fmtBytes } from "$lib/format";

  const CLOSE_ID = "lightbox-close";

  $effect(() => {
    if (!lightbox.open) return;
    const item = lightbox.items[lightbox.index];
    if (!item) return;
    lightbox.failed = false;
    const index = lightbox.index;
    item.load().then((result) => {
      if (lightbox.index === index) {
        lightbox.src = result.url;
        lightbox.source = result.source;
      }
    }).catch(() => {
      if (lightbox.index === index) lightbox.failed = true;
    });
    document.getElementById(CLOSE_ID)?.focus();
  });

  $effect(() => {
    if (!lightbox.open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") stepLightbox(-1);
      if (event.key === "ArrowRight") stepLightbox(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
</script>

{#if lightbox.open}
  {@const item = lightbox.items[lightbox.index]}
  <div
    class="fixed inset-0 z-40 flex animate-fade-in flex-col bg-background/95 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="媒体预览"
  >
    <button
      type="button"
      tabindex="-1"
      class="absolute inset-0 cursor-default"
      aria-label="关闭预览"
      onclick={closeLightbox}
    ></button>
    <div class="relative flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <Button
        variant="ghost"
        size="icon"
        disabled={lightbox.items.length < 2}
        aria-label="上一张"
        onclick={() => stepLightbox(-1)}
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
      </Button>
      <div class="min-w-0 flex-1 text-center">
        <span class="truncate text-sm font-medium">{item?.name ?? ""}</span>
        <span class="ml-2 font-mono text-[11px] text-muted-foreground">
          {item ? `${lightbox.source} · ${fmtBytes(item.size)} · ${item.spec}` : ""}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        disabled={lightbox.items.length < 2}
        aria-label="下一张"
        onclick={() => stepLightbox(1)}
      >
        <ChevronRight class="size-4" aria-hidden="true" />
      </Button>
      <Button
        id={CLOSE_ID}
        variant="ghost"
        size="icon"
        aria-label="关闭"
        onclick={closeLightbox}
      >
        <X class="size-4" aria-hidden="true" />
      </Button>
    </div>
    <div class="relative flex min-h-0 flex-1 items-center justify-center p-4">
      <div class="max-h-full max-w-full">
        {#if item}
          {#if item.mime.startsWith("video/")}
            <video src={lightbox.src} controls class="max-h-[78vh] max-w-full rounded-lg border border-border shadow-sm" aria-label={item.name}><track kind="captions" /></video>
          {:else if lightbox.failed}
            <div class="rounded-lg border border-border bg-card p-8 font-mono text-xs text-muted-foreground">
              媒体加载失败
            </div>
          {:else}
            <img
              src={lightbox.src}
              alt={item.name}
              class="max-h-[78vh] max-w-full animate-zoom-in rounded-lg border border-border bg-card object-contain shadow-sm"
              onerror={() => (lightbox.failed = true)}
            />
          {/if}
        {/if}
      </div>
    </div>
    {#if lightbox.items.length > 1}
      <div class="relative h-10 shrink-0 border-t text-center font-mono text-[11px] leading-10 text-muted-foreground">
        {lightbox.index + 1} / {lightbox.items.length}
      </div>
    {/if}
  </div>
{/if}