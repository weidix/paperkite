<script lang="ts">
  import { Image as ImageIcon, Images, Play, Reply } from "lucide-svelte";
  import { fetchReplyChain } from "$lib/api";
  import { fmtTs, richSegments, senderName, telegramMessageRefOf, urlRangesOf } from "$lib/format";
  import { fileThumbOf, openAlbumLightbox } from "$lib/media";
  import { navigate, rememberSenderFromRecord, showToast } from "$lib/state.svelte";
  import MessageMenu from "$lib/components/message-menu.svelte";
  import TelegramLink from "$lib/components/telegram-link.svelte";
  import UserMenu from "$lib/components/user-menu.svelte";
  import type { AlbumContextEntry, MessageRecord } from "$lib/model";

  let {
    entry = { kind: "album", rows: [], captionText: "", recordId: "" },
    anchor = false,
    inlineThumb = false,
    showChat = false,
    highlights = []
  }: {
    entry: AlbumContextEntry;
    anchor?: boolean;
    /** 检索列表内联缩略图：带媒体行直接预览，不进详情。 */
    inlineThumb?: boolean;
    /** 检索跨多个会话时标注来源会话名（单会话筛选下省略）。 */
    showChat?: boolean;
    highlights?: readonly string[];
  } = $props();

  const first = $derived(entry.rows[0]);
  /** 说明文本对应的实体：取文本与说明一致的成员行（相册说明挂在任一成员上）。 */
  const captionEntities = $derived(
    entry.rows.find((row) => row.text !== "" && row.text === entry.captionText)?.entities
    ?? entry.rows[0]?.entities
  );
  const captionSegments = $derived(richSegments(entry.captionText, highlights, urlRangesOf(entry.captionText, captionEntities)));
  /** 相册内联缩略图：带媒体的行取前 3 张，保留原行号供预览定位。 */
  const thumbs = $derived(entry.rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.hasMedia)
    .slice(0, 3));
  const extraMedia = $derived(entry.rows.filter((row) => row.hasMedia).length - thumbs.length);
  let failedKeys = $state<Record<string, boolean>>({});
  /** 说明实际被 line-clamp 截断（与字符数无关：换行/长词也会截断）。 */
  let captionEl = $state<HTMLParagraphElement | null>(null);
  let captionExpanded = $state(false);
  let captionClipped = $state(false);

  $effect(() => {
    const el = captionEl;
    if (el === null || captionExpanded) return;
    void entry.captionText;
    const check = (): void => {
      captionClipped = el.scrollHeight > el.clientHeight + 1;
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  });

  $effect(() => {
    const firstRow = entry.rows[0];
    if (firstRow !== undefined) rememberSenderFromRecord(firstRow);
  });

  function openRow(): void {
    navigate({ kind: "message", recordId: entry.recordId });
  }

  function onRowKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRow();
    }
  }

  /** 点按回复指示：经回复链接口解析被回复消息的行 ID 后跳转。 */
  async function openReplied(event: MouseEvent): Promise<void> {
    const anchor = first;
    if (anchor === undefined) return;
    event.stopPropagation();
    try {
      const chain = await fetchReplyChain(anchor.recordId);
      if (chain.parent === undefined) {
        showToast("被回复的消息不存在或不可见");
        return;
      }
      const recordId = chain.parent.kind === "album" ? chain.parent.recordId : chain.parent.record.recordId;
      navigate({ kind: "message", recordId });
    } catch {
      showToast("无法取回被回复的消息");
    }
  }
</script>

<div
  class="group transition-colors {anchor ? 'bg-accent/70' : 'hover:bg-accent/50'}"
  id="msg-{entry.recordId}"
