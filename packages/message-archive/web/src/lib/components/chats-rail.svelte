<script lang="ts">
  import { RefreshCw } from "lucide-svelte";
  import { chats, loadChats, navigate, viewStore } from "$lib/state.svelte";
  import { fmtCount, fmtTs } from "$lib/format";
  import Button from "$lib/components/button.svelte";
  import { cn } from "$lib/utils";

  $effect(() => {
    loadChats();
  });

  const activeChat = $derived(viewStore.current.kind === "search" ? viewStore.current.chat : "");
</script>

<div class="flex h-full min-h-0 flex-col gap-3">
  <div class="flex items-center justify-between px-2">
    <p class="text-xs font-medium tracking-wide text-muted-foreground">会话</p>
    <Button
      variant="ghost"
      size="icon"
      class="size-7"
      aria-label="刷新会话清单"
      disabled={chats.loading}
      onclick={() => loadChats(true)}
    >
      <RefreshCw class={chats.loading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
    </Button>
  </div>
  <nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1" aria-label="会话清单">
    {#if chats.error}
      <div class="px-2 py-2 font-mono text-[11px] leading-4 text-muted-foreground">
        {chats.error}
        <button class="mt-1 block text-foreground underline" onclick={() => loadChats(true)}>重试</button>
      </div>
    {:else if chats.loading && chats.items.length === 0}
      <div class="space-y-1.5 px-1 pt-0.5">
        {#each Array(6) as _, i (i)}
          <div class="h-9 animate-pulse rounded-md bg-muted"></div>
        {/each}
      </div>
    {:else if chats.items.length === 0}
      <p class="px-2 py-2 font-mono text-[11px] leading-4 text-muted-foreground">归档中还没有消息</p>
    {:else}
      {#each chats.items as chat (chat.chatId)}
        <button
          class={cn(
            "group relative flex w-full flex-col rounded-md px-2.5 py-1.5 text-left transition-colors",
            activeChat === chat.chatId
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/60 hover:text-accent-foreground"
          )}
          onclick={() => navigate({ kind: "search", q: "", chat: chat.chatId, from: "", to: "", mode: "include" })}
        >
          {#if activeChat === chat.chatId}
            <span class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true"></span>
          {/if}
          <span class="block truncate text-[13px] font-medium leading-5">
            {chat.title}
            {#if chat.username}
              <span class="font-mono text-[10px] text-muted-foreground/80">@{chat.username}</span>
            {/if}
          </span>
          <span class="block truncate font-mono text-[10px] text-muted-foreground/80">
            {fmtCount(chat.count)} · {fmtTs(chat.lastDate)}
          </span>
        </button>
      {/each}
      {#if chats.capped}
        <p class="px-2 pt-2 font-mono text-[10px] leading-4 text-muted-foreground/70">仅列出最近活跃的会话</p>
      {/if}
    {/if}
  </nav>
</div>