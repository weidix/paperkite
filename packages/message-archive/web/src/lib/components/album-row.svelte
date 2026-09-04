<script lang="ts">
  import { Images } from "lucide-svelte";
  import { fmtTs, senderName } from "$lib/format";
  import { navigate } from "$lib/state.svelte";
  import type { AlbumContextEntry } from "$lib/model";

  let {
    entry,
    anchor = false
  } = $props<{
    entry: AlbumContextEntry;
    anchor?: boolean;
  }>();

  const first = $derived(entry.rows[0]);
</script>

<div
  class="group transition-colors {anchor ? 'bg-accent/70' : 'hover:bg-accent/50'}"
  id="msg-{entry.rowId}"
>
  <button
    class="flex w-full gap-3 px-4 py-2 text-left"
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
</div>