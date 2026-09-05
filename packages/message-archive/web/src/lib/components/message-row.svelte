<script lang="ts">
  import { AudioLines, File, Image as ImageIcon, Paperclip, Play } from "lucide-svelte";
  import { fmtTs, highlightSegments, senderName } from "$lib/format";
  import { fileThumbOf, openMessageLightbox } from "$lib/media";
  import { navigate } from "$lib/state.svelte";
  import type { MessageRecord } from "$lib/model";

  let {
    record,
    highlights = [],
    showChat = false,
    anchor = false,
    fullText = false,
    expandable = true,
    inlineThumb = false
  } = $props<{
    record: MessageRecord;
    highlights?: readonly string[];
    showChat?: boolean;
    anchor?: boolean;
    fullText?: boolean;
    expandable?: boolean;
    /** 检索列表内联缩略图：带媒体行直接预览，不进详情。 */
    inlineThumb?: boolean;
  }>();

  const segments = $derived(highlightSegments(record.text, highlights));
  const canExpandBase = $derived(expandable && !fullText);
  const thumb = $derived(fileThumbOf(record));
  let expanded = $state(false);
  let thumbFailed = $state(false);

  /** 段落实际被 line-clamp 截断（与字符数无关：换行/长词也会截断）。 */
  let textEl = $state<HTMLParagraphElement | null>(null);
  let clipped = $state(false);

  $effect(() => {
    const el = textEl;
    if (el === null || !canExpandBase || expanded) return;
    const check = (): void => {
      clipped = el.scrollHeight > el.clientHeight + 1;
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<div
  class="group transition-colors {anchor ? 'bg-accent/70' : 'hover:bg-accent/50'}"
  id="msg-{record.rowId}"
>
  <div class="flex items-stretch">
    <button
      class="flex min-w-0 flex-1 gap-3 px-4 py-2 text-left"
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
      <p
        class="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug {expanded || fullText ? '' : 'line-clamp-3'}"
        bind:this={textEl}
      >
        {#if record.text}
          {#each segments as segment, i (i)}
            {#if segment.hit}
              <mark class="rounded-md bg-foreground px-1 text-background">{segment.text}</mark>
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
  {#if inlineThumb && record.hasMedia}
    <div class="flex shrink-0 items-center pl-1 pr-3">
      <button
        type="button"
        class="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="预览媒体"
        onclick={() => openMessageLightbox(record)}
      >
        {#if thumb.url && !thumbFailed}
          <img
            src={thumb.url}
            alt=""
            loading="lazy"
            class="h-full w-full object-cover"
            onerror={() => (thumbFailed = true)}
          />
          {#if thumb.kind === "video"}
            <span class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span class="flex size-4.5 items-center justify-center rounded-full bg-black/45">
                <Play class="size-2.5 text-white" fill="currentColor" />
              </span>
            </span>
          {/if}
        {:else if thumb.kind === "video"}
          <Play class="size-4" fill="currentColor" aria-hidden="true" />
        {:else if thumb.kind === "audio"}
          <AudioLines class="size-4" aria-hidden="true" />
        {:else if thumb.kind === "image"}
          <ImageIcon class="size-4" aria-hidden="true" />
        {:else}
          <File class="size-4" aria-hidden="true" />
        {/if}
      </button>
    </div>
  {/if}
  </div>
  {#if canExpandBase && (expanded || clipped)}
    <div class="flex self-start pb-2 pl-[130px]">
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