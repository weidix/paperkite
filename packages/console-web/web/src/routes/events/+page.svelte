<script lang="ts">
  import { Eraser, Pause, Play, Radio } from "lucide-svelte";
  import { toast } from "$lib/toast-store.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import CollapsibleJson from "$lib/components/ui/collapsible-json.svelte";
  import Select from "$lib/components/ui/select.svelte";
  import { describeEvent } from "$lib/events";
  import { formatDateTime } from "$lib/format";
  import { RUNTIME_EVENT_TYPES } from "$lib/runtime";
  import { runtime } from "$lib/runtime.svelte";
  import type { EventEntry } from "$lib/runtime.svelte";
  import type { RuntimeEvent } from "$lib/runtime";
  import { cn } from "$lib/utils";

  const TONE_VARIANT = { ok: "secondary", bad: "destructive", warn: "outline", info: "outline" } as const;

  let filter = $state("all");
  let paused = $state(false);
  let frozen: readonly EventEntry[] = $state([]);
  let expanded = $state<number | null>(null);
  let clearedThrough = $state(0);

  const events = $derived(runtime.events);
  const source = $derived(paused ? frozen : events);
  const visible = $derived(
    (filter === "all" ? source : source.filter((entry) => entry.event.type === filter)).filter(
      (entry) => entry.seq > clearedThrough
    )
  );
  const filterOptions = $derived([
    { value: "all", label: "全部类型" },
    ...RUNTIME_EVENT_TYPES.map((type) => ({
      value: type,
      label: `${type} (${events.filter((entry) => entry.event.type === type).length})`
    }))
  ]);

  function eventPayload(event: RuntimeEvent): unknown {
    switch (event.type) {
      case "action.started":
        return event.payload === undefined ? undefined : { payload: event.payload };
      case "action.finished":
        return event.error !== undefined || event.effectivePayload !== undefined
          ? { error: event.error, effectivePayload: event.effectivePayload, skipped: event.skipped }
          : undefined;
      case "service.stopped":
        return { reason: event.reason, error: event.error };
      case "config.reloaded":
        return event.error === undefined ? undefined : { error: event.error };
      default:
        return undefined;
    }
  }

  function togglePause(): void {
    if (!paused) frozen = events;
    paused = !paused;
  }

  function clear(): void {
    clearedThrough = Math.max(clearedThrough, ...events.map((entry) => entry.seq), 0);
    expanded = null;
  }

  function toggleExpanded(seq: number): void {
    expanded = expanded === seq ? null : seq;
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    <Select bind:value={filter} options={filterOptions} triggerClass="w-64 font-mono" aria-label="事件类型筛选" />
    {#if paused}
      <Badge variant="outline" class="text-muted-foreground">已暂停</Badge>
    {/if}
    <span class="flex-1"></span>
    <Button variant="outline" size="sm" onclick={togglePause}>
      {#if paused}
        <Play class="size-4" aria-hidden="true" />
        继续
      {:else}
        <Pause class="size-4" aria-hidden="true" />
        暂停
      {/if}
    </Button>
    <Button variant="outline" size="sm" onclick={clear} aria-label="清空事件列表">
      <Eraser class="size-4" aria-hidden="true" />
      清空
    </Button>
  </div>

  {#if visible.length === 0}
    <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-muted">
          <Radio class="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <p class="text-sm font-medium">{paused ? "已暂停接收" : "还没有事件"}</p>
        <p class="max-w-sm text-xs text-muted-foreground">
          {paused ? "点击「继续」恢复实时事件流。" : "动作、服务、定时与配置事件会实时出现在这里。"}
        </p>
      </div>
  {:else}
    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="p-0">
        {#each visible.slice().reverse() as entry (entry.seq)}
          {@const view = describeEvent(entry.event)}
          {@const payload = eventPayload(entry.event)}
          <div class="border-b px-4 py-3 last:border-b-0">
            <button
              type="button"
              class="flex w-full items-center gap-3 text-left"
              onclick={() => toggleExpanded(entry.seq)}
              aria-expanded={expanded === entry.seq}
            >
              <span
                class={cn(
                  "shrink-0 font-mono text-xs tabular-nums",
                  view.tone === "bad" ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {formatDateTime(entry.event.at)}
              </span>
              <Badge variant={TONE_VARIANT[view.tone]}>
                <span class="font-mono">{entry.event.type}</span>
              </Badge>
              <span class="min-w-0 flex-1 truncate text-sm">
                <span class={cn("font-medium", view.tone === "bad" && "text-destructive")}>{view.title}</span>
                {#if view.detail}
                  <span class="ml-2 text-xs text-muted-foreground">{view.detail}</span>
                {/if}
              </span>
            </button>
            {#if expanded === entry.seq}
              <div class="mt-2 flex flex-col gap-2 pl-32">
                <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span class="font-mono tracking-tight">#{entry.seq}</span>
                  {#if "capability" in entry.event}
                    <span class="font-mono tracking-tight">{entry.event.capability}</span>
                  {/if}
                  {#if "flow" in entry.event && entry.event.flow}
                    <span class="font-mono tracking-tight">
                      {entry.event.flow.kind}:{entry.event.flow.id}
                    </span>
                  {/if}
                </div>
                {#if payload !== undefined}
                  <CollapsibleJson value={payload} label="详情" />
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>