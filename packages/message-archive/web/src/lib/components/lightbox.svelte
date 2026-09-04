<script lang="ts">
  import { AudioLines, ChevronLeft, ChevronRight, Download, File, Image as ImageIcon, Video, X } from "lucide-svelte";
  import { closeLightbox, lightbox, selectLightbox, stepLightbox } from "$lib/state.svelte";
  import Button from "$lib/components/button.svelte";
  import { fmtBytes } from "$lib/format";

  const CLOSE_ID = "lightbox-close";

  function iconOfKind(mime: string) {
    if (mime.startsWith("video/")) return Video;
    if (mime.startsWith("image/")) return ImageIcon;
    if (mime.startsWith("audio/")) return AudioLines;
    return File;
  }

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
        lightbox.mime = result.mime ?? "";
        lightbox.downloadUrl = result.downloadUrl ?? "";
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
      if (event.key === "Home") selectLightbox(0);
      if (event.key === "End") selectLightbox(lightbox.items.length - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
</script>

{#if lightbox.open}
  {@const item = lightbox.items[lightbox.index]}
  {@const hasNav = lightbox.items.length > 1}
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
    <div class="relative z-10 flex h-12 shrink-0 items-center gap-1.5 border-b px-2.5">
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        disabled={!hasNav}
        aria-label="上一张"
        onclick={() => stepLightbox(-1)}
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
      </Button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-center text-sm font-medium leading-5">{item?.name ?? ""}</p>
        <p class="truncate text-center font-mono text-[10px] leading-4 text-muted-foreground">
          {item ? `${lightbox.source} · ${fmtBytes(item.size)} · ${item.spec}` : ""}
        </p>
      </div>
      {#if lightbox.downloadUrl}
        <a
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          href={lightbox.downloadUrl}
          aria-label="下载媒体文件"
        >
          <Download class="size-4" aria-hidden="true" />
        </a>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        disabled={!hasNav}
        aria-label="下一张"
        onclick={() => stepLightbox(1)}
      >
        <ChevronRight class="size-4" aria-hidden="true" />
      </Button>
      <Button
        id={CLOSE_ID}
        variant="ghost"
        size="icon"
        class="size-8"
        aria-label="关闭"
        onclick={closeLightbox}
      >
        <X class="size-4" aria-hidden="true" />
      </Button>
    </div>
    <div class="relative z-10 flex min-h-0 flex-1 items-center justify-center p-2">
      <div class="max-h-full max-w-full">
        {#if item}
          {@const mime = lightbox.mime || item.mime}
          {#if mime.startsWith("video/")}
            {#if lightbox.failed}
              <div class="rounded-lg border border-border bg-card p-8 font-mono text-xs text-muted-foreground">媒体加载失败</div>
            {:else if lightbox.src}
              <video src={lightbox.src} controls class="max-h-[78vh] max-w-full rounded-lg border border-border shadow-sm" aria-label={item.name}><track kind="captions" /></video>
            {:else}
              <div class="p-8 font-mono text-xs text-muted-foreground">加载中…</div>
            {/if}
          {:else if mime.startsWith("audio/")}
            {#if lightbox.failed}
              <div class="rounded-lg border border-border bg-card p-8 font-mono text-xs text-muted-foreground">媒体加载失败</div>
            {:else if lightbox.src}
              <audio src={lightbox.src} controls class="max-w-full" aria-label={item.name}></audio>
            {:else}
              <div class="p-8 font-mono text-xs text-muted-foreground">加载中…</div>
            {/if}
          {:else if mime.startsWith("image/")}
            {#if lightbox.failed}
              <div class="rounded-lg border border-border bg-card p-8 font-mono text-xs text-muted-foreground">
                媒体加载失败
              </div>
            {:else if lightbox.src}
              <img
                src={lightbox.src}
                alt={item.name}
                class="max-h-[78vh] max-w-full animate-zoom-in rounded-lg border border-border bg-card object-contain shadow-sm"
                onerror={() => (lightbox.failed = true)}
              />
            {:else}
              <div class="p-8 font-mono text-xs text-muted-foreground">加载中…</div>
            {/if}
          {:else}
            {#if lightbox.failed}
              <div class="rounded-lg border border-border bg-card p-8 font-mono text-xs text-muted-foreground">媒体加载失败</div>
            {:else if lightbox.src}
              <div class="rounded-lg border border-border bg-card p-8 text-center">
                <p class="font-mono text-xs text-muted-foreground">该媒体类型不支持在线预览</p>
                <p class="mt-1 font-mono text-[11px] text-muted-foreground/70">{mime || "未知类型"}</p>
                {#if lightbox.downloadUrl}
                  <a
                    class="mt-3 inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input bg-background px-3 font-mono text-[11px] shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    href={lightbox.downloadUrl}
                  >
                    <Download class="size-3.5" aria-hidden="true" />
                    下载文件
                  </a>
                {/if}
              </div>
            {:else}
              <div class="p-8 font-mono text-xs text-muted-foreground">加载中…</div>
            {/if}
          {/if}
        {/if}
      </div>
    </div>
    {#if hasNav}
      <div class="relative z-10 flex h-11 shrink-0 items-center gap-2 border-t px-2.5">
        <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{lightbox.index + 1} / {lightbox.items.length}</span>
        <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-1">
          {#each lightbox.items as jumps, i (i)}
            {@const Icon = iconOfKind(jumps.mime)}
            <button
              type="button"
              class="flex size-7 shrink-0 items-center justify-center rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {i === lightbox.index ? 'border-transparent bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
              aria-label={`第 ${i + 1} 项`}
              aria-current={i === lightbox.index ? "true" : undefined}
              onclick={() => selectLightbox(i)}
            >
              <Icon class="size-3.5" aria-hidden="true" />
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}