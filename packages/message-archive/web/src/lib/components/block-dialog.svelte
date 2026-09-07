<script lang="ts">
  import { UserX, X } from "lucide-svelte";
  import {
    ApiError,
    addBlockedUser,
    addBlockword,
    fetchBlockedUsers,
    fetchBlockwords,
    removeBlockedUser,
    removeBlockword,
    type BlockedUserState,
    type BlockwordState
  } from "$lib/api";
  import Button from "$lib/components/button.svelte";
  import { closeBlocks } from "$lib/state.svelte";

  type Tab = "words" | "users";

  let snapshot = $state<BlockwordState | null>(null);
  let userSnapshot = $state<BlockedUserState | null>(null);
  let tab = $state<Tab>("words");
  let input = $state("");
  let userInput = $state("");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    fetchBlockwords()
      .then((value) => (snapshot = value))
      .catch((cause) => (error = messageOf(cause)));
  });

  $effect(() => {
    fetchBlockedUsers()
      .then((value) => (userSnapshot = value))
      .catch((cause) => (error = messageOf(cause)));
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeBlocks();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  async function add(): Promise<void> {
    const word = input.trim();
    if (!word || busy) return;
    busy = true;
    error = "";
    try {
      snapshot = await addBlockword(word);
      input = "";
    } catch (cause) {
      error = messageOf(cause);
    } finally {
      busy = false;
    }
  }

  async function remove(word: string): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      snapshot = await removeBlockword(word);
    } catch (cause) {
      error = messageOf(cause);
    } finally {
      busy = false;
    }
  }

  async function addUser(): Promise<void> {
    const userId = userInput.trim();
    if (!userId || busy) return;
    busy = true;
    error = "";
    try {
      userSnapshot = await addBlockedUser({ userId });
      userInput = "";
    } catch (cause) {
      error = messageOf(cause);
    } finally {
      busy = false;
    }
  }

  async function removeUser(userId: string): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      userSnapshot = await removeBlockedUser(userId);
    } catch (cause) {
      error = messageOf(cause);
    } finally {
      busy = false;
    }
  }

  function userName(user: BlockedUserState["users"][number]): string {
    const display = [user.name, user.username ? `@${user.username}` : ""].filter(Boolean).join(" ");
    return display || user.userId;
  }

  function messageOf(cause: unknown): string {
    if (cause instanceof ApiError) return cause.message;
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<div
  class="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-background/70 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="屏蔽管理"
>
  <button
    type="button"
    tabindex="-1"
    class="absolute inset-0 cursor-default"
    aria-label="关闭屏蔽管理"
    onclick={closeBlocks}
  ></button>
  <div class="relative z-10 flex max-h-[75vh] w-full max-w-md animate-zoom-in flex-col rounded-lg border border-border bg-card shadow-sm">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium leading-5">屏蔽管理</p>
        <p class="truncate font-mono text-[10px] leading-4 text-muted-foreground">
          {snapshot ? `${snapshot.words.length} 词·版本 ${snapshot.version}` : "加载中…"}
          {userSnapshot ? ` · ${userSnapshot.users.length} 用户·版本 ${userSnapshot.version}` : ""}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        aria-label="关闭"
        onclick={closeBlocks}
      >
        <X class="size-4" aria-hidden="true" />
      </Button>
    </div>

    <div class="flex shrink-0 gap-1 border-b px-4 pt-2" role="tablist" aria-label="屏蔽类型">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "words"}
        class="rounded-t-md px-3 py-1.5 font-mono text-xs transition-colors {tab === 'words' ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (tab = "words")}
      >
        屏蔽词
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "users"}
        class="rounded-t-md px-3 py-1.5 font-mono text-xs transition-colors {tab === 'users' ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (tab = "users")}
      >
        屏蔽用户
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {#if tab === "words"}
        <form
          class="flex items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            bind:value={input}
            placeholder="输入要屏蔽的词"
            aria-label="新屏蔽词"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || busy}>添加</Button>
        </form>
        {#if snapshot && snapshot.words.length === 0}
          <p class="py-6 text-center font-mono text-xs text-muted-foreground">暂无屏蔽词</p>
        {:else}
          <ul class="flex flex-wrap gap-1.5">
            {#each snapshot?.words ?? [] as word (word)}
              <li class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1">
                <span class="max-w-56 truncate font-mono text-xs">{word}</span>
                <button
                  type="button"
                  class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={`删除 ${word}`}
                  onclick={() => remove(word)}
                >
                  <X class="size-3" aria-hidden="true" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <form
          class="flex items-center gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            addUser();
          }}
        >
          <input
            bind:value={userInput}
            placeholder="输入发送者 ID（消息菜单可直接添加）"
            aria-label="新屏蔽用户"
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!userInput.trim() || busy}>添加</Button>
        </form>
        {#if userSnapshot && userSnapshot.users.length === 0}
          <p class="py-6 text-center font-mono text-xs text-muted-foreground">暂无屏蔽用户</p>
        {:else}
          <ul class="flex flex-col gap-1.5">
            {#each userSnapshot?.users ?? [] as user (user.userId)}
              <li class="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
                <UserX class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-xs">{userName(user)}</span>
                  <span class="block truncate font-mono text-[10px] text-muted-foreground">
                    ID {user.userId}{#if user.username} · @{user.username}{/if}
                  </span>
                </span>
                <button
                  type="button"
                  class="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={`解除 ${userName(user)}`}
                  onclick={() => removeUser(user.userId)}
                >
                  <X class="size-3" aria-hidden="true" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
      {#if error}
        <p class="font-mono text-[11px] text-destructive">{error}</p>
      {/if}
    </div>
    <p class="shrink-0 border-t px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
      命中的消息会在检索、上下文与聊天清单中整体隐藏，增删即时生效。
    </p>
  </div>
</div>