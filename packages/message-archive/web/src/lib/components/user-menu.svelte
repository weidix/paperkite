<script lang="ts">
  import { UserRoundSearch } from "lucide-svelte";
  import { backToSearch, navigate, senderLabelOf, viewStore } from "$lib/state.svelte";
  import type { MessageRecord } from "$lib/model";
  import type { View } from "$lib/state.svelte";
  import { cn } from "$lib/utils";

  let { record } = $props<{ record: MessageRecord }>();

  const senderId = $derived(record.senderId ?? "");

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let style = $state<{ left: number; top: number } | null>(null);

  /** 增补语义：检索页取当前条件，详情页取进入前的检索条件。 */
  function base(): View {
    return viewStore.current.kind === "search" ? viewStore.current : backToSearch();
  }

  const baseSearch = $derived(base());
  const hasChatCondition = $derived(baseSearch.kind === "search" && baseSearch.chats.length > 0);

  $effect(() => {
    if (!open) return;
    const trigger = triggerEl?.getBoundingClientRect();
    const menu = menuEl?.getBoundingClientRect();
    if (!trigger || !menu) return;
    const MENU_W = 240;
    const left = Math.min(Math.max(8, trigger.right - MENU_W), window.innerWidth - MENU_W - 8);
    const below = trigger.bottom + 4;
    const top = below + menu.height > window.innerHeight - 8
      ? Math.max(8, trigger.top - menu.height - 4)
      : below;
    style = { left, top };
  });

  /** 弹层只在自有列内出现：fixed 定位 + 视口左右 clamp，落在行内容之外。 */
  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") open = false;
    };
    const onDown = (event: PointerEvent): void => {
      if (rootEl !== null && !rootEl.contains(event.target as Node)) open = false;
    };
    const onScroll = (): void => {
      open = false;
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    addEventListener("scroll", onScroll, true);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
      removeEventListener("scroll", onScroll, true);
    };
  });

  /** 增补该发送者到 users：去重拼接，其余条件原样保留。 */
  function withSender(view: View & { kind: "search" }): View & { kind: "search" } {
    return {
      ...view,
      users: view.users.includes(senderId) ? [...view.users] : [...view.users, senderId]
    };
  }

  function allMessages(): void {
    const view = baseSearch;
    if (view.kind !== "search" || senderId === "") return;
    navigate({ ...withSender(view), chats: [] });
    open = false;
  }

  function inThisChat(): void {
    const view = baseSearch;
    if (view.kind !== "search" || senderId === "") return;
    navigate({
      ...withSender(view),
      chats: view.chats.length > 0 ? [...view.chats] : (record.chatId ? [record.chatId] : [])
    });
    open = false;
  }
</script>

<div bind:this={rootEl} class="shrink-0">
  <button
    bind:this={triggerEl}
    type="button"
    disabled={senderId === ""}
    class={cn(
      "rounded-md p-1.5 text-muted-foreground opacity-40 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100",
      "disabled:cursor-not-allowed disabled:opacity-20"
    )}
    aria-label={senderId ? `用户 ${senderLabelOf(senderId)} 的操作` : "该消息没有发送者"}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <UserRoundSearch class="size-3.5" aria-hidden="true" />
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      class="fixed z-40 w-60 rounded-md border bg-popover p-1.5 text-popover-foreground shadow-md"
      style="left: {style?.left ?? -9999}px; top: {style?.top ?? -9999}px"
      role="menu"
      aria-label={`用户 ${senderLabelOf(senderId)} 的操作`}
    >
      <button
        type="button"
        role="menuitem"
        class="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
        onclick={allMessages}
      >
        <span class="text-sm font-medium">此用户全部消息</span>
        {#if hasChatCondition}
          <span class="font-mono text-[10px] text-muted-foreground">增补条件 · 不限会话</span>
        {/if}
      </button>
      <button
        type="button"
        role="menuitem"
        class="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent"
        onclick={inThisChat}
      >
        <span class="text-sm font-medium">此用户在当前会话的消息</span>
        <span class="truncate font-mono text-[10px] text-muted-foreground">
          {record.chatTitle || "本会话"}
        </span>
      </button>
    </div>
  {/if}
</div>