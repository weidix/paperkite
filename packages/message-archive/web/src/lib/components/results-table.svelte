<script lang="ts">
  import { Image as ImageIcon, ScrollText, Search as SearchIcon, ChevronLeft, ChevronRight } from "lucide-svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import MediaGallery from "$lib/components/media-gallery.svelte";
  import HighlightedText from "$lib/highlight.svelte";
  import { formatDisplayName, formatMessageDate } from "$lib/format";
  import type { LightboxItem, SearchQuery, SearchRow } from "$lib/types";

  const PAGE_SIZE = 50;

  let {
    query,
    items,
    total,
    page,
    loading,
    error,
    onOpenContext,
    onOpenMedia,
    onPrev,
    onNext
  }: {
    query: SearchQuery | null;
    items: readonly SearchRow[];
    total: number;
    page: number;
    loading: boolean;
    error: string | null;
    onOpenContext: (row: SearchRow) => void;
    onOpenMedia: (item: LightboxItem) => void;
    onPrev: () => void;
    onNext: () => void;
  } = $props();

  const keyword = $derived(query?.keyword ?? "");
  const pageCount = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const meta = $derived(
    loading
      ? "查询中..."
      : query
        ? `共 ${total} 条 · 第 ${page} / ${pageCount} 页 · 本页 ${items.length} 条`
        : "暂无结果"
  );
</script>

<div class="min-w-0 rounded-lg border bg-card text-card-foreground shadow-sm">
  <div class="flex flex-col gap-1.5 p-6">
    <h3 class="font-display text-base font-semibold leading-none tracking-tight">查询结果</h3>
    <p class="text-sm text-muted-foreground">{meta}</p>
  </div>
  <div class="p-6 pt-0">
    {#if error}
      <div role="alert" class="relative w-full rounded-lg border border-destructive/50 px-4 py-3 text-sm text-destructive dark:border-destructive [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-destructive">
        <div class="inline-flex items-center gap-2 font-medium">查询失败</div>
        <div class="text-sm [&_p]:leading-relaxed">{error}</div>
      </div>
    {/if}
    {#if !loading && items.length === 0}
      <div class="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted">
          <SearchIcon class="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <p class="text-sm font-medium">{query ? "没有匹配结果" : "尚未查询"}</p>
        <p class="max-w-sm text-xs text-muted-foreground">
          {query ? "尝试放宽关键词或调整时间范围" : "在左侧填写检索条件后开始查询"}
        </p>
      
      </div>
    {:else}
      <div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">
        <thead class="[&_tr]:border-b">
          <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
            <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">消息内容</th>
            <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-24">上下文</th>
          </tr>
        </thead>
        <tbody class="[&_tr:last-child]:border-0">
          {#if loading && items.length === 0}
            {#each [0, 1, 2, 3, 4] as index (index)}
              <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                  <div class="flex flex-col gap-2 py-1">
                    <div class="animate-pulse rounded-md bg-muted h-4 w-2/3"></div>
                    <div class="animate-pulse rounded-md bg-muted h-3 w-full"></div>
                    <div class="animate-pulse rounded-md bg-muted h-3 w-1/2"></div>
                  </div>
                </td>
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                  <div class="animate-pulse rounded-md bg-muted h-7 w-16"></div>
                </td>
              </tr>
            {/each}
          {:else}
            {#each items as row (row.id)}
              <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 align-top">
                  <div class="flex flex-col gap-2 py-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" class="font-mono text-[11px]">{formatMessageDate(row.date)}</Badge>
                      <Badge variant="secondary" class="max-w-full break-words" title={row.chat_title ?? undefined}>
                        {row.chat_title || "未知群组"}
                      </Badge>
                      {#if row.sender_username}
                        <Badge variant="ghost" class="font-mono text-[11px]">@{row.sender_username}</Badge>
                      {:else}
                        <Badge variant="ghost" class="text-[11px]">{formatDisplayName(row)}</Badge>
                      {/if}
                      {#if row.has_media}
                        <Badge variant="secondary">
                          <ImageIcon class="size-3.5" aria-hidden="true" />
                          媒体
                        </Badge>
                      {/if}
                    </div>
                    <p class="whitespace-pre-wrap text-sm leading-relaxed">
                      <HighlightedText text={row.text} keyword={keyword} />
                    </p>
                    <MediaGallery row={row} onOpen={onOpenMedia} />
                  </div>
                </td>
                <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 align-top">
                  <Button variant="ghost" size="sm" onclick={() => onOpenContext(row)}>
                    <ScrollText class="size-4" aria-hidden="true" />
                    上下文
                  </Button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table></div>
    {/if}
  </div>
  {#if items.length > 0}
    <div class="flex flex-wrap items-center justify-between gap-3 p-6 pt-0">
      <p class="text-xs text-muted-foreground">第 {page} / {pageCount} 页</p>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" onclick={onPrev} disabled={page <= 1 || loading}>
          <ChevronLeft class="size-4" aria-hidden="true" />
          上一页
        </Button>
        <Button variant="outline" size="sm" onclick={onNext} disabled={page >= pageCount || loading}>
          下一页
          <ChevronRight class="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  {/if}
</div>