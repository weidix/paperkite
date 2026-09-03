<script lang="ts">
  import "../app.css";
  import { Moon, Sun } from "lucide-svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Toaster from "$lib/toast.svelte";
  import { theme } from "$lib/theme.svelte";

  let { children } = $props();

  $effect(() => {
    document.documentElement.classList.toggle("dark", theme.theme === "dark");
  });
</script>

<svelte:head>
  <title>纸鸢 · 消息检索</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden">
  <header class="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-sm">
    <span class="brand-mark flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <span class="block size-3 rotate-45 rounded-[3px] border-2 border-primary-foreground" aria-hidden="true"></span>
    </span>
    <div class="flex flex-col leading-tight">
      <span class="font-display text-sm font-semibold tracking-tight">纸鸢</span>
      <span class="font-mono text-[11px] text-muted-foreground">archive.console_web</span>
    </div>
    <span class="flex-1"></span>
    <Button variant="ghost" size="sm" onclick={() => theme.toggle()} aria-label="切换主题">
      {#if theme.theme === "dark"}
        <Sun class="size-4" aria-hidden="true" />
      {:else}
        <Moon class="size-4" aria-hidden="true" />
      {/if}
    </Button>
  </header>

  <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="relative">
      <div class="dot-mask pointer-events-none absolute inset-x-0 top-0 z-0 h-40 opacity-60" aria-hidden="true"></div>
      <div class="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {@render children()}
      </div>
    </div>
  </main>
</div>

<Toaster />