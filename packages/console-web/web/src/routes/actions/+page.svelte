<script lang="ts">
  import { ArrowRight, List, Play, SlidersHorizontal } from "lucide-svelte";
  import { toast } from "$lib/toast-store.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Label from "$lib/components/ui/label.svelte";
  import Select from "$lib/components/ui/select.svelte";
  import { api } from "$lib/api";
  import { describeEvent } from "$lib/events";
  import { formatClock, parseJson, errorText } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import type { PluginInfo } from "$lib/runtime";
  import { cn } from "$lib/utils";

  let capability = $state("");
  let session = $state("");
  let hook = $state("");
  let configText = $state("");
  let configError = $state<string | null>(null);
  let busy = $state(false);
  let plugins: PluginInfo[] | null = $state(null);
  let pluginsError = $state<string | null>(null);
  let capabilityMode = $state<"pick" | "type">("pick");
  let capabilityInput: HTMLInputElement | null = $state(null);

  const MANUAL_OPTION = "__manual__";

  const EMPTY_PLUGINS: readonly PluginInfo[] = [];

  const events = $derived(runtime.events);
  const recent = $derived(events.filter((entry) => entry.event.type.startsWith("action.")).slice(-8).reverse());

  const capabilities = $derived((() => {
    const names = new Set<string>();
    for (const plugin of plugins ?? EMPTY_PLUGINS) {
      for (const item of plugin.capabilities) {
        if (item.kind === "action") names.add(item.name);
      }
    }
    return [...names].sort();
  })());

  $effect(() => {
    let cancelled = false;
    api
      .plugins()
      .then((items) => {
        if (!cancelled) plugins = items;
      })
      .catch((error: unknown) => {
        if (!cancelled) pluginsError = errorText(error);
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (capabilities.length > 0 && capability !== "" && !capabilities.includes(capability)) {
      capabilityMode = "type";
    }
  });

  $effect(() => {
    if (capability === MANUAL_OPTION) {
      capability = "";
      capabilityMode = "type";
      queueMicrotask(() => capabilityInput?.focus());
    }
  });

  const capabilityOptions = $derived([
    ...capabilities.map((name) => ({ value: name, label: name })),
    { value: MANUAL_OPTION, label: "手动输入能力名…" }
  ]);

  async function run(): Promise<void> {
    const trimmed = capability.trim();
    if (!trimmed) {
      toast.error("需要填写能力名");
      return;
    }
    let config: unknown;
    try {
      config = parseJson(configText);
    } catch {
      configError = "config 不是合法 JSON";
      return;
    }
    busy = true;
    try {
      await api.runAction({
        capability: trimmed,
        session: session.trim() || undefined,
        hook: hook.trim() || undefined,
        config
      });
      toast.success(`已执行 ${trimmed}`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      busy = false;
    }
  }
</script>

<div class="grid gap-4 lg:grid-cols-2">
  <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
    <div class="flex flex-col gap-1.5 px-6 pb-3 pt-6">
      <h3 class="flex items-center gap-2 font-display text-sm font-semibold leading-none tracking-tight">
        <Play class="size-4 text-muted-foreground" aria-hidden="true" />
        执行动作
      </h3>
    </div>
    <div class="flex flex-col gap-4 p-6 pt-0">
      <div role="alert" class="relative w-full rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
        <SlidersHorizontal class="size-4" aria-hidden="true" />
        <div class="inline-flex items-center gap-2 font-medium">临时执行原语</div>
        <div class="text-sm [&_p]:leading-relaxed">
          按能力名 + 配置执行任意动作，结果与事件会出现在事件页。不写入 flows.yml。
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="action-capability">能力 *</Label>
        {#if capabilityMode === "pick"}
          <Select
            id="action-capability"
            bind:value={capability}
            options={capabilityOptions}
            placeholder={plugins ? "选择能力…" : "读取能力清单…"}
            triggerClass="w-full font-mono"
            disabled={!plugins}
          />
        {:else}
          <div class="flex items-center gap-2">
            <input
              bind:this={capabilityInput}
              id="action-capability"
              bind:value={capability}
              class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              placeholder="如 notifications.bark"
              spellcheck={false}
            />
            <Button
              variant="outline"
              size="icon"
              onclick={() => (capabilityMode = "pick")}
              aria-label="从列表选择能力"
              title="从列表选择能力"
              disabled={!plugins}
            >
              <List class="size-4" aria-hidden="true" />
            </Button>
          </div>
        {/if}
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-1.5">
          <Label for="action-session">会话（可选）</Label>
          <input id="action-session" bind:value={session} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" placeholder="会话名" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="action-hook">hook（可选）</Label>
          <input id="action-hook" bind:value={hook} class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" placeholder="hooks/xxx.ts" />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="action-config">config（JSON，可选）</Label>
        <textarea
          id="action-config"
          bind:value={configText}
          oninput={() => (configError = null)}
          class={cn("flex min-h-14 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-28 font-mono text-xs", configError && "border-destructive")}
          placeholder={'{\n  "peer": "@someone",\n  "text": "hello"\n}'}
          spellcheck={false}
        ></textarea>
        {#if configError}
          <p class="text-xs text-destructive">{configError}</p>
        {/if}
      </div>

      <Button onclick={run} disabled={busy} class="self-start">
        <ArrowRight class="size-4" aria-hidden="true" />
        执行
      </Button>
    </div>
  </div>

  <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
    <div class="flex flex-col gap-1.5 px-6 pb-3 pt-6">
      <h3 class="flex items-center gap-2 font-display text-sm font-semibold leading-none tracking-tight">
        最近动作
        <Badge variant="secondary">{recent.length}</Badge>
      </h3>
    </div>
    <div class="p-6 pt-0">
      {#if recent.length === 0}
        <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span class="flex size-10 items-center justify-center rounded-full bg-muted">
            <Play class="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p class="text-sm font-medium">还没有动作事件</p>
          <p class="max-w-sm text-xs text-muted-foreground">执行动作后，开始与结束事件会在这里列出。</p>
        </div>
      {:else}
        <div class="flex flex-col">
          {#each recent as entry (entry.seq)}
            {@const view = describeEvent(entry.event)}
            <div class="flex items-baseline gap-3 border-b py-2 last:border-b-0">
              <span class="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {formatClock(entry.event.at)}
              </span>
              <span class={cn("min-w-0 flex-1 truncate text-sm font-medium", view.tone === "bad" && "text-destructive")}>
                {view.title}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">{view.detail}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if !plugins && !pluginsError}
        <div class="animate-pulse rounded-md bg-muted mt-2 h-4 w-40"></div>
      {/if}
      {#if pluginsError}
        <p class="mt-2 text-xs text-destructive">能力清单读取失败：{pluginsError}</p>
      {/if}
    </div>
  </div>
</div>