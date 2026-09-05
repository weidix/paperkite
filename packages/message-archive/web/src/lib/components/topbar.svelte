<script lang="ts">
  import { Menu, Moon, ShieldBan, Sun } from "lucide-svelte";
  import { openBlockwords, themeStore, toggleTheme, viewStore } from "$lib/state.svelte";
  import { fetchState, type ArchiveState } from "$lib/api";
  import Button from "$lib/components/button.svelte";

  let { railOpen = $bindable(false) } = $props<{ railOpen?: boolean }>();
  let state = $state<ArchiveState | null>(null);

  $effect(() => {
    fetchState().then((value) => (state = value)).catch(() => {});
  });

  const title = $derived(viewStore.current.kind === "message" ? `消息 #${viewStore.current.rowId}` : "检索台");
</script>

<header class="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-sm">
  <Button
    variant="ghost"
    size="icon"
    class="md:hidden"
    aria-label="打开会话清单"
    onclick={() => (railOpen = true)}
  >
    <Menu class="size-4" aria-hidden="true" />
  </Button>
  <div class="flex min-w-0 items-baseline gap-2">
    <span class="font-display text-sm font-semibold tracking-tight">{title}</span>
    <span class="hidden font-mono text-[11px] text-muted-foreground sm:inline">archive.console_web</span>
  </div>
  <div class="ml-auto flex items-center gap-1.5">
    <span class="hidden rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">
      {state?.session ? `会话 ${state.session}` : "未配置会话"}
    </span>
    <span class="hidden rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground md:inline">
      {state?.backend ?? "…"}
    </span>
    <Button
      variant="ghost"
      size="icon"
      aria-label="全局屏蔽词"
      title="全局屏蔽词"
      onclick={openBlockwords}
    >
      <ShieldBan class="size-4" aria-hidden="true" />
    </Button>
    <Button variant="ghost" size="icon" aria-label="切换深浅主题" onclick={toggleTheme}>
      {#if themeStore.value === "dark"}
        <Sun class="size-4" aria-hidden="true" />
      {:else}
        <Moon class="size-4" aria-hidden="true" />
      {/if}
    </Button>
  </div>
</header>