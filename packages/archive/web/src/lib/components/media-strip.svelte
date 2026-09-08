<script lang="ts">
  import { AudioLines, File, Image as ImageIcon, Play } from "lucide-svelte";
  import type { MediaKind } from "$lib/media";
  import type { StoredMediaFile } from "$lib/model";

  export interface StripTile {
    readonly key: string;
    readonly kind: MediaKind;
    readonly file: StoredMediaFile | null;
    readonly label: string;
    /** 加载提示用的媒体名（如 media_993514）。 */
    readonly name: string;
    /** 直接加载的图源：落盘文件或 Telegram 原生缩略图；未设置时按类型画图标。 */
    readonly thumbUrl?: string;
    /** 附加角标，如相册行内多附件计数。 */
    readonly badge?: string;
    /** 未落盘，经在线缩略图取回。 */
    readonly live: boolean;
    /** 已知不可取回（未落盘且未配置会话）。 */
    readonly disabled?: boolean;
  }

  let {
    tiles = [],
    onselect
  }: {
    tiles: StripTile[];
    onselect(tileIndex: number): void;
  } = $props();

  const done = $state<Record<string, boolean>>({});
  const failed = $state<Record<string, boolean>>({});

  $effect(() => {
    const keys = new Set(tiles.map((tile) => tile.key));
    for (const key of Object.keys(done)) if (!keys.has(key)) delete done[key];
    for (const key of Object.keys(failed)) if (!keys.has(key)) delete failed[key];
  });

  /** 图源已就绪但尚未加载完成：显示骨架 + 底部加载条 + 媒体名。 */
  function loadingOf(tile: StripTile): boolean {
    return tile.thumbUrl !== undefined && !done[tile.key] && !failed[tile.key];
  }

  const singleImage = $derived(tiles.length === 1 && tiles[0]?.kind === "image");
  const tileSize = $derived(singleImage ? "h-28 w-44" : "h-16 w-16");
</script>

<div class="border-t border-border/60 px-3 py-2.5">
  <div class="flex gap-1.5 overflow-x-auto p-1">
    {#each tiles as tile, i (tile.key)}
      <button
        type="button"
        id="strip-{tile.key}"
        class="relative shrink-0 overflow-hidden rounded-md border outline-none transition-colors {tileSize} {tile.disabled ? 'cursor-default opacity-40' : 'cursor-pointer'} border-border hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
        disabled={tile.disabled}
        title={tile.disabled ? "未落盘且未配置会话，无法取回" : undefined}
        aria-label={tile.disabled
          ? `第 ${tile.label} 项（不可取回）`
          : tile.file
            ? `预览 ${tile.file.fileName ?? "媒体文件"} ${tile.label}`
            : `预览媒体 ${tile.label}`}
        onclick={() => onselect(i)}
      >
        {#if tile.thumbUrl !== undefined && !failed[tile.key]}
          <span class="relative block h-full w-full">
            {#if loadingOf(tile)}
              <span class="absolute inset-0 animate-pulse bg-muted" aria-hidden="true"></span>
            {/if}
            <img
              src={tile.thumbUrl}
              alt=""
              loading="lazy"
              class="relative h-full w-full object-cover"
              onload={() => (done[tile.key] = true)}
              onerror={() => (failed[tile.key] = true)}
            />
            {#if tile.kind === "video"}
              <span class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                <span class="flex size-5 items-center justify-center rounded-full bg-black/45">
                  <Play class="size-3 text-white" fill="currentColor" />
                </span>
              </span>
            {/if}
          </span>
        {:else if tile.kind === "video"}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <Play class="size-4 text-muted-foreground" fill="currentColor" aria-hidden="true" />
          </span>
        {:else if tile.kind === "image"}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <ImageIcon class="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        {:else if tile.kind === "audio"}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <AudioLines class="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        {:else}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <File class="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        {/if}
        {#if loadingOf(tile)}
          <span class="absolute inset-x-0 bottom-0 z-10 h-[2px] bg-border/80" aria-hidden="true">
            <span class="loading-bar block h-full w-1/3 bg-primary/80"></span>
          </span>
          <span class="absolute bottom-1 left-1 z-10 max-w-[calc(100%-0.5rem)] truncate rounded border bg-card/90 px-1 font-mono text-[9px] leading-3.5 text-muted-foreground">
            {tile.name}
          </span>
        {:else if tiles.length > 1 || tile.badge}
          <span class="absolute bottom-0.5 left-0.5 z-10 rounded border bg-card/90 px-1 font-mono text-[9px] leading-3.5 text-muted-foreground">
            {tile.label}
          </span>
        {/if}
        {#if tile.badge}
          <span class="absolute right-0.5 top-0.5 z-10 rounded border bg-card/90 px-1 font-mono text-[9px] leading-3.5 text-muted-foreground">
            {tile.badge}
          </span>
        {/if}
        {#if tile.live}
          <span class="absolute bottom-0.5 right-0.5 z-10 rounded border bg-card/90 px-1 font-mono text-[9px] leading-3.5 text-muted-foreground">
            在线
          </span>
        {/if}
      </button>
    {/each}
  </div>
  {#if tiles.length > 1}
    <p class="mt-1.5 px-0.5 font-mono text-[9px] text-muted-foreground/70">
      缩略图自动加载 · 点击直接预览 · 预览中按 ←/→ 或 Home/End 快速切换
    </p>
  {/if}
</div>