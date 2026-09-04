<script lang="ts">
  import { Paperclip } from "lucide-svelte";
  import { fmtTs, senderName } from "$lib/format";
  import { navigate } from "$lib/state.svelte";
  import type { MessageRecord } from "$lib/model";

  let {
    record,
    highlights = [],
    showChat = false,
    anchor = false,
    fullText = false,
    expandable = true
  } = $props<{
    record: MessageRecord;
    highlights?: readonly string[];
    showChat?: boolean;
    anchor?: boolean;
    fullText?: boolean;
    expandable?: boolean;
  }>();

  const segments = $derived(highlightSegments(record.text, highlights));
  const canExpand = $derived(expandable && !fullText && record.text.length > 120);
  let expanded = $state(false);

  interface TextSegment {
    readonly text: string;
    readonly hit: boolean;
  }

  /** 将文本按多个检索词切分为命中/未命中片段；命中的首个词优先。 */
  function highlightSegments(text: string, highlights: readonly string[]): TextSegment[] {
    const needles = highlights.map((term) => term.toLowerCase()).filter((term) => term.length > 0);
    if (needles.length === 0 || text.length === 0) return [{ text, hit: false }];
    const lower = text.toLowerCase();
    const segments: TextSegment[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let next: { index: number; word: string } | undefined;
      for (const needle of needles) {
        const index = lower.indexOf(needle, cursor);
        if (index >= 0 && (next === undefined || index < next.index)) next = { index, word: needle };
      }
      if (next === undefined) {
        segments.push({ text: text.slice(cursor), hit: false });
        break;
      }
      if (next.index > cursor) segments.push({ text: text.slice(cursor, next.index), hit: false });
      segments.push({ text: text.slice(next.index, next.index + next.word.length), hit: true });
      cursor = next.index + next.word.length;
    }
    return segments;
  }
</script>

<div
  class="group transition-colors {anchor ? 'bg-accent/70' : 'hover:bg-accent/50'}"
  id="msg-{record.rowId}"
>
  <button
    class="flex w-full gap-3 px-4 py-2 text-left"
    onclick={() => navigate({ kind: "message", rowId: record.rowId })}
    aria-label="查看消息 #{(record.messageId)}"
  >
    <div class="w-[102px] shrink-0 pt-0.5 text-right font-mono text-[10px] leading-4 text-muted-foreground">
      <div>{fmtTs(record.date)}</div>
      <div class="text-muted-foreground/60">#{record.messageId}</div>
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span class="font-medium">{senderName(record)}</span>
        {#if showChat && record.chatTitle}
          <span class="font-mono text-[10px] text-muted-foreground">{record.chatTitle}</span>
        {/if}
        {#if record.mediaType && record.mediaType !== "text"}
          <span class="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
            <Paperclip class="size-3" aria-hidden="true" />
            {#if record.mediaFiles.length > 1}{record.mediaFiles.length}{/if}
          </span>
        {/if}
      </div>
      <p class="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug {expanded || fullText ? '' : 'line-clamp-3'}">
        {#if record.text}
          {#each segments as segment, i (i)}
            {#if segment.hit}
              <mark class="rounded-[2px] bg-foreground/15 text-foreground">{segment.text}</mark>
            {:else}
              <span>{segment.text}</span>
            {/if}
          {/each}
        {:else}
          <span class="text-muted-foreground">（无文本）</span>
        {/if}
      </p>
    </div>
  </button>
  {#if canExpand}
    <div class="flex pb-2 pl-[130px]">
      <button
        class="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onclick={() => (expanded = !expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? "收起全文" : "展开全文"}
      >
        <span>{expanded ? "收起" : "展开全文"}</span>
        <span class="text-muted-foreground/60">· {record.text.length} 字</span>
      </button>
    </div>
  {/if}
</div>