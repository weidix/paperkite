<script lang="ts">
  import { Check, MessagesSquare, Search, X } from "lucide-svelte";
  import { chats } from "$lib/state.svelte";
  import { chatLabel, fmtCount } from "$lib/format";
  import { cn } from "$lib/utils";
  import type { ChatLedger } from "$lib/api";

  const ALL_CHATS: ChatLedger = { chatId: "", title: "全部会话", count: 0 };

  let {
    value = $bindable([]),
    onchange
  }: {
    /** 已选会话 ID 列表（空 = 全部会话）。 */
    value?: string[];
    /** 选中或清除后调用（父组件 commit 即时重查）。 */
    onchange?: () => void;
  } = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let filter = $state("");
  let highlight = $state(-1);
  let filterEl = $state<HTMLInputElement | null>(null);

  /** 选项列表：「全部会话」置顶（过滤输入存在时隐藏，避免回车误选）。 */
  const options = $derived<ChatLedger[]>(
    filter.trim()
      ? chats.items.filter((item) =>
          (item.title ?? "").toLowerCase().includes(filter.trim().toLowerCase())
          || (item.username ?? "").toLowerCase().includes(filter.trim().toLowerCase())
        )
      : [ALL_CHATS, ...chats.items]
  );

  const allSelected = $derived(chats.items.length > 0
    && chats.items.every((item) => value.includes(item.chatId)));

  const label = $derived(triggerLabel());

  function triggerLabel(): string {
    if (value.length === 0) return "";
    if (value.length === 1) {
      const chat = chats.items.find((item) => item.chatId === value[0]);
      return chat ? chatLabel(chat) : `会话 ${value[0]}`;
    }
    return `${fmtCount(value.length)} 个会话`;
  }

  function selected(id: string): boolean {
    return value.includes(id);
  }

  function toggle(id: string): void {
    value = selected(id) ? value.filter((item) => item !== id) : [...value, id];
    onchange?.();
  }

  function selectAll(): void {
    value = chats.items.map((item) => item.chatId);
    onchange?.();
  }

  function clearAll(): void {
    value = [];
    onchange?.();
  }

  function clear(): void {
    value = [];
    onchange?.();
  }

  $effect(() => {
    if (!open) return;
    highlight = -1;
    filter = "";
    requestAnimationFrame(() => filterEl?.focus());
  });

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        open = false;
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (options.length === 0) return;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        highlight = (highlight + delta + options.length) % options.length;
        return;
      }
      if (event.key === "Enter" && options.length > 0) {
        event.preventDefault();
        const option = options[highlight >= 0 ? highlight : 0];
        if (option !== undefined) choose(option);
      }
    };
    const onDown = (event: PointerEvent): void => {
      if (rootEl !== null && !rootEl.contains(event.target as Node)) open = false;
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
    };
  });

  function choose(option: ChatLedger): void {
    if (option.chatId === "") {
      clearAll();
    } else {
      toggle(option.chatId);
    }
  }
</script>

<div bind:this={rootEl} class="relative shrink-0">
  <button
    type="button"
    class={cn(
      "inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background pl-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      value.length > 0 ? "w-36 pr-8" : "w-36 pr-2",
      value.length > 0 ? "text-foreground" : "text-muted-foreground"
    )}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="会话筛选（多选）"
    onclick={() => (open = !open)}
  >
    <MessagesSquare class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate">{label || "全部会话"}</span>
  </button>
  {#if value.length > 0}
    <button
      type="button"
      class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="清除会话筛选"
      onclick={clear}
    >
      <X class="size-3" aria-hidden="true" />
    </button>
  {/if}

  {#if open}
    <div
      class="absolute right-0 top-full z-30 mt-1.5 flex max-h-80 w-72 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
      role="listbox"
      aria-multiselectable="true"
      aria-label="会话筛选（多选）"
    >
      <div class="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
        <Search class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          bind:this={filterEl}
          bind:value={filter}
          placeholder="过滤会话"
          class="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="过滤会话"
        />
      </div>
      <div class="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span class="font-mono text-[10px] text-muted-foreground">
          {value.length === 0 ? "全部会话" : `已选 ${fmtCount(value.length)} 个`}
        </span>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            class={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors",
              allSelected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70"
            )}
            aria-pressed={allSelected}
            onclick={selectAll}
          >
            全选
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent/70"
            onclick={clearAll}
          >
            清空
          </button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        {#if options.length === 0}
          <p class="px-3 py-2 font-mono text-[11px] text-muted-foreground">没有匹配的会话</p>
        {:else}
          {#each options as option, index (option.chatId)}
            {@const active = option.chatId === "" ? value.length === 0 : selected(option.chatId)}
            <button
              type="button"
              role="option"
              aria-selected={active}
              class={cn(
                "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                index === highlight
                  ? "bg-accent text-accent-foreground"
                  : active ? "bg-accent/50" : "hover:bg-accent/60"
              )}
              onclick={() => choose(option)}
              onpointerenter={() => (highlight = index)}
            >
              <span
                class={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                )}
                aria-hidden="true"
              >
                {#if active}<Check class="size-3" />{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] leading-5">
                  {option.chatId === "" ? "全部会话" : chatLabel(option)}
                  {#if option.username}
                    <span class="font-mono text-[10px] text-muted-foreground/80">@{option.username}</span>
                  {/if}
                </span>
                {#if option.chatId !== ""}
                  <span class="block truncate font-mono text-[10px] text-muted-foreground/80">
                    {fmtCount(option.count)} 条
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>