<script lang="ts">
  import { Image as ImageIcon, Images, Play } from "lucide-svelte";
  import { fmtTs, senderName } from "$lib/format";
  import { fileThumbOf, openAlbumLightbox } from "$lib/media";
  import { navigate } from "$lib/state.svelte";
  import type { AlbumContextEntry, MessageRecord } from "$lib/model";

  let {
    entry = { kind: "album", rows: [], captionText: "", rowId: "" },
    anchor = false,
    inlineThumb = false
  }: {
    entry: AlbumContextEntry;
    anchor?: boolean;
    /** 检索列表内联缩略图：带媒体行直接预览，不进详情。 */
    inlineThumb?: boolean;
  } = $props();

  const first = $derived(entry.rows[0]);
  /** 相册内联缩略图：带媒体的行取前 3 张，保留原行号供预览定位。 */
  const thumbs = $derived(entry.rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.hasMedia)
    .slice(0, 3));
  const extraMedia = $derived(entry.rows.filter((row) => row.hasMedia).length - thumbs.length);
  let failedKeys = $state<Record<string, boolean>>({});
</script>

<div
  class="group transition-colors {anchor ? 'bg-accent/70' : 'hover:bg-accent/50'}"
  id="msg-{entry.rowId}"
>
  <div class="flex items-stretch">
    <button
      class="flex min-w-0 flex-1 gap-3 px-4 py-2 text-left"
      onclick={() => navigate({ kind: "message", rowId: entry.rowId })}
      aria-label="查看相册（{entry.rows.length} 张）"
    >
      <div class="w-[102px] shrink-0 pt-0.5 text-right font-mono text-[10px] leading-4 text-muted-foreground">
        <div>{first ? fmtTs(first.date) : ""}</div>
        <div class="text-muted-foreground/60">{first ? `#${first.messageId}` : ""}</div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span class="font-medium">{first ? senderName(first) : ""}</span>
          <span class="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
            <Images class="size-3" aria-hidden="true" />
            {entry.rows.length}
          </span>
        </div>
        <p class="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[13px] leading-snug">
          {#if entry.captionText}
            {entry.captionText}
          {:else}
            <span class="text-muted-foreground">（相册）</span>
          {/if}
        </p>
      </div>
    </button>
    {#if inlineThumb && thumbs.length > 0}
      <div class="flex shrink-0 items-center gap-1 pl-1 pr-3">
        {#each thumbs as item, i (item.row.rowId)}
          {@const spec = fileThumbOf(item.row)}
          <button
            type="button"
            class="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="预览相册第 {i + 1} 行媒体"
            onclick={() => openAlbumLightbox(entry, item.index)}
          >
            {#if spec.url && !failedKeys[item.row.rowId]}
              <img
                src={spec.url}
                alt=""
                loading="lazy"
                class="h-full w-full object-cover"
                onerror={() => (failedKeys[item.row.rowId] = true)}
              />
              {#if spec.kind === "video"}
                <span class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span class="flex size-4.5 items-center justify-center rounded-full bg-black/45">
                    <Play class="size-2.5 text-white" fill="currentColor" />
                  </span>
                </span>
              {/if}
            {:else if spec.kind === "video"}
              <Play class="size-4" fill="currentColor" aria-hidden="true" />
            {:else}
              <ImageIcon class="size-4" aria-hidden="true" />
            {/if}
          </button>
        {/each}
        {#if extraMedia > 0}
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground">+{extraMedia}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>