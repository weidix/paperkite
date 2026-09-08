<script lang="ts">
  import { Archive, Hash, MessagesSquare, RefreshCw, Search, ShieldBan, UserRound } from "lucide-svelte";
  import { fetchState, type ArchiveState } from "$lib/api";
  import { chatLabel, fmtCount, fmtTs, kindLabel, truncate } from "$lib/format";
  import { chats, emptySearch, loadChats, navigate, openBlocks } from "$lib/state.svelte";
  import Button from "$lib/components/button.svelte";

  let state = $state<ArchiveState | null>(null);
  let stateError = $state("");

  $effect(() => {
    let cancelled = false;
    fetchState()
      .then((value) => {
        if (!cancelled) state = value;
      })
      .catch((error) => {
        if (!cancelled) stateError = error instanceof Error ? error.message : String(error);
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    loadChats();
  });

  const totalMessages = $derived(chats.items.reduce((sum, chat) => sum + chat.count, 0));
  const recent = $derived(
    [...chats.items]
      .sort((left, right) => (right.lastDate ?? "").localeCompare(left.lastDate ?? ""))
      .slice(0, 8)
  );

  function openChat(chatId: string): void {
    navigate({ kind: "search", q: "", chats: [chatId], from: "", to: "", mode: "include", users: [], forwardFrom: "" });
  }
</script>

<div class="flex flex-col gap-4">
  <section class="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card px-6 py-5 shadow-sm">
    <div>
      <h1 class="font-display text-lg font-semibold tracking-tight">归档总览</h1>
      <p class="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
        <span>按 / 快速检索</span>
        <span aria-hidden="true" class="mid-dot"></span>
        <span>{fmtCount(chats.items.length)} 个会话 · {fmtCount(totalMessages)} 条消息</span>
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button onclick={() => navigate(emptySearch())} aria-label="浏览全部归档消息">
        <MessagesSquare class="size-4" aria-hidden="true" />
        全部消息
      </Button>
      <Button variant="outline" onclick={openBlocks} aria-label="打开屏蔽管理">
        <ShieldBan class="size-4" aria-hidden="true" />
        屏蔽管理
      </Button>
    </div>
  </section>

  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <div class="rounded-lg border bg-card px-6 py-4 shadow-sm">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
          <Archive class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium tracking-wide text-muted-foreground">归档消息</p>
          <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{fmtCount(totalMessages)}</p>
        </div>
      </div>
    </div>
    <div class="rounded-lg border bg-card px-6 py-4 shadow-sm">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
          <Hash class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium tracking-wide text-muted-foreground">归档会话</p>
          <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{fmtCount(chats.items.length)}</p>
          <p class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {chats.capped ? "仅列出最近活跃的会话" : ""}
          </p>
        </div>
      </div>
    </div>
    <div class="rounded-lg border bg-card px-6 py-4 shadow-sm">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
          <ShieldBan class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium tracking-wide text-muted-foreground">屏蔽词</p>
          <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">
            {state ? fmtCount(state.blockwords.count) : "…"}
          </p>
          <p class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {stateError || (state ? "命中后整条隐身" : "")}
          </p>
        </div>
      </div>
    </div>
    <div class="rounded-lg border bg-card px-6 py-4 shadow-sm">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
          <UserRound class="size-4" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-medium tracking-wide text-muted-foreground">屏蔽用户</p>
          <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">
            {state ? fmtCount(state.blockedUsers.count) : "…"}
          </p>
          <p class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {stateError || (state ? "名单精确匹配" : "")}
          </p>
        </div>
      </div>
    </div>
  </section>

  <section class="rounded-lg border bg-card shadow-sm">
    <div class="flex items-center justify-between px-6 pb-2 pt-4">
      <p class="text-xs font-medium tracking-wide text-muted-foreground">最近活跃会话</p>
      <button
        type="button"
        class="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-label="刷新会话清单"
        disabled={chats.loading}
        onclick={() => loadChats(true)}
      >
        <RefreshCw class={chats.loading ? "size-3 animate-spin" : "size-3"} aria-hidden="true" />
        刷新
      </button>
    </div>
    <div class="px-3 pb-3">
      {#if chats.error && chats.items.length === 0}
        <div class="px-3 py-8 text-center">
          <p class="font-mono text-xs text-muted-foreground">{chats.error}</p>
          <Button variant="ghost" size="sm" class="mt-3" onclick={() => loadChats(true)}>重试</Button>
        </div>
      {:else if chats.loading && chats.items.length === 0}
        <div class="grid gap-1.5">
          {#each Array(5) as _, i (i)}
            <div class="h-11 animate-pulse rounded-md bg-muted"></div>
          {/each}
        </div>
      {:else if chats.items.length === 0}
        <div class="px-3 py-8 text-center">
          <p class="text-sm font-medium">归档中还没有消息</p>
          <p class="mt-1 font-mono text-[11px] text-muted-foreground/70">archive.sync 落库后这里会出现会话</p>
        </div>
      {:else}
        <div class="grid gap-1.5">
          {#each recent as chat (chat.chatId)}
            <button
              type="button"
              class="group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60"
              onclick={() => openChat(chat.chatId)}
            >
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <span class="truncate text-[13px] font-medium leading-5">{chatLabel(chat)}</span>
                  {#if chat.username}
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground/80">@{chat.username}</span>
                  {/if}
                  <span class="shrink-0 font-mono text-[10px] text-muted-foreground/80">
                    {kindLabel(chat.type, chat.chatId)}
                  </span>
                </span>
                {#if chat.lastText}
                  <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {truncate(chat.lastText.replace(/\s+/g, " "), 64)}
                  </span>
                {/if}
              </span>
              <span class="shrink-0 text-right font-mono text-[10px] leading-4 text-muted-foreground">
                <span class="block tabular-nums">{fmtCount(chat.count)} 条</span>
                <span class="block tabular-nums">{fmtTs(chat.lastDate)}</span>
              </span>
              <Search class="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</div>