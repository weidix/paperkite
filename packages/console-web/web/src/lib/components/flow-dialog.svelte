<script lang="ts">
  import { toast } from "$lib/toast-store.svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Dialog from "$lib/components/ui/dialog.svelte";
  import Label from "$lib/components/ui/label.svelte";
  import Separator from "$lib/components/ui/separator.svelte";
  import Switch from "$lib/components/ui/switch.svelte";
  import { api } from "$lib/api";
  import { parseJson, prettyJson, errorText } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import type { FlowKind, FlowPatch, FlowSnapshot } from "$lib/runtime";
  import { cn } from "$lib/utils";

  const KIND_LABEL: Record<FlowKind, string> = {
    trigger: "触发器",
    command: "命令",
    schedule: "定时任务",
    service: "服务"
  };

  const PATCHABLE_FIELDS: Record<FlowKind, readonly string[]> = {
    trigger: ["enabled", "config", "session", "maxRuns", "logFile", "actions"],
    command: ["title", "symbol", "run"],
    schedule: ["enabled", "session", "cron", "intervalSeconds", "logFile", "run"],
    service: ["enabled", "config", "session", "autoStart", "logFile"]
  };

  let {
    flow,
    open = $bindable(false),
    onOpenChange
  }: {
    flow: FlowSnapshot;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = $props();

  let busy = $state(false);
  let enabled = $state(false);
  let session = $state("");
  let title = $state("");
  let symbol = $state("");
  let cron = $state("");
  let intervalSeconds = $state("");
  let autoStart = $state(false);
  let maxRuns = $state("");
  let logFile = $state(false);
  let configText = $state("{}");
  let configError = $state<string | null>(null);
  let prevOpen = $state(false);

  $effect(() => {
    if (open && !prevOpen) {
      enabled = flow.enabled;
      session = flow.session ?? "";
      title = flow.title ?? "";
      symbol = flow.symbol ?? "";
      cron = flow.cron ?? "";
      intervalSeconds = flow.intervalSeconds ? String(flow.intervalSeconds) : "";
      autoStart = flow.autoStart ?? false;
      maxRuns = flow.maxRuns === undefined ? "" : String(flow.maxRuns);
      logFile = flow.logFile;
      configText = prettyJson(flow.config ?? {});
      configError = null;
    }
    prevOpen = open;
  });

  const allowed = $derived(PATCHABLE_FIELDS[flow.kind]);

  async function save(): Promise<void> {
    interface PatchDraft {
      enabled?: boolean;
      config?: unknown;
      session?: string;
      cron?: string;
      intervalSeconds?: number;
      title?: string;
      symbol?: string;
      autoStart?: boolean;
      maxRuns?: number;
      logFile?: boolean;
    }
    const patch: PatchDraft = {};
    if (allowed.includes("enabled")) patch.enabled = enabled;
    if (allowed.includes("session")) patch.session = session.trim() || undefined;
    if (allowed.includes("title")) patch.title = title.trim() || flow.id;
    if (allowed.includes("symbol")) patch.symbol = symbol.trim() || undefined;
    if (allowed.includes("maxRuns")) {
      patch.maxRuns = maxRuns.trim() === "" || maxRuns.trim() === "-1" ? undefined : Number(maxRuns);
      if (patch.maxRuns !== undefined && (!Number.isInteger(patch.maxRuns) || patch.maxRuns <= 0)) {
        configError = "maxRuns 须为正整数或留空";
        return;
      }
    }
    if (allowed.includes("logFile")) patch.logFile = logFile;
    if (allowed.includes("cron")) {
      const value = cron.trim();
      if (value && intervalSeconds.trim()) {
        configError = "cron 与 intervalSeconds 只能保留其一";
        return;
      }
      if (value) patch.cron = value;
    }
    if (allowed.includes("intervalSeconds")) {
      const value = intervalSeconds.trim();
      if (value && cron.trim()) {
        configError = "cron 与 intervalSeconds 只能保留其一";
        return;
      }
      if (value) {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          configError = "intervalSeconds 须为正整数";
          return;
        }
        patch.intervalSeconds = parsed;
      }
    }
    if (allowed.includes("autoStart")) patch.autoStart = autoStart;
    if (allowed.includes("config")) {
      try {
        const parsed = parseJson(configText);
        if (parsed !== undefined) patch.config = parsed;
      } catch {
        configError = "config 不是合法 JSON";
        return;
      }
    }
    busy = true;
    try {
      const result = await api.updateFlow(flow.id, patch as FlowPatch);
      toast.success(result.changed ? "已保存并写回 flows.yml" : "没有变更");
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      busy = false;
    }
  }

  async function reload(): Promise<void> {
    busy = true;
    try {
      await api.reloadFlow(flow.id);
      toast.success("已按最新定义重载");
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      busy = false;
    }
  }

  async function toggleService(): Promise<void> {
    busy = true;
    try {
      if (flow.active) await api.stopService(flow.id);
      else await api.startService(flow.id);
      toast.success(flow.active ? "服务已停止" : "服务已启动");
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open {onOpenChange} contentClass="max-h-[85vh] overflow-y-auto sm:max-w-xl">
  <div class="flex flex-wrap items-center gap-2">
    <Badge>{KIND_LABEL[flow.kind]}</Badge>
    <span class="font-mono tracking-tight text-base">{flow.id}</span>
    {#if flow.active}
      <Badge variant="secondary">运行中</Badge>
    {:else if flow.enabled}
      <Badge variant="outline">已启用</Badge>
    {:else}
      <Badge variant="outline">已停用</Badge>
    {/if}
  </div>
  <p class="text-sm text-muted-foreground">
    能力 <span class="font-mono tracking-tight">{flow.capability}</span>
    {flow.logFile ? " · 记录日志文件" : ""}
  </p>

  <div class="grid grid-cols-2 gap-3">
    {#if allowed.includes("enabled")}
      <div class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <Label for="flow-enabled">启用</Label>
        <Switch id="flow-enabled" bind:checked={enabled} />
      </div>
    {/if}
    {#if allowed.includes("logFile")}
      <div class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <Label for="flow-logfile">写入日志文件</Label>
        <Switch id="flow-logfile" bind:checked={logFile} />
      </div>
    {/if}
    {#if allowed.includes("autoStart")}
      <div class="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <Label for="flow-autostart">随运行时自动启动</Label>
        <Switch id="flow-autostart" bind:checked={autoStart} />
      </div>
    {/if}
    {#if allowed.includes("session")}
      <div class="flex flex-col gap-1.5">
        <Label for="flow-session">会话</Label>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-session" bind:value={session} placeholder="留空则无会话" />
      </div>
    {/if}
    {#if allowed.includes("title")}
      <div class="flex flex-col gap-1.5">
        <Label for="flow-title">标题</Label>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-title" bind:value={title} />
      </div>
    {/if}
    {#if allowed.includes("symbol")}
      <div class="flex flex-col gap-1.5">
        <Label for="flow-symbol">符号</Label>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-symbol" bind:value={symbol} placeholder="可选" />
      </div>
    {/if}
    {#if allowed.includes("maxRuns")}
      <div class="flex flex-col gap-1.5">
        <Label for="flow-maxruns">最多触发次数</Label>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-maxruns" bind:value={maxRuns} placeholder="留空无限制" />
      </div>
    {/if}
    {#if flow.kind === "schedule"}
      <div class="flex flex-col gap-1.5">
        <Label for="flow-cron">cron 表达式</Label>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-cron" bind:value={cron} placeholder="0 8 * * *" />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="flow-interval">间隔（秒）</Label>
        <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-interval" bind:value={intervalSeconds} placeholder="每 N 秒" />
      </div>
    {/if}
  </div>

  {#if allowed.includes("config")}
    <div class="flex flex-col gap-1.5">
      <Label for="flow-config">config（JSON）</Label>
      <textarea
        id="flow-config"
        bind:value={configText}
        class={cn("flex min-h-14 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-28 font-mono text-xs", configError && "border-destructive")}
        spellcheck={false}
      ></textarea>
      {#if configError}
        <p class="text-xs text-destructive">{configError}</p>
      {/if}
    </div>
  {/if}

  {#if flow.kind === "trigger" && flow.actions && flow.actions.length > 0}
    <div class="flex flex-col gap-1.5">
      <Label>动作链</Label>
      <div class="flex flex-col gap-1">
        {#each flow.actions as action, index (index)}
          <div class="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
            <span class="font-mono text-muted-foreground">{index + 1}.</span>
            <span class="font-mono tracking-tight">{action.capability}</span>
            {#if action.session}
              <span class="font-mono text-muted-foreground">{action.session}</span>
            {/if}
            {#if action.hook}
              <Badge variant="outline">hook {action.hook}</Badge>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if flow.kind === "command" || flow.kind === "schedule"}
    <div class="flex flex-col gap-1.5">
      <Label>动作</Label>
      <div class="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs">{flow.capability}</div>
    </div>
  {/if}

  <Separator></Separator>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      {#if flow.kind === "service"}
        <Button variant="outline" onclick={toggleService} disabled={busy}>
          {flow.active ? "停止服务" : "启动服务"}
        </Button>
      {/if}
      <Button variant="outline" onclick={reload} disabled={busy}>重载此条</Button>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="ghost" onclick={() => (open = false)}>关闭</Button>
      <Button onclick={save} disabled={busy || configError !== null}>保存</Button>
    </div>
  </div>
</Dialog>