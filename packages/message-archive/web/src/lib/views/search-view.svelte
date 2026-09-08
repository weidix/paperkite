<script lang="ts">
  import { onDestroy } from "svelte";
  import { MessagesSquare, RefreshCw, Search, UserRound, X } from "lucide-svelte";
  import { searchMessages, searchSenders, type SearchQuery } from "$lib/api";
  import { chatLabel, dayLabel, fmtCount, fmtLocalRange, truncate } from "$lib/format";
  import {
    blockBump,
    chats,
    loadChats,
    navigate,
    pendingSearchFocus,
    rememberSender,
    rememberSenderFromRecord,
    searchCache,
    searchScroll,
    senderLabelOf,
    viewStore,
    type SearchPatch
  } from "$lib/state.svelte";
  import AlbumRow from "$lib/components/album-row.svelte";
  import Button from "$lib/components/button.svelte";
  import ChatPicker from "$lib/components/chat-picker.svelte";
  import DateRange from "$lib/components/date-range.svelte";
  import MessageRow from "$lib/components/message-row.svelte";
  import { cn } from "$lib/utils";
  import type { ArchiveSearchResult, ContextEntry, SenderInfo, TimeMode } from "$lib/model";

  const PAGE = 50;
  let generation = 0;

  let q = $state("");
  let selectedChats = $state<string[]>([]);
  let from = $state("");
  let to = $state("");
  let mode = $state<TimeMode>("include");

  let results = $state<ArchiveSearchResult | null>(null);
  let error = $state("");
  let loading = $state(false);
  let loadingMore = $state(false);

  const view = $derived(viewStore.current.kind === "search" ? viewStore.current : null);

  $effect(() => {
    if (viewStore.current.kind !== "search") return;
    q = viewStore.current.q;
    selectedChats = [...viewStore.current.chats];
    from = viewStore.current.from;
    to = viewStore.current.to;
    mode = viewStore.current.mode;
  });

  let lastChatBump = $state(-1);

  $effect(() => {
    if (blockBump.value !== lastChatBump) {
      lastChatBump = blockBump.value;
      loadChats(true);
      return;
    }
    loadChats();
  });

  $effect(() => {
    if (pendingSearchFocus.armed) {
      pendingSearchFocus.armed = false;
      requestAnimationFrame(() => document.getElementById("global-search")?.focus());
    }
  });

  /** 已加载的检索条件：条件键变化经 effect 自动重查。 */
  let lastKey = $state("__init__");
  /** 显式提交（回车/检索按钮）强制重新取回，即使条件未变。 */
  let refreshSeq = $state(0);
  let lastRefresh = $state(0);
  /** 屏蔽名单变更信号：即使条件未变也重新取回。 */
  let lastBump = $state(-1);

  $effect(() => {
    if (viewStore.current.kind !== "search") return;
    const key = queryKey();
    if (key === lastKey && refreshSeq === lastRefresh && blockBump.value === lastBump) return;
    lastKey = key;
    lastRefresh = refreshSeq;
    lastBump = blockBump.value;
    load();
  });

  const days = $derived(groupByDay(results?.items ?? []));
  const terms = $derived(queryTerms(view?.q ?? ""));

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

  async function load(): Promise<void> {
    const token = ++generation;
    const key = queryKey();
    if (results === null && searchCache.results !== null && searchCache.key === key) {
      results = searchCache.results;
      return;
    }
    loading = true;
    error = "";
    try {
      const res = await searchMessages({ ...currentQuery(), limit: PAGE });
      if (token !== generation) return;
      rememberSenders(res.items);
      results = res;
      searchCache.key = key;
      searchCache.results = res;
    } catch (e) {
      if (token === generation) error = messageOf(e);
    } finally {
      if (token === generation) loading = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (results === null || loadingMore) return;
    loadingMore = true;
    error = "";
    const token = generation;
    try {
      const res = await searchMessages({ ...currentQuery(), limit: PAGE, offset: results.items.length });
      if (token !== generation) return;
      rememberSenders(res.items);
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

  /** 录入条件（查询框/会话/日期）：仅导航，键变化经 effect 自动重查。 */
  function commit(): void {
    const current = view;
    if (current === null) return;
    navigate({
      ...current,
      q: q.trim(),
      chats: [...selectedChats],
      from,
      to,
      mode
    });
  }

  /** 显式提交：条件未变也强制重查。 */
  function submit(): void {
    commit();
    refreshSeq += 1;
  }

  /** 条件 chips 移除统一入口：补丁式导航。 */
  function patchSearch(patch: SearchPatch): void {
    const current = view;
    if (current === null) return;
    navigate({ ...current, ...patch });
  }

  function clearAllChips(): void {
    const current = view;
    if (current === null) return;
    q = "";
    navigate({
      ...current,
      q: "",
      chats: [],
      from: "",
      to: "",
      mode: "include",
      users: [],
      forwardFrom: ""
    });
  }

  function currentQuery(): SearchQuery {
    const current = view;
    if (current === null) return {};
    return {
      q: current.q || undefined,
      chatIds: current.chats.length > 0 ? [...current.chats] : undefined,
      from: isoDate(current.from, false),
      to: isoDate(current.to, true),
      mode: current.mode,
      users: current.users.length > 0 ? current.users : undefined,
      forwardFrom: current.forwardFrom || undefined
    };
  }

  /** 检索条件标识：与 currentQuery 的取值一一对应，用于结果缓存与滚动恢复。 */
  function queryKey(): string {
    const query = currentQuery();
    return JSON.stringify([
      query.q ?? "",
      (query.chatIds ?? []).join(","),
      query.from ?? "",
      query.to ?? "",
      query.mode,
      (query.users ?? []).join(","),
      query.forwardFrom ?? ""
    ]);
  }

  /** 卸载瞬间的检索条件标识（此时 URL 可能已切走，取本地同步值）。 */
  function localKey(): string {
    return JSON.stringify([
      q.trim(),
      selectedChats.join(","),
      isoDate(from, false) ?? "",
      isoDate(to, true) ?? "",
      mode,
      (view?.users ?? []).join(","),
      view?.forwardFrom ?? ""
    ]);
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

  function queryTerms(qValue: string): string[] {
    return qValue.trim().split(/\s+/).filter(Boolean);
  }

  function rememberSenders(items: readonly ContextEntry[]): void {
    for (const item of items) {
      if (item.kind === "message") {
        rememberSenderFromRecord(item.record);
      } else {
        const first = item.rows[0];
        if (first !== undefined) rememberSenderFromRecord(first);
      }
    }
  }

  // ---------- 候选下拉（会话 + 用户） ----------

  interface Candidate {
    readonly kind: "chat" | "user";
    readonly key: string;
    readonly title: string;
    readonly subtitle: string;
    readonly chatId?: string;
    readonly user?: SenderInfo;
  }

  let candidates = $state<Candidate[]>([]);
  let candIndex = $state(-1);
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let userCandidates = $state<SenderInfo[]>([]);

  /** 用户候选：随输入经 /api/senders 解析为具体 senderId。 */
  $effect(() => {
    const term = q.trim();
    if (term === "") {
      userCandidates = [];
      return;
    }
    let cancelled = false;
    searchSenders({ q: term, limit: 5 })
      .then((res) => {
        if (!cancelled) userCandidates = [...res.items];
      })
      .catch(() => {
        if (!cancelled) userCandidates = [];
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const term = q.trim().toLowerCase();
    if (term === "") {
      candidates = [];
      candIndex = -1;
      return;
    }
    const chatMatches: Candidate[] = chats.items
      .filter((item) =>
        (item.title ?? "").toLowerCase().includes(term)
        || (item.username ?? "").toLowerCase().includes(term))
      .slice(0, 5)
      .map((item) => ({
        kind: "chat" as const,
        key: `chat-${item.chatId}`,
        title: chatLabel(item),
        subtitle: item.username ? `@${item.username} · ${fmtCount(item.count)} 条` : `${fmtCount(item.count)} 条`,
        chatId: item.chatId
      }));
    const userMatches: Candidate[] = userCandidates.map((user) => ({
      kind: "user" as const,
      key: `user-${user.senderId}`,
      title: senderLabelOf(user.senderId),
      subtitle: user.username ? `@${user.username}` : `ID ${user.senderId}`,
      user
    }));
    const merged = [...chatMatches, ...userMatches].slice(0, 10);
    candidates = merged;
    candIndex = merged.length > 0 ? 0 : -1;
  });

  /** 选中候选：清空查询框并 commit；会话候选设该会话，用户候选增补 users。 */
  function pickCandidate(candidate: Candidate): void {
    if (candidate.kind === "chat") {
      q = "";
      selectedChats = candidate.chatId ? [candidate.chatId] : [];
      commit();
    } else if (candidate.user !== undefined) {
      rememberSender(candidate.user);
      const current = view;
      if (current === null) return;
      q = "";
      patchSearch({
        users: current.users.includes(candidate.user.senderId)
          ? [...current.users]
          : [...current.users, candidate.user.senderId]
      });
    }
    candidates = [];
    candIndex = -1;
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      if (event.isComposing) return;
      const candidate = candIndex >= 0 ? candidates[candIndex] : undefined;
      if (candidate !== undefined) {
        pickCandidate(candidate);
      } else {
        submit();
      }
      return;
    }
    if (event.key === "Escape") {
      if (candidates.length > 0) {
        candidates = [];
        candIndex = -1;
      } else {
        q = "";
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (candidates.length === 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      candIndex = (candIndex + delta + candidates.length) % candidates.length;
    }
  }

  /** blur 竞态：候选点击先触发 input blur，延时后再清候选。 */
  function onInputBlur(): void {
    if (blurTimer !== undefined) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      candidates = [];
      candIndex = -1;
    }, 150);
  }

  function onInputFocus(): void {
    if (blurTimer !== undefined) {
      clearTimeout(blurTimer);
      blurTimer = undefined;
    }
  }

  // ---------- chips ----------

  const hasChips = $derived(
    view !== null && (
      terms.length > 0
      || view.chats.length > 0
      || (view.from !== "" && view.mode !== "off")
      || (view.to !== "" && view.mode !== "off")
      || view.users.length > 0
      || view.forwardFrom !== ""
      || (view.mode === "exclude" && (view.from !== "" || view.to !== ""))
    )
  );

  const rangeLabel = $derived(fmtLocalRange(view?.from ?? "", view?.to ?? ""));

  function removeTerm(term: string): void {
    patchSearch({ q: terms.filter((item) => item !== term).join(" ") });
  }

  function removeChat(chatId: string): void {
    patchSearch({ chats: (view?.chats ?? []).filter((id) => id !== chatId) });
  }

  function removeRange(): void {
    patchSearch({ from: "", to: "", mode: "include" });
  }

  function removeMode(): void {
    patchSearch({ mode: "include" });
  }

  function removeUser(senderId: string): void {
    patchSearch({ users: (view?.users ?? []).filter((id) => id !== senderId) });
  }

  function removeForward(): void {
    patchSearch({ forwardFrom: "" });
  }

  const emptyTitle = $derived(
    view !== null && view.users.length > 0 && view.chats.length > 0
      ? "该用户在此会话没有消息"
      : view !== null && view.users.length > 0
        ? "没有这些用户的消息"
        : "没有匹配的消息"
  );

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

  function chatTitle(chatId: string): string {
    const item = chats.items.find((chat) => chat.chatId === chatId);
    return item ? chatLabel(item) : "未命名会话";
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<div class="flex flex-col gap-4">
  <div class="sticky top-0 z-10 -mx-6 -mt-6 border-b border-border/60 bg-background/95 px-6 pb-2 pt-4 backdrop-blur-sm">
    <div class="flex items-center gap-2">
      <div class="relative min-w-0 flex-1 basis-60">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="global-search"
          bind:value={q}
          placeholder="检索归档消息 · 空格分隔多个关键词"
          class="h-9 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="检索归档消息"
          onkeydown={onInputKeydown}
          onfocus={onInputFocus}
          onblur={onInputBlur}
        />
        {#if q}
          <button
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="清空关键词"
            onclick={() => (q = "")}
          >
            <X class="size-3.5" aria-hidden="true" />
          </button>
        {/if}
        {#if candidates.length > 0}
          <div class="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
            {#each candidates as candidate, index (candidate.key)}
              <button
                type="button"
                class={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  index === candIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                )}
                onpointerenter={() => (candIndex = index)}
                onclick={() => pickCandidate(candidate)}
              >
                {#if candidate.kind === "chat"}
                  <MessagesSquare class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {:else}
                  <UserRound class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] leading-5">{candidate.title}</span>
                  <span class="block truncate font-mono text-[10px] text-muted-foreground/80">{candidate.subtitle}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <ChatPicker bind:value={selectedChats} onchange={commit} />
      <DateRange bind:from bind:to bind:mode onchange={commit} />
      <Button class="w-20 shrink-0" disabled={loading} aria-label="检索归档消息" onclick={submit}>
        {#if loading}
          <RefreshCw class="size-3.5 animate-spin" aria-hidden="true" />
        {:else}
          <Search class="size-3.5" aria-hidden="true" />
        {/if}
        检索
      </Button>
    </div>

    {#if view !== null && hasChips}
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        {#each terms as term (term)}
          <button
            type="button"
            class="inline-flex h-6 max-w-56 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            onclick={() => removeTerm(term)}
            aria-label={`移除关键词 ${term}`}
          >
            <span class="truncate">{term}</span>
            <X class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/each}
        {#each view.chats as chatId (chatId)}
          <button
            type="button"
            class="inline-flex h-6 max-w-56 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            onclick={() => removeChat(chatId)}
            aria-label={`移除会话条件 ${chatTitle(chatId)}`}
          >
            <MessagesSquare class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="truncate">{truncate(chatTitle(chatId), 24)}</span>
            <X class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/each}
        {#if (view.from !== "" || view.to !== "") && view.mode !== "off"}
          <button
            type="button"
            class="inline-flex h-6 max-w-56 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            onclick={removeRange}
            aria-label="移除时间条件"
          >
            <span class="truncate">{rangeLabel}</span>
            <X class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/if}
        {#if view.mode === "exclude" && (view.from !== "" || view.to !== "")}
          <button
            type="button"
            class="inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            onclick={removeMode}
            aria-label="移除区间外条件"
          >
            区间外
            <X class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/if}
        {#each view.users as senderId (senderId)}
          <button
            type="button"
            class="inline-flex h-6 max-w-56 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            onclick={() => removeUser(senderId)}
            aria-label={`移除用户 ${senderLabelOf(senderId)}`}
          >
            <UserRound class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="truncate">{senderLabelOf(senderId)}</span>
            <X class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/each}
        {#if view.forwardFrom !== ""}
          <button
            type="button"
            class="inline-flex h-6 max-w-56 items-center gap-1 rounded-md bg-muted px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            onclick={removeForward}
            aria-label="移除转发来源条件"
          >
            <span class="truncate">转发：{truncate(view.forwardFrom, 24)}</span>
            <X class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        {/if}
        {#if view.q !== "" || view.chats.length > 0 || view.from !== "" || view.to !== "" || view.users.length > 0 || view.forwardFrom !== "" || view.mode === "exclude"}
          <button
            type="button"
            class="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onclick={clearAllChips}
          >
            清空条件
          </button>
        {/if}
      </div>
    {/if}

    {#if results !== null && results.items.length > 0}
      <div class="mt-1.5 flex items-baseline justify-between gap-3 px-1 font-mono text-[11px] text-muted-foreground">
        <span class="flex min-w-0 flex-wrap items-center gap-2">
          <span>共 {fmtCount(results.total)} 条 · 已加载 {fmtCount(results.items.length)}</span>
          {#if view !== null && view.users.length > 0}
            <span class="rounded-md bg-muted px-1.5 py-0.5">{fmtCount(view.users.length)} 个用户</span>
          {/if}
        </span>
      </div>
    {/if}
  </div>

  {#if loading && results === null}
    <div class="grid gap-4">
      {#each Array(4) as _, i (i)}
        <div class="h-16 animate-pulse rounded-xl bg-muted"></div>
      {/each}
    </div>
  {:else if error && results === null}
    <div class="rounded-lg border bg-card p-6 text-center shadow-sm">
      <p class="font-mono text-xs text-muted-foreground">{error}</p>
      <Button variant="ghost" size="sm" class="mt-3" onclick={load}>重试</Button>
    </div>
  {:else if results === null}
    <div class="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <p class="text-sm font-medium">正在载入归档消息…</p>
    </div>
  {:else if results.items.length === 0}
    <div class="rounded-lg border bg-card p-10 text-center shadow-sm">
      <p class="text-sm font-medium">{emptyTitle}</p>
      <p class="mt-1 font-mono text-[11px] text-muted-foreground/70">调整关键词或筛选条件后重试</p>
      <Button variant="outline" size="sm" class="mt-3" onclick={clearAllChips}>清除筛选</Button>
    </div>
  {:else}
    {#if error}
      <div class="rounded-lg border bg-card p-4 text-center shadow-sm">
        <p class="font-mono text-xs text-muted-foreground">{error}</p>
        <Button variant="ghost" size="sm" class="mt-2" onclick={load}>重试</Button>
      </div>
    {/if}
    <div class="transition-opacity {loading ? 'opacity-60' : ''}">
      {#each days as day (day.label)}
        <div class="flex items-center gap-3 px-1 pt-3">
          <span class="font-mono text-[10px] tracking-widest text-muted-foreground">{day.label}</span>
          <span class="h-px flex-1 bg-border/70" aria-hidden="true"></span>
        </div>
        {#each day.items as item (entryKey(item))}
          {#if item.kind === "album"}
            <AlbumRow entry={item} highlights={terms} inlineThumb showChat={view !== null && view.chats.length === 0} />
          {:else}
            <MessageRow record={item.record} highlights={terms} inlineThumb showChat={view !== null && view.chats.length === 0} />
          {/if}
        {/each}
      {/each}
    </div>
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