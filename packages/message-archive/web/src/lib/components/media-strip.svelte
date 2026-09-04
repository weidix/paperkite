<script lang="ts">
  import { File, Image as ImageIcon, Play } from "lucide-svelte";
  import { mediaDiskUrl } from "$lib/api";
  import type { StoredMediaFile } from "$lib/model";

  export interface StripTile {
    readonly key: string;
    readonly kind: "image" | "video" | "file";
    readonly file: StoredMediaFile | null;
    readonly label: string;
    /** 附加角标，如相册行内多附件计数。 */
    readonly badge?: string;
    /** 未落盘，需在线取回。 */
    readonly live: boolean;
    /** 已知不可取回（未落盘且未配置会话）。 */
    readonly disabled?: boolean;
  }

  let {
    tiles,
    onselect
  } = $props<{
    tiles: StripTile[];
    onselect(tileIndex: number): void;
  }>();

  let failed = $state(new Set<string>());

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
        {#if tile.kind === "image" && !tile.live && tile.file && !failed.has(tile.key)}
          <img
            src={mediaDiskUrl(tile.file.id)}
            alt=""
            loading="lazy"
            class="h-full w-full object-cover"
            onerror={() => failed.add(tile.key)}
          />
        {:else if tile.kind === "video"}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <Play class="size-4 text-muted-foreground" fill="currentColor" aria-hidden="true" />
          </span>
        {:else if tile.kind === "image"}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <ImageIcon class="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        {:else}
          <span class="flex h-full w-full items-center justify-center bg-muted">
            <File class="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        {/if}
        {#if tiles.length > 1 || tile.badge}
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
      点击缩略图直接预览 · 预览中按 ←/→ 或 Home/End 快速切换
    </p>
  {/if}
</div>