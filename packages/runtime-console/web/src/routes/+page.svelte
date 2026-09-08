<script lang="ts">
  import {
    Activity,
    CalendarClock,
    Cpu,
    FileClock,
    Package,
    Play,
    RotateCcw,
    Zap
  } from "lucide-svelte";
  import { AlertDialog } from "bits-ui";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import LiveBadge from "$lib/components/ui/live-badge.svelte";
  import Status from "$lib/components/ui/status.svelte";
  import { api } from "$lib/api";
  import { describeEvent } from "$lib/events";
  import { formatClock, formatUptime, errorText } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import { toast } from "$lib/toast-store.svelte";
  import type { PluginInfo } from "$lib/runtime";
  import { cn } from "$lib/utils";

  const AlertDialogRoot = AlertDialog.Root;
  const AlertDialogTrigger = AlertDialog.Trigger;
  const AlertDialogPortal = AlertDialog.Portal;
  const AlertDialogOverlay = AlertDialog.Overlay;
  const AlertDialogContent = AlertDialog.Content;
  const AlertDialogTitle = AlertDialog.Title;
  const AlertDialogDescription = AlertDialog.Description;
  const AlertDialogAction = AlertDialog.Action;
  const AlertDialogCancel = AlertDialog.Cancel;

  let now = $state(Date.now());
  let reloading = $state(false);
  let plugins: PluginInfo[] | null = $state(null);

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    let cancelled = false;
    api
      .plugins()
      .then((items) => {
        if (!cancelled) plugins = items;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });

  const snapshot = $derived(runtime.snapshot);
  const connected = $derived(runtime.connected);
  const events = $derived(runtime.events);
  const uptime = $derived(
    snapshot?.running ? Math.floor(snapshot.uptimeSeconds + (now - runtime.snapshotAt) / 1_000) : 0
  );
  const activeActions = $derived(snapshot?.activeActions ?? []);
  const flows = $derived(snapshot?.flows ?? []);

  const atomBars = $derived([
    { label: "触发器", count: snapshot?.triggers.length ?? 0, weight: "bg-foreground" },
    { label: "定时任务", count: snapshot?.schedules.length ?? 0, weight: "bg-chart-3" },
    { label: "服务", count: snapshot?.services.length ?? 0, weight: "bg-muted-foreground" }
  ]);
  const atomTotal = $derived(atomBars.reduce((sum, item) => sum + item.count, 0));

  async function reloadRuntime(): Promise<void> {
    reloading = true;
    try {
      await api.reloadRuntime();
      toast.success("重载已受理，稍后生效");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      reloading = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
    <div class="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
      <div class="flex items-center gap-4">
        <span
          class={cn(
            "flex size-11 items-center justify-center rounded-xl border",
            snapshot?.running ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          <Cpu class="size-5" aria-hidden="true" />
        </span>
        <div>
          <div class="flex items-center gap-2">
            <p class="font-display text-lg font-semibold tracking-tight">
              {snapshot ? (snapshot.running ? "运行时运行中" : "运行时已停止") : "读取运行状态…"}
            </p>
            {#if snapshot?.running}
              <Status tone="ok" pulse></Status>
            {/if}
          </div>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted-foreground">
            <span>pid {snapshot?.pid ?? "-"}</span>
            <span aria-hidden="true" class="mid-dot"></span>
            <span>已运行 <span class="tabular-nums">{snapshot ? formatUptime(uptime) : "-"}</span></span>
            <span aria-hidden="true" class="mid-dot"></span>
            <span>{connected ? "事件流已连接" : "事件流重连中"}</span>
          </p>
        </div>
      </div>

      <AlertDialogRoot>
        <AlertDialogTrigger
          class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          disabled={reloading}
        >
          <RotateCcw class={cn("size-4", reloading && "animate-spin")} aria-hidden="true" />
          重载配置
        </AlertDialogTrigger>
        <AlertDialogPortal>
          <AlertDialogOverlay
            class="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          />
          <AlertDialogContent
            class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2"
          >
            <AlertDialogTitle class="font-display text-lg font-semibold leading-none">重载全部配置？</AlertDialogTitle>
            <AlertDialogDescription class="text-sm text-muted-foreground">
              运行时将停止现有流、重读 flows.yml 并按新配置重启，进程与会话池不会退出。
            </AlertDialogDescription>
            <div class="flex justify-end gap-2">
              <AlertDialogCancel
                class="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => void reloadRuntime()}
              >
                重载
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialogRoot>
    </div>
  </div>

  {#if snapshot}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <Zap class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">触发器</p>
            <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{snapshot.triggers.length}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {flows.filter((flow) => flow.kind === "trigger" && flow.active).length} 个活跃
            </p>
          </div>
        </div>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <CalendarClock class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">定时任务</p>
            <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{snapshot.schedules.length}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {flows
                .filter((flow) => flow.kind === "schedule")
                .map((flow) => flow.cron ?? `每 ${flow.intervalSeconds}s`)
                .slice(0, 3)
                .join("、") || "无"}
            </p>
          </div>
        </div>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <Play class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">服务</p>
            <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">{snapshot.services.length}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">{snapshot.activeServices.length} 个运行中</p>
          </div>
        </div>
      </div>
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="flex items-start gap-3 px-6 py-4">
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
            <Package class="size-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium tracking-wide text-muted-foreground">插件</p>
            <p class="font-display text-2xl font-semibold tabular-nums tracking-tight">
              {plugins ? String(plugins.length) : "-"}
            </p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {plugins ? `${plugins.filter((plugin) => plugin.loaded).length} 个加载` : "读取中…"}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="flex flex-col gap-3 px-6 py-4">
        <div class="flex items-baseline justify-between">
          <p class="text-xs font-medium tracking-wide text-muted-foreground">运行时构成</p>
          <p class="font-mono text-[11px] tabular-nums text-muted-foreground/70">共 {flows.length} 条流程</p>
        </div>
        <div class="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
          {#each atomBars as bar (bar.label)}
            {#if bar.count > 0}
              <div
                class="{bar.weight} h-full transition-all duration-300"
                style="width: {atomTotal > 0 ? (bar.count / atomTotal) * 100 : 0}%"
                title="{bar.label} × {bar.count}"></div>
            {/if}
          {/each}
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1">
          {#each atomBars as bar (bar.label)}
            <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span class="inline-block size-2 rounded-full {bar.weight}" aria-hidden="true"></span>
              {bar.label}
              <span class="font-mono tabular-nums text-foreground">{bar.count}</span>
            </span>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {#each [0, 1, 2, 3] as index (index)}
        <div class="h-24 animate-pulse rounded-xl bg-muted"></div>
      {/each}
    </div>
  {/if}

  <div class="grid gap-4 lg:grid-cols-2">
    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="flex flex-col gap-1.5 px-6 pb-2 pt-6">
        <h3 class="flex items-center gap-2 font-display text-sm font-semibold leading-none tracking-tight">
          <Activity class="size-4 text-muted-foreground" aria-hidden="true" />
          正在执行的动作
          {#if activeActions.length > 0}
            <Badge variant="secondary">{activeActions.length}</Badge>
          {/if}
        </h3>
      </div>
      <div class="p-6 pt-0">
        {#if activeActions.length === 0}
          <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <span class="flex size-10 items-center justify-center rounded-full bg-muted">
              <FileClock class="size-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <p class="text-sm font-medium">当前没有执行中的动作</p>
            <p class="max-w-sm text-xs text-muted-foreground">
              动作开始与结束时，实时事件会出现在这里与事件页。
            </p>
          </div>
        {:else}
          <div class="flex flex-col gap-2">
            {#each activeActions as action (action.id)}
              <div class="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                <Status tone="ok" pulse></Status>
                <span class="font-mono text-sm tracking-tight">{action.capability}</span>
                <span class="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                  <span class="font-mono">#{action.id}</span>
                  {#if action.session}
                    <span class="font-mono">{action.session}</span>
                  {/if}
                  <span class="tabular-nums">{formatClock(action.startedAt)}</span>
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="flex items-center justify-between gap-1.5 px-6 pb-2 pt-6">
        <h3 class="flex items-center gap-2 font-display text-sm font-semibold leading-none tracking-tight">
          <Activity class="size-4 text-muted-foreground" aria-hidden="true" />
          实时活动
          <LiveBadge label={connected ? "实时" : "离线"} tone={connected ? "ok" : "bad"} />
        </h3>
        <a href="/events">
          <Button variant="ghost" size="sm">查看全部</Button>
        </a>
      </div>
      <div class="p-6 pt-0">
        {#if events.length === 0}
          <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
            <span class="flex size-10 items-center justify-center rounded-full bg-muted">
              <FileClock class="size-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <p class="text-sm font-medium">等待运行时事件</p>
            <p class="max-w-sm text-xs text-muted-foreground">
              动作、服务、定时与配置事件会实时出现在这里。
            </p>
          </div>
        {:else}
          <div>
            {#each events.slice(-10).reverse() as entry (entry.seq)}
              {@const view = describeEvent(entry.event)}
              <div class="flex items-baseline gap-3 border-b py-2 last:border-b-0">
                <span
                  class={cn(
                    "shrink-0 font-mono text-xs tabular-nums",
                    view.tone === "bad" ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {formatClock(entry.event.at)}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm">
                  <span class={cn("font-medium", view.tone === "bad" && "text-destructive")}>{view.title}</span>
                  {#if view.detail}
                    <span class="ml-2 text-xs text-muted-foreground">{view.detail}</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>