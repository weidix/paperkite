<script lang="ts">
  import "../app.css";
  import { X } from "lucide-svelte";
  import BlockwordsDialog from "$lib/components/blockwords-dialog.svelte";
  import ChatsRail from "$lib/components/chats-rail.svelte";
  import Lightbox from "$lib/components/lightbox.svelte";
  import Topbar from "$lib/components/topbar.svelte";
  import MessageView from "$lib/views/message-view.svelte";
  import SearchView from "$lib/views/search-view.svelte";
  import {
    backToSearch,
    blockwordsOpen,
    chats,
    closeBlockwords,
    closeLightbox,
    initRouter,
    lightbox,
    navigate,
    requestSearchFocus,
    themeStore,
    viewStore
  } from "$lib/state.svelte";
  import { fmtCount } from "$lib/format";

  let railOpen = $state(false);

  $effect(() => initRouter());

  $effect(() => {
    document.documentElement.classList.toggle("dark", themeStore.value === "dark");
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null
        && (target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target instanceof HTMLSelectElement
          || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        if (viewStore.current.kind === "message") navigate(backToSearch());
        requestSearchFocus();
      }
      if (event.key === "Escape") {
        if (blockwordsOpen.open) {
          closeBlockwords();
        } else if (lightbox.open) {
          closeLightbox();
        } else if (viewStore.current.kind === "message") {
          navigate(backToSearch());
        }
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
</script>

<svelte:head>
  <title>{viewStore.current.kind === "message" ? `消息 #${viewStore.current.rowId} · 归档台` : "归档台 · 纸鸢"}</title>
</svelte:head>

<div class="relative flex h-dvh overflow-hidden bg-background text-foreground">
  <!-- 顶部点阵装饰 -->
  <div class="dot-mask pointer-events-none absolute inset-x-0 top-0 z-0 h-40 opacity-60" aria-hidden="true"></div>

  <aside class="relative z-10 hidden w-56 shrink-0 flex-col gap-6 border-r bg-card/60 p-3 md:flex">
    <div class="flex items-center gap-2.5 px-2 py-1">
      <span class="brand-mark flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <span class="block size-3 rotate-45 rounded-[3px] border-2 border-primary-foreground" aria-hidden="true"></span>
      </span>
      <div class="flex flex-col leading-tight">
        <span class="font-display text-sm font-semibold tracking-tight">归档台</span>
        <span class="font-mono text-[11px] text-muted-foreground">archive.console_web</span>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <ChatsRail />
    </div>

    <div class="px-2">
      <p class="font-mono text-[11px] text-muted-foreground">{fmtCount(chats.items.length)} 个会话已归档</p>
    </div>
  </aside>

  <div class="relative z-10 flex min-w-0 flex-1 flex-col">
    <Topbar bind:railOpen />
    <main class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-5xl px-6 py-6">
        {#if viewStore.current.kind === "message"}
          <MessageView rowId={viewStore.current.rowId} />
        {:else}
          <SearchView />
        {/if}
      </div>
    </main>
  </div>

  {#if railOpen}
    <div class="fixed inset-0 z-30 md:hidden" role="presentation">
      <button
        type="button"
        class="absolute inset-0 animate-fade-in cursor-default bg-background/70 backdrop-blur-sm"
        aria-label="关闭会话清单"
        onclick={() => (railOpen = false)}
      ></button>
      <aside class="absolute inset-y-0 left-0 flex w-64 animate-fade-in flex-col border-r bg-card shadow-sm">
        <div class="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div class="flex items-center gap-2.5">
            <span class="brand-mark flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span class="block size-2.5 rotate-45 rounded-[2px] border-2 border-primary-foreground" aria-hidden="true"></span>
            </span>
            <span class="font-display text-sm font-semibold tracking-tight">归档台</span>
          </div>
          <button
            class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="关闭会话清单"
            onclick={() => (railOpen = false)}
          >
            <X class="size-4" aria-hidden="true" />
          </button>
        </div>
        <div class="min-h-0 flex-1 p-3">
          <ChatsRail />
        </div>
      </aside>
    </div>
  {/if}
</div>

<Lightbox />

{#if blockwordsOpen.open}
  <BlockwordsDialog />
{/if}