>
  <div class="flex items-stretch">
    <div
      class="flex min-w-0 flex-1 cursor-pointer gap-3 px-4 py-2 text-left"
      role="button"
      tabindex="0"
      aria-label="查看相册（{entry.rows.length} 张）"
      onclick={openRow}
      onkeydown={onRowKeydown}
    >
      <div class="w-[102px] shrink-0 pt-0.5 text-right font-mono text-[10px] leading-4 text-muted-foreground">
        <div>{first ? fmtTs(first.date) : ""}</div>
        <div class="text-muted-foreground/60">{first ? `#${first.messageId}` : ""}</div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span class="font-medium">{first ? senderName(first) : ""}</span>
          {#if showChat && first?.chatTitle}
            <span class="font-mono text-[10px] text-muted-foreground">{first.chatTitle}</span>
          {/if}
          <span class="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
            <Images class="size-3" aria-hidden="true" />
            {entry.rows.length}
          </span>
        </div>
        {#if first && first.replyToMessageId !== undefined}
          <button
            type="button"
            class="mt-0.5 inline-flex min-w-0 max-w-full items-center gap-1 rounded px-0.5 font-mono text-[10px] text-muted-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
            title="查看被回复的消息"
            aria-label="查看被回复的消息 #{first.replyToMessageId}"
            onclick={openReplied}
          >
            <Reply class="size-3 shrink-0" aria-hidden="true" />
            <span class="truncate">回复 #{first.replyToMessageId}{first.replyToText ? ` · ${first.replyToText}` : ""}</span>
          </button>
        {/if}
        <p
          class="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug {captionExpanded ? '' : 'line-clamp-2'}"
          bind:this={captionEl}
        >
          {#if entry.captionText}
            {#each captionSegments as segment, i (i)}
              {#if segment.hit}
                <mark class="rounded-md bg-foreground px-1 text-background">{segment.text}</mark>
              {:else if segment.url}
                {#if telegramMessageRefOf(segment.url)}
                  <TelegramLink
                    href={segment.url}
                    ref={telegramMessageRefOf(segment.url)!}
                    class="break-all text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:decoration-primary"
                  >{segment.text}</TelegramLink>
                {:else}
                  <a
                    href={segment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="break-all text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:decoration-primary"
                    title="在新标签页打开"
                    onclick={(event) => event.stopPropagation()}
                  >{segment.text}</a>
                {/if}
              {:else}
                <span>{segment.text}</span>
              {/if}
            {/each}
          {:else}
            <span class="text-muted-foreground">（相册）</span>
          {/if}
        </p>
      </div>
    </div>
    {#if inlineThumb && thumbs.length > 0}
      <div class="flex shrink-0 items-center gap-1 pl-1">
        {#each thumbs as item, i (item.row.recordId)}
          {@const spec = fileThumbOf(item.row)}
          <button
            type="button"
            class="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="预览相册第 {i + 1} 行媒体"
            onclick={() => openAlbumLightbox(entry, item.index)}
          >
            {#if spec.url && !failedKeys[item.row.recordId]}
              <img
                src={spec.url}
                alt=""
                loading="lazy"
                class="h-full w-full object-cover"
                onerror={() => (failedKeys[item.row.recordId] = true)}
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
    <div class="flex w-16 shrink-0 items-center justify-end gap-0.5 pr-1.5">
      {#if first}
        <UserMenu record={first} />
        <MessageMenu
          record={first}
          keywordSource={entry.captionText}
          navRecordId={anchor ? (entry.focusRecordId ?? entry.recordId) : null}
        />
      {/if}
    </div>
  </div>
  {#if captionClipped || captionExpanded}
    <div class="flex self-start pb-2 pl-[130px]">
      <button
        class="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onclick={() => (captionExpanded = !captionExpanded)}
        aria-expanded={captionExpanded}
        aria-label={captionExpanded ? "收起全文" : "展开全文"}
      >
        <span>{captionExpanded ? "收起" : "展开全文"}</span>
        <span class="text-muted-foreground/60">· {entry.captionText.length} 字</span>
      </button>
    </div>
  {/if}
</div>