<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import {
    FileText,
    Gauge,
    Menu,
    Moon,
    Puzzle,
    Radio,
    RefreshCw,
    Sun,
    TriangleAlert,
    Users,
    Workflow,
    X,
    Zap
  } from "lucide-svelte";
  import Button from "$lib/components/ui/button.svelte";
  import LiveBadge from "$lib/components/ui/live-badge.svelte";
  import Sheet from "$lib/components/ui/sheet.svelte";
  import Toaster from "$lib/toast.svelte";
  import { api } from "$lib/api";
  import { errorText } from "$lib/format";
  import { toast } from "$lib/toast-store.svelte";
  import { runtime } from "$lib/runtime.svelte";
  import { theme } from "$lib/theme.svelte";
  import { cn } from "$lib/utils";

  interface NavItem {
    value: string;
    label: string;
    icon: new (...args: any[]) => any;
  }

  const NAV: readonly NavItem[] = [
    { value: "/", label: "总览", icon: Gauge },
    { value: "/flows", label: "流程", icon: Workflow },
    { value: "/events", label: "事件", icon: Radio },
    { value: "/actions", label: "动作", icon: Zap },
    { value: "/sessions", label: "会话", icon: Users },
    { value: "/logs", label: "日志", icon: FileText },
    { value: "/plugins", label: "插件", icon: Puzzle }
  ];

  let navOpen = $state(false);
  let dismissedDirty = $state(false);
  let reloading = $state(false);
  let { children } = $props();

  $effect(() => {
    runtime.start();
    return () => runtime.stop();
  });

  $effect(() => {
    document.documentElement.classList.toggle("dark", theme.theme === "dark");
  });

  const current = $derived(NAV.find((item) => item.value === page.url.pathname) ?? NAV[0]!);
  const snapshot = $derived(runtime.snapshot);
  const connected = $derived(runtime.connected);
  const dirtyBanner = $derived(!dismissedDirty && snapshot?.configDirty === true);

  async function reloadConfig(): Promise<void> {
    reloading = true;
    try {
      await api.reloadRuntime();
      await runtime.refresh();
      dismissedDirty = false;
      toast.success(await settledByReload() ? "已按 flows.yml 重新加载" : "重载已受理，配置就绪后横幅消失");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      reloading = false;
    }
  }

  /** 重载接口先应答后执行，此处短轮询等待脏标识归位。 */
  async function settledByReload(): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (runtime.snapshot?.configDirty === false) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await runtime.refresh();
    }
    return runtime.snapshot?.configDirty === false;
  }
</script>

<svelte:head>
  <title>{current.label} · 纸鸢运行控制台</title>
</svelte:head>

<div class="flex h-dvh overflow-hidden">
  <!-- 顶部点阵装饰 -->
  <div class="dot-mask pointer-events-none absolute inset-x-0 top-0 z-0 h-40 opacity-60" aria-hidden="true"></div>

  <aside class="relative z-10 hidden w-56 shrink-0 flex-col gap-6 border-r bg-card/60 p-3 md:flex">
    <div class="flex items-center gap-2.5 px-2 py-1">
      <span class="brand-mark flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <span class="block size-3 rotate-45 rounded-[3px] border-2 border-primary-foreground" aria-hidden="true"></span>
      </span>
      <div class="flex flex-col leading-tight">
        <span class="font-display text-sm font-semibold tracking-tight">纸鸢</span>
        <span class="font-mono text-[11px] text-muted-foreground">runtime.console</span>
      </div>
    </div>

    <nav class="flex flex-col gap-1" aria-label="主导航">
      {#each NAV as item (item.value)}
        {@const Icon = item.icon}
        <a
          href={item.value}
          class={cn(
            "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            current.value === item.value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {#if current.value === item.value}
            <span class="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden="true"></span>
          {/if}
          <Icon class="size-4" aria-hidden="true" />
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="mt-auto px-2">
      <p class="font-mono text-[11px] text-muted-foreground">pid {snapshot?.pid ?? "-"}</p>
    </div>
  </aside>

  <div class="relative z-10 flex min-w-0 flex-1 flex-col">
    <header class="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-sm">
      <Sheet bind:open={navOpen} side="left" contentClass="w-64 sm:max-w-xs">
        {#snippet trigger()}
          <Button variant="ghost" size="sm" class="md:hidden" aria-label="打开导航" onclick={() => (navOpen = true)}>
            <Menu class="size-4" aria-hidden="true" />
          </Button>
        {/snippet}
        <div class="flex h-full flex-col gap-6 p-3">
          <div class="flex items-center gap-2.5 px-2 py-1">
            <span class="brand-mark flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span class="block size-3 rotate-45 rounded-[3px] border-2 border-primary-foreground" aria-hidden="true"></span>
            </span>
            <div class="flex flex-col leading-tight">
              <span class="font-display text-sm font-semibold tracking-tight">纸鸢</span>
              <span class="font-mono text-[11px] text-muted-foreground">runtime.console</span>
            </div>
          </div>
          <nav class="flex flex-col gap-1" aria-label="移动端导航">
            {#each NAV as item (item.value)}
              {@const Icon = item.icon}
              <a
                href={item.value}
                onclick={() => (navOpen = false)}
                class={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  current.value === item.value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon class="size-4" aria-hidden="true" />
                {item.label}
              </a>
            {/each}
          </nav>
        </div>
      </Sheet>

      <h1 class="font-display text-base font-semibold tracking-tight">{current.label}</h1>
      <span class="flex-1"></span>
      <LiveBadge label={snapshot?.running ? "运行中" : "已停止"} tone={snapshot?.running ? "ok" : "bad"} />
      <LiveBadge label={connected ? "已连接" : "重连中"} tone={connected ? "ok" : "bad"} />
      <Button variant="ghost" size="sm" onclick={() => theme.toggle()} aria-label="切换主题">
        {#if theme.theme === "dark"}
          <Sun class="size-4" aria-hidden="true" />
        {:else}
          <Moon class="size-4" aria-hidden="true" />
        {/if}
      </Button>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      {#if dirtyBanner}
        <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <TriangleAlert class="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div class="flex min-w-0 flex-col">
            <span class="text-sm font-medium">flows.yml 已修改，当前运行的是旧配置</span>
            {#if snapshot?.flowsFile}
              <span class="truncate font-mono text-xs text-muted-foreground" title={snapshot.flowsFile}>{snapshot.flowsFile}</span>
            {/if}
          </div>
          <span class="flex-1"></span>
          <Button size="sm" onclick={() => void reloadConfig()} disabled={reloading}>
            <RefreshCw class={cn("size-3.5", reloading && "animate-spin")} aria-hidden="true" />
            立即重载
          </Button>
          <Button variant="ghost" size="icon" class="size-7" onclick={() => (dismissedDirty = true)} aria-label="关闭提示">
            <X class="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      {/if}
      {@render children()}
    </main>
  </div>
</div>

<Toaster />