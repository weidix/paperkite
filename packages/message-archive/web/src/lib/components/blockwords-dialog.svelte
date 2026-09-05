<script lang="ts">
  import { X } from "lucide-svelte";
  import {
    ApiError,
    addBlockword,
    fetchBlockwords,
    removeBlockword,
    type BlockwordState
  } from "$lib/api";
  import Button from "$lib/components/button.svelte";
  import { closeBlockwords } from "$lib/state.svelte";

  let snapshot = $state<BlockwordState | null>(null);
  let input = $state("");
  let busy = $state(false);
  let error = $state("");

  $effect(() => {
    fetchBlockwords()
      .then((value) => (snapshot = value))
      .catch((cause) => (error = messageOf(cause)));
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeBlockwords();
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

  function messageOf(cause: unknown): string {
    if (cause instanceof ApiError) return cause.message;
    return cause instanceof Error ? cause.message : String(cause);
  }
</script>

<div
  class="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-background/70 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="全局屏蔽词"
>
  <button
    type="button"
    tabindex="-1"
    class="absolute inset-0 cursor-default"
    aria-label="关闭屏蔽词"
    onclick={closeBlockwords}
  ></button>
  <div class="relative z-10 flex max-h-[75vh] w-full max-w-md animate-zoom-in flex-col rounded-lg border border-border bg-card shadow-sm">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium leading-5">全局屏蔽词</p>
        <p class="truncate font-mono text-[10px] leading-4 text-muted-foreground">
          {snapshot ? `已屏蔽 ${snapshot.words.length} 词 · 版本 ${snapshot.version}` : "加载中…"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        aria-label="关闭"
        onclick={closeBlockwords}
      >
        <X class="size-4" aria-hidden="true" />
      </Button>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
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
      {#if error}
        <p class="font-mono text-[11px] text-destructive">{error}</p>
      {/if}
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
    </div>
    <p class="shrink-0 border-t px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
      命中的消息会在检索、上下文与聊天清单中整体隐藏，增删词即时生效。
    </p>
  </div>
</div>