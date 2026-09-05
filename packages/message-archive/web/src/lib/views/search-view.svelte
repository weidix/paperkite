<script lang="ts">
  import { onDestroy } from "svelte";
  import { Archive, ChevronRight, Clock, Database, MessagesSquare, RefreshCw, Search, X } from "lucide-svelte";
  import { searchMessages, type SearchQuery } from "$lib/api";
  import { dayLabel, fmtCount, fmtTs, truncate } from "$lib/format";
  import { chats, isEmptySearch, loadChats, navigate, pendingSearchFocus, searchCache, searchScroll, viewStore } from "$lib/state.svelte";
  import AlbumRow from "$lib/components/album-row.svelte";
  import Button from "$lib/components/button.svelte";
  import DatePicker from "$lib/components/date-picker.svelte";
  import MessageRow from "$lib/components/message-row.svelte";
  import Select from "$lib/components/select.svelte";
  import type { ArchiveSearchResult, ContextEntry, TimeMode } from "$lib/model";

  const PAGE = 50;
  let generation = 0;

  let q = $state("");
  let chat = $state("");
  let from = $state("");
  let to = $state("");
  let mode = $state<TimeMode>("include");

  let results = $state<ArchiveSearchResult | null>(null);
  let totalAll = $state(0);
  let error = $state("");
  let loading = $state(false);
  let loadingMore = $state(false);

  $effect(() => {
    if (viewStore.current.kind !== "search") return;
    q = viewStore.current.q;
    chat = viewStore.current.chat;
    from = viewStore.current.from;
    to = viewStore.current.to;
    mode = viewStore.current.mode;
  });

  $effect(() => {
    loadChats();
  });

  $effect(() => {
    if (pendingSearchFocus.armed) {
      pendingSearchFocus.armed = false;
      requestAnimationFrame(() => document.getElementById("global-search")?.focus());
    }
  });

  /** 已加载的检索条件：结果写入会触发 effect 重跑，以 key 隔离避免重复请求。 */
  let lastKey = $state("__init__");
  /** 显式提交（按钮/回车/筛选器）强制重新取回，即使条件未变。 */
  let refreshSeq = $state(0);
  let lastRefresh = $state(0);

  $effect(() => {
    if (viewStore.current.kind !== "search") return;
    const key = isEmptySearch(viewStore.current) ? "" : queryKey();
    if (key === lastKey && refreshSeq === lastRefresh) return;
    lastKey = key;
    lastRefresh = refreshSeq;
    load();
  });

  const home = $derived(isEmptySearch(viewStore.current));
  const days = $derived(groupByDay(results?.items ?? []));
  const terms = $derived(viewStore.current.kind === "search"
    ? viewStore.current.q.trim().split(/\s+/).filter(Boolean)
    : []);

  $effect(() => {
    if (!results || results.items.length === 0) return;
    const key = queryKey();
    if (searchScroll.key === key && searchScroll.top > 0) {
      const top = searchScroll.top;
      searchScroll.key = "";
      requestAnimationFrame(() => document.querySelector("main")?.scrollTo({ top }));
    }
  });

  onDestroy(() => {
    searchScroll.key = localKey();
    searchScroll.top = (document.querySelector("main")?.scrollTop ?? 0);
  });

  function load(): void {
    const token = ++generation;
    const key = queryKey();
    if (!home && results === null && searchCache.results !== null && searchCache.key === key) {
      results = searchCache.results;
      totalAll = searchCache.results.totalMessages;
      return;
    }
    loading = true;
    error = "";
    searchMessages({ ...currentQuery(), limit: home ? 1 : PAGE })
      .then((res) => {
        if (token !== generation) return;
        totalAll = res.totalMessages;
        results = home ? null : res;
        if (!home) {
          searchCache.key = key;
          searchCache.results = res;
        }
      })
      .catch((e: unknown) => {
        if (token === generation) error = messageOf(e);
      })
      .finally(() => {
        if (token === generation) loading = false;
      });
  }

  async function loadMore(): Promise<void> {
    if (!results || loadingMore) return;
    loadingMore = true;
    error = "";
    const token = generation;
    try {
      const res = await searchMessages({ ...currentQuery(), limit: PAGE, offset: results.items.length });
      if (token !== generation) return;
      const merged: ArchiveSearchResult = { ...res, items: [...results.items, ...res.items] };
      results = merged;
      const key = queryKey();
      if (searchCache.results !== null && searchCache.key === key) {
        searchCache.key = key;
        searchCache.results = merged;
      }
    } catch (e) {
      if (token === generation) error = messageOf(e);
    } finally {
      if (token === generation) loadingMore = false;
    }
  }

  function submit(): void {
    navigate({ kind: "search", q: q.trim(), chat: chat.trim(), from, to, mode });
    refreshSeq += 1;
  }

  function clearFilters(): void {
    q = "";
    chat = "";
    from = "";
    to = "";
    mode = "include";
    submit();
  }

  function currentQuery(): SearchQuery {
    if (viewStore.current.kind !== "search") return {};
    return {
      q: viewStore.current.q || undefined,
      chat: viewStore.current.chat || undefined,
      from: isoDate(viewStore.current.from, false),
      to: isoDate(viewStore.current.to, true),
      mode: viewStore.current.mode
    };
  }

  /** 检索条件标识：与 currentQuery 的取值一一对应，用于结果缓存与滚动恢复。 */
  function queryKey(): string {
    const query = currentQuery();
    return JSON.stringify([query.q ?? "", query.chat ?? "", query.from ?? "", query.to ?? "", query.mode]);
  }

  /** 卸载瞬间的检索条件标识（此时 URL 可能已切走，取本地同步值）。 */
  function localKey(): string {
    return JSON.stringify([q.trim(), chat.trim(), isoDate(from, false) ?? "", isoDate(to, true) ?? "", mode]);
  }

  /** 本地日期时间字符串（YYYY-MM-DD[ HH:mm[:ss]]）转为 UTC ISO；止点补 999ms 以包含该秒。 */
  function isoDate(value: string, endOfDay: boolean): string | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
    if (!match) return undefined;
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
      endOfDay ? 999 : 0
    );
    return date.toISOString();
  }

  function groupByDay(items: readonly ContextEntry[]): { label: string; items: ContextEntry[] }[] {
    const groups: { label: string; items: ContextEntry[] }[] = [];
    for (const item of items) {
      const label = dayLabel(entryDate(item));
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    }
    return groups;
  }

  function entryDate(entry: ContextEntry): string {
    return entry.kind === "album" ? (entry.rows[0]?.date ?? "") : entry.record.date;
  }

  function entryKey(entry: ContextEntry): string {
    return entry.kind === "album" ? entry.rowId : entry.record.rowId;
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function chatTitle(chatId: string): string {
    return chats.items.find((item) => item.chatId === chatId)?.title ?? chatId;
  }
</script>

<div class="flex flex-col gap-4">
  <div class="sticky top-0 z-10 -mx-6 -mt-6 border-b border-border/60 bg-background/95 px-6 pb-3 pt-6 backdrop-blur-sm">
    <div class="rounded-lg border bg-card p-4 shadow-sm">
    <div class="flex items-center gap-2">
      <Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        id="global-search"
        bind:value={q}
        placeholder="检索归档消息 · / 聚焦"
        class="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        onkeydown={(event) => {
          if (event.key === "Enter" && !event.isComposing) submit();
        }}
        aria-label="检索归档消息"
      />
      <kbd
        class="hidden rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline"
        aria-hidden="true"
        >/</kbd
      >
      {#if q}
        <Button variant="ghost" size="icon" class="size-8" aria-label="清空关键词" onclick={() => (q = "")}>
          <X class="size-4" aria-hidden="true" />
        </Button>
      {/if}
    </div>
    <div class="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
      <label class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span class="w-8 shrink-0">会话</span>
        <Select
          bind:value={chat}
          options={[{ value: "", label: "全部" }, ...chats.items.map((item) => ({
            value: item.chatId,
            label: item.username ? `${item.title} @${item.username}` : item.title
          }))]}
          triggerClass="h-8 min-w-0 flex-1 max-w-80 text-xs"
          contentMinWidth="min(24rem, calc(100vw - 2rem))"
          aria-label="会话筛选"
          onvaluechange={submit}
        />
      </label>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground min-[560px]:w-auto w-full">
          <span class="w-8 shrink-0">从</span>
          <DatePicker
            bind:value={from}
            placeholder="选择日期"
            triggerClass="h-8 min-w-0 flex-1 font-mono text-xs min-[560px]:w-44"
            aria-label="起始日期"
            onvaluechange={() => submit()}
          />
        </label>
        <label class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground min-[560px]:w-auto w-full">
          <span class="w-8 shrink-0">至</span>
          <DatePicker
            bind:value={to}
            placeholder="选择日期"
            triggerClass="h-8 min-w-0 flex-1 font-mono text-xs min-[560px]:w-44"
            aria-label="结束日期"
            onvaluechange={() => submit()}
          />
        </label>
        <div class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground min-[560px]:w-auto w-full">
          <span class="w-8 shrink-0">时间</span>
          <Select
            bind:value={mode}
            options={[
              { value: "include", label: "区间内" },
              { value: "exclude", label: "区间外" },
              { value: "off", label: "忽略时间" }
            ]}
            triggerClass="h-8 min-w-0 flex-1 text-xs min-[560px]:w-36"
            contentMinWidth="10rem"
            aria-label="时间模式"
            onvaluechange={submit}
          />
        </div>
      </div>
      <div class="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" onclick={clearFilters}>清除</Button>
        <Button
          size="sm"
          disabled={loading}
          aria-label="检索归档消息"
          onclick={submit}
        >
          {#if loading}
            <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
            检索中…
          {:else}
            检索
          {/if}
        </Button>
      </div>
    </div>
    </div>
  </div>

  {#if loading && results === null}
    <div class="grid gap-4">
      {#each Array(4) as _, i (i)}
        <div class="h-16 animate-pulse rounded-xl bg-muted"></div>
      {/each}
    </div>
  {:else if error}
    <div class="rounded-lg border bg-card p-6 text-center shadow-sm">
      <p class="font-mono text-xs text-muted-foreground">{error}</p>
      <Button variant="ghost" size="sm" class="mt-3" onclick={load}>重试</Button>
    </div>
  {:else if home}
    <div class="grid gap-4 sm:grid-cols-3">
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <Database class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">已归档消息</p>
            <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{fmtCount(totalAll)}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">全部会话合计</p>
          </div>
        </div>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <MessagesSquare class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">记录中的会话</p>
            <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{fmtCount(chats.items.length)}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {chats.capped ? "仅列示最近活跃的会话" : "活跃会话"}
            </p>
          </div>
        </div>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <Clock class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">最近活跃</p>
            <p class="truncate font-display text-2xl font-semibold tabular-nums tracking-tight">
              {chats.items[0] ? fmtTs(chats.items[0].lastDate) : "-"}
            </p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">{chats.items[0]?.title ?? "等待归档"}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="flex items-center gap-2 border-b px-6 py-4">
        <Archive class="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 class="font-display text-sm font-semibold leading-none tracking-tight">最近会话</h2>
        <span class="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/70">共 {chats.items.length} 个</span>
      </div>
      {#if chats.loading && chats.items.length === 0}
        <div class="grid gap-3 p-6">
          {#each Array(5) as _, i (i)}
            <div class="h-12 animate-pulse rounded-lg bg-muted"></div>
          {/each}
        </div>
      {:else if chats.items.length === 0}
        <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span class="flex size-10 items-center justify-center rounded-full bg-muted">
            <MessagesSquare class="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p class="text-sm font-medium">{chats.error || "归档中还没有消息"}</p>
          <p class="max-w-sm text-xs text-muted-foreground">先运行 archive.sync 归档会话，再回来翻查。</p>
        </div>
      {:else}
        {#each chats.items as chat (chat.chatId)}
          <button
            class="flex w-full items-center gap-3 border-b border-border/50 px-6 py-3 text-left transition-colors last:border-0 hover:bg-accent/50"
            onclick={() => navigate({ kind: "search", q: "", chat: chat.chatId, from: "", to: "", mode: "include" })}
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="truncate text-sm font-medium">{chat.title}</span>
                <span class="shrink-0 font-mono text-[11px] text-muted-foreground/60">{chat.chatId}</span>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted-foreground">{chat.lastText}</p>
            </div>
            <div class="shrink-0 text-right">
              <div class="font-mono text-xs tabular-nums">{fmtCount(chat.count)}</div>
              <div class="font-mono text-[11px] text-muted-foreground">{fmtTs(chat.lastDate)}</div>
            </div>
            <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/each}
      {/if}
    </div>
  {:else if results && results.items.length === 0}
    <div class="rounded-lg border bg-card p-10 text-center shadow-sm">
      <p class="text-sm text-muted-foreground">没有匹配的消息</p>
      <p class="mt-1 font-mono text-[11px] text-muted-foreground/70">调整关键词或筛选条件后重试</p>
      <Button variant="outline" size="sm" class="mt-3" onclick={clearFilters}>清除筛选</Button>
    </div>
  {:else if results}
    <div class="flex items-baseline justify-between px-1 font-mono text-[11px] text-muted-foreground">
      <span>共 {fmtCount(results.total)} 条 · 已加载 {fmtCount(results.items.length)}</span>
      {#if viewStore.current.kind === "search" && viewStore.current.chat}
        <span>仅 {truncate(chatTitle(viewStore.current.chat), 24)}</span>
      {/if}
    </div>
    {#each days as day (day.label)}
      <div class="flex items-center gap-3 px-1 pt-3">
        <span class="font-mono text-[10px] tracking-widest text-muted-foreground">{day.label}</span>
        <span class="h-px flex-1 bg-border/70" aria-hidden="true"></span>
      </div>
      {#each day.items as item (entryKey(item))}
        {#if item.kind === "album"}
          <AlbumRow entry={item} inlineThumb />
        {:else}
          <MessageRow record={item.record} highlights={terms} inlineThumb />
        {/if}
      {/each}
    {/each}
    <div class="mt-3 flex justify-center">
      {#if results.items.length < results.total}
        <Button variant="outline" size="sm" onclick={loadMore} disabled={loadingMore}>
          {loadingMore ? "加载中…" : `加载更多（${fmtCount(results.total - results.items.length)}）`}
        </Button>
      {:else}
        <span class="font-mono text-[10px] text-muted-foreground/70">已全部加载</span>
      {/if}
    </div>
  {/if}
</div>