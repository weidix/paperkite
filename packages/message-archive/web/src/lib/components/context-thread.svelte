<script lang="ts">
  import { Crosshair } from "lucide-svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Marker from "$lib/components/ui/marker.svelte";
  import Message from "$lib/components/ui/message.svelte";
  import MessageContent from "$lib/components/ui/message-content.svelte";
  import MessageHeader from "$lib/components/ui/message-header.svelte";
  import Bubble from "$lib/components/ui/bubble.svelte";
  import BubbleContent from "$lib/components/ui/bubble-content.svelte";
  import MediaGallery from "$lib/components/media-gallery.svelte";
  import HighlightedText from "$lib/highlight.svelte";
  import { api } from "$lib/api";
  import { formatMessageDate, formatSender, messageTypeLabel } from "$lib/format";
  import type { ContextPayload, LightboxItem, MediaItem, SearchRow } from "$lib/types";

  const CONTEXT_INITIAL_WINDOW = 120;
  const ROW_GAP = 16;
  const ROW_BOTTOM_PAD = 8;
  const SCROLL_BUFFER = 600;
  const VIEWPORT_PAD_Y = 32;
  const ANCHOR_SLICE_EXTENT = 30;

  interface ContextEntry {
    readonly id: string;
    readonly rows: readonly SearchRow[];
    readonly anchor: boolean;
  }

  function representativeRow(rows: readonly SearchRow[]): SearchRow {
    return (rows.find((row) => row.text) ?? rows[0])!;
  }

  function mergeAlbumMedia(rows: readonly SearchRow[]): readonly MediaItem[] {
    const seen = new Set<string>();
    const items: MediaItem[] = [];
    for (const row of rows) {
      for (const media of row.media_items) {
        if (seen.has(media.media_url)) continue;
        seen.add(media.media_url);
        items.push(media);
      }
    }
    return items;
  }

  function estimateItemHeight(row: SearchRow): number {
    const textLines = row.text ? Math.max(1, Math.ceil(row.text.length / 40)) : 1;
    const mediaHeight = row.has_preview ? 84 : 0;
    return 26 + textLines * 21 + mediaHeight + 20;
  }

  function estimateEntryHeight(entry: ContextEntry): number {
    const base = estimateItemHeight(representativeRow(entry.rows));
    return entry.rows.length > 1 ? base + 24 : base;
  }

  function mergeMeasured(
    prev: Readonly<Record<string, number>>,
    measured: Readonly<Record<string, number>>
  ): Record<string, number> {
    let changed = false;
    const next = { ...prev };
    for (const [id, height] of Object.entries(measured)) {
      if (height > 0 && Math.abs(height - (next[id] ?? -1)) > 0.5) {
        next[id] = height;
        changed = true;
      }
    }
    return changed ? next : prev;
  }

  function windowFromScroll(
    scrollTop: number,
    offsets: readonly number[],
    contentHeight: number
  ): readonly [number, number] {
    const itemCount = offsets.length - 1;
    if (itemCount <= 0) return [0, 0];
    const top = Math.max(0, scrollTop - SCROLL_BUFFER);
    const bottom = scrollTop + contentHeight + SCROLL_BUFFER;
    let start = 0;
    while (start < itemCount && (offsets[start + 1] ?? 0) <= top) start += 1;
    let end = itemCount;
    while (end > 0 && (offsets[end - 1] ?? 0) >= bottom) end -= 1;
    if (end <= start) {
      const mid = Math.max(0, Math.min(start, itemCount - 1));
      start = Math.max(0, mid - 1);
      end = Math.min(itemCount, mid + 2);
    }
    return [start, end];
  }

  function centerTarget(
    anchorIndex: number,
    offsets: readonly number[],
    anchorHeight: number,
    contentHeight: number
  ): number {
    return Math.max(0, (offsets[anchorIndex] ?? 0) + anchorHeight / 2 - contentHeight / 2);
  }

  function centerAnchorDom(viewport: HTMLDivElement, anchor: HTMLDivElement, smooth: boolean): void {
    const viewportRect = viewport.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const target = Math.max(0, viewport.scrollTop + anchorRect.top + anchorRect.height / 2 - (viewportRect.top + viewportRect.height / 2));
    if (smooth) {
      viewport.scrollTo({ top: target, behavior: "smooth" });
    } else {
      viewport.scrollTop = target;
    }
  }

  function groupEntries(payload: ContextPayload): readonly ContextEntry[] {
    const list: readonly (readonly [SearchRow, boolean])[] = [
      ...payload.before.map((row) => [row, false] as const),
      ...(payload.anchor ? [[payload.anchor, true] as const] : []),
      ...payload.after.map((row) => [row, false] as const)
    ];
    const result: ContextEntry[] = [];
    for (const [row, anchor] of list) {
      const last = result[result.length - 1];
      if (last && row.grouped_id && last.rows[0]!.grouped_id === row.grouped_id) {
        result[result.length - 1] = { ...last, rows: [...last.rows, row], anchor: last.anchor || anchor };
      } else {
        result.push({ id: row.grouped_id ?? row.id, rows: [row], anchor });
      }
    }
    return result;
  }

  let {
    payload,
    keyword,
    onOpenMedia
  }: {
    payload: ContextPayload;
    keyword: string;
    onOpenMedia: (item: LightboxItem) => void;
  } = $props();

  let viewport: HTMLDivElement | null = $state(null);
  let anchorElement: HTMLDivElement | null = $state(null);
  let heights: Record<string, number> = $state({});
  let windowIndices: readonly [number, number] = $state([0, 0]);
  let centering = $state(true);

  const entries = $derived(groupEntries(payload));
  const anchorIndex = $derived(entries.findIndex((entry) => entry.anchor));
  const anchor = $derived(anchorIndex >= 0 ? (entries[anchorIndex] ?? null) : null);
  const offsets = $derived((() => {
    const result = new Array<number>(entries.length + 1);
    let acc = 0;
    for (let i = 0; i < entries.length; i += 1) {
      result[i] = acc;
      const height = heights[entries[i]!.id] ?? estimateEntryHeight(entries[i]!);
      acc += height + (i < entries.length - 1 ? ROW_GAP : ROW_BOTTOM_PAD);
    }
    result[entries.length] = acc;
    return result;
  })());

  // payload 更新时回到初始居中流程
  $effect(() => {
    centering = true;
    windowIndices = [0, 0];
  });

  // 渲染行测量
  $effect(() => {
    const vp = viewport;
    if (!vp) return;
    const elements = Array.from(vp.querySelectorAll<HTMLElement>("[data-context-row]"));
    const measured: Record<string, number> = {};
    for (const element of elements) {
      const id = element.dataset.contextRow;
      if (id) measured[id] = element.getBoundingClientRect().height;
    }
    heights = mergeMeasured(heights, measured);
    const observer = new ResizeObserver((list) => {
      const live: Record<string, number> = {};
      for (const entry of list) {
        const id = (entry.target as HTMLElement).dataset.contextRow;
        if (id) live[id] = entry.target.getBoundingClientRect().height;
      }
      heights = mergeMeasured(heights, live);
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  });

  // 初始居中：先按估算定位并展开锚点切片，再按实测精确定位
  $effect(() => {
    if (!centering) return;
    const vp = viewport;
    if (!vp || anchorIndex < 0 || !anchor) return;
    const contentHeight = Math.max(0, vp.clientHeight - VIEWPORT_PAD_Y);
    if (!anchorElement) {
      const target = centerTarget(anchorIndex, offsets, heights[anchor.id] ?? estimateEntryHeight(anchor), contentHeight);
      vp.scrollTop = target;
      const start = Math.max(0, anchorIndex - ANCHOR_SLICE_EXTENT);
      const end = Math.min(entries.length, anchorIndex + ANCHOR_SLICE_EXTENT + 1);
      windowIndices = [start, end];
    } else {
      centering = false;
      centerAnchorDom(vp, anchorElement, false);
      const next = windowFromScroll(vp.scrollTop, offsets, contentHeight);
      windowIndices = [next[0], next[1]];
    }
  });

  function handleScroll(): void {
    if (centering) return;
    const vp = viewport;
    if (!vp) return;
    const contentHeight = Math.max(0, vp.clientHeight - VIEWPORT_PAD_Y);
    const [start, end] = windowFromScroll(vp.scrollTop, offsets, contentHeight);
    if (windowIndices[0] !== start || windowIndices[1] !== end) {
      windowIndices = [start, end];
    }
  }

  function scrollToAnchor(): void {
    const vp = viewport;
    if (!vp) return;
    if (anchorElement) {
      centerAnchorDom(vp, anchorElement, true);
      const contentHeight = Math.max(0, vp.clientHeight - VIEWPORT_PAD_Y);
      const [start, end] = windowFromScroll(vp.scrollTop, offsets, contentHeight);
      if (windowIndices[0] !== start || windowIndices[1] !== end) windowIndices = [start, end];
      return;
    }
    centering = true;
    const start = Math.max(0, anchorIndex - ANCHOR_SLICE_EXTENT);
    const end = Math.min(entries.length, anchorIndex + ANCHOR_SLICE_EXTENT + 1);
    windowIndices = [start, end];
  }

  const start = $derived(windowIndices[0]);
  const end = $derived(windowIndices[1]);
  const slice = $derived(entries.slice(start, end));
  const spacerTop = $derived(offsets[start] ?? 0);
  const spacerBottom = $derived((offsets[entries.length] ?? 0) - (offsets[end] ?? 0));
</script>

<div class="relative flex min-h-0 flex-1 flex-col">
  <div
    bind:this={viewport}
    onscroll={handleScroll}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5"
  >
    <div style="height: {spacerTop}px" aria-hidden="true"></div>
    <div class="flex flex-col gap-4 pb-2">
      {#each slice as entry (entry.id)}
        {@const row =
          entry.rows.length > 1
            ? { ...representativeRow(entry.rows), media_items: mergeAlbumMedia(entry.rows) }
            : (entry.rows[0]!)}
        {#if entry.anchor}
          <Marker variant="separator">当前消息</Marker>
          <div bind:this={anchorElement} data-context-row={entry.id}>
            <Message align="end">
              <MessageContent>
                <MessageHeader class="flex-wrap gap-x-2 gap-y-0.5">
                  <span class="font-medium text-foreground">{formatSender(row)}</span>
                  <span class="font-mono">{formatMessageDate(row.date)}</span>
                  <Badge variant="secondary" class="text-[11px]">
                    {#if entry.rows.length > 1}
                      相册 {entry.rows.length}
                    {:else}
                      {messageTypeLabel(row.message_type)}
                    {/if}
                  </Badge>
                  <Badge class="text-[11px]">当前消息</Badge>
                </MessageHeader>
                <Bubble variant="tinted" align="end">
                  <BubbleContent>
                    {#if row.text}
                      <HighlightedText text={row.text} keyword={keyword} />
                    {:else}
                      <span class="text-muted-foreground">（无文本内容）</span>
                    {/if}
                  </BubbleContent>
                </Bubble>
                <MediaGallery row={row} onOpen={onOpenMedia} class="px-1" />
              </MessageContent>
            </Message>
          </div>
        {:else}
          <div data-context-row={entry.id}>
            <Message align="start">
              <MessageContent>
                <MessageHeader class="flex-wrap gap-x-2 gap-y-0.5">
                  <span class="font-medium text-foreground">{formatSender(row)}</span>
                  <span class="font-mono">{formatMessageDate(row.date)}</span>
                  <Badge variant="secondary" class="text-[11px]">
                    {#if entry.rows.length > 1}
                      相册 {entry.rows.length}
                    {:else}
                      {messageTypeLabel(row.message_type)}
                    {/if}
                  </Badge>
                </MessageHeader>
                <Bubble variant="outline" align="start">
                  <BubbleContent>
                    {#if row.text}
                      <HighlightedText text={row.text} keyword={keyword} />
                    {:else}
                      <span class="text-muted-foreground">（无文本内容）</span>
                    {/if}
                  </BubbleContent>
                </Bubble>
                <MediaGallery row={row} onOpen={onOpenMedia} class="px-1" />
              </MessageContent>
            </Message>
          </div>
        {/if}
      {/each}
    </div>
    <div style="height: {spacerBottom}px" aria-hidden="true"></div>
  </div>
  <div class="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
    <Button size="sm" variant="secondary" class="pointer-events-auto" onclick={scrollToAnchor}>
      <Crosshair class="size-4" aria-hidden="true" />
      回到当前消息
    </Button>
  </div>
</div>