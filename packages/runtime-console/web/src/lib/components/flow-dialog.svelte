<script lang="ts">
  import {
    CalendarClock,
    ChevronRight,
    Eye,
    FileClock,
    Pencil,
    Plus,
    Rocket,
    RotateCw,
    Trash2,
    Wand2,
    X,
    Zap
  } from "lucide-svelte";
  import { AlertDialog, Dialog } from "bits-ui";
  import { createDraft, parseDraft, type ActionDraft } from "$lib/action-draft";
  import { toast } from "$lib/toast-store.svelte";
  import ActionEditor from "$lib/components/action-editor.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import CollapsibleJson from "$lib/components/ui/collapsible-json.svelte";
  import JsonEditor from "$lib/components/json-editor.svelte";
  import Label from "$lib/components/ui/label.svelte";
  import Status from "$lib/components/ui/status.svelte";
  import Switch from "$lib/components/ui/switch.svelte";
  import { api } from "$lib/api";
  import { parseJson, prettyJson, tryFormatJson, errorText } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import type { ActionSpecInput, FlowKind, FlowPatch, FlowSnapshot } from "$lib/runtime";
  import { cn } from "$lib/utils";

  const AlertDialogRoot = AlertDialog.Root;
  const AlertDialogPortal = AlertDialog.Portal;
  const AlertDialogOverlay = AlertDialog.Overlay;
  const AlertDialogContent = AlertDialog.Content;
  const AlertDialogTitle = AlertDialog.Title;
  const AlertDialogDescription = AlertDialog.Description;
  const AlertDialogAction = AlertDialog.Action;
  const AlertDialogCancel = AlertDialog.Cancel;

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
  let mode = $state<"edit" | "view">("edit");
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
  let formError = $state<string | null>(null);
  let run: ActionDraft | null = $state(null);
  let actions: ActionDraft[] = $state([]);
  let expanded: boolean[] = $state([]);
  let prevOpen = $state(false);
  let reloadPrompt = $state(false);

  $effect(() => {
    if (open && !prevOpen) {
      mode = "edit";
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
      formError = null;
      if (flow.kind === "command" || flow.kind === "schedule") {
        run = createDraft(flow.capability, flow.actionSession, flow.hook, flow.config);
        actions = [];
        expanded = [];
      } else if (flow.kind === "trigger") {
        run = null;
        actions = (flow.actions ?? []).map((action) =>
          createDraft(action.capability, action.session, action.hook, action.config)
        );
        expanded = actions.map(() => true);
      } else {
        run = null;
        actions = [];
        expanded = [];
      }
    }
    prevOpen = open;
  });

  const allowed = $derived(PATCHABLE_FIELDS[flow.kind]);

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
    run?: ActionSpecInput;
    actions?: ActionSpecInput[];
  }

  function addAction(): void {
    actions = [...actions, createDraft("", undefined, undefined, {})];
    expanded = [...expanded, true];
  }

  function removeAction(index: number): void {
    actions = actions.filter((_, item) => item !== index);
    expanded = expanded.filter((_, item) => item !== index);
  }

  function formatConfig(): void {
    const result = tryFormatJson(configText);
    if (result.error) {
      configError = result.error;
      return;
    }
    configText = result.formatted ?? "";
    configError = null;
  }

  async function save(): Promise<void> {
    const patch: PatchDraft = {};
    if (flow.kind === "command") {
      if (!run) return;
      const result = parseDraft(run);
      if (result.error) {
        formError = result.error;
        return;
      }
      patch.title = title.trim() || flow.id;
      patch.symbol = symbol.trim() || undefined;
      patch.run = result.spec;
    } else if (flow.kind === "schedule") {
      if (!run) return;
      if (cron.trim() && intervalSeconds.trim()) {
        formError = "cron 与 intervalSeconds 只能保留其一";
        return;
      }
      if (intervalSeconds.trim()) {
        const parsed = Number(intervalSeconds);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          formError = "intervalSeconds 须为正整数";
          return;
        }
        patch.intervalSeconds = parsed;
      }
      if (cron.trim()) patch.cron = cron.trim();
      const result = parseDraft(run);
      if (result.error) {
        formError = result.error;
        return;
      }
      patch.enabled = enabled;
      patch.session = session.trim() || undefined;
      patch.logFile = logFile;
      patch.run = result.spec;
    } else if (flow.kind === "trigger") {
      patch.enabled = enabled;
      patch.session = session.trim() || undefined;
      patch.logFile = logFile;
      patch.maxRuns = maxRuns.trim() === "" || maxRuns.trim() === "-1" ? undefined : Number(maxRuns);
      if (patch.maxRuns !== undefined && (!Number.isInteger(patch.maxRuns) || patch.maxRuns <= 0)) {
        formError = "maxRuns 须为正整数或留空";
        return;
      }
      try {
        const parsed = parseJson(configText);
        if (parsed !== undefined) patch.config = parsed;
      } catch {
        configError = "config 不是合法 JSON";
        return;
      }
      const specs: ActionSpecInput[] = [];
      for (const draft of actions) {
        const result = parseDraft(draft);
        if (result.error) {
          formError = `动作 ${specs.length + 1}：${result.error}`;
          return;
        }
        specs.push(result.spec as ActionSpecInput);
      }
      patch.actions = specs;
    } else {
      patch.enabled = enabled;
      patch.session = session.trim() || undefined;
      patch.autoStart = autoStart;
      patch.logFile = logFile;
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
      if (result.changed && flow.kind !== "command") reloadPrompt = true;
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

  async function reloadAfterSave(): Promise<void> {
    await reload();
    reloadPrompt = false;
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

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
    />
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 flex h-[min(92vh,880px)] w-[min(96vw,1180px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background text-card-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      aria-label={`编辑 ${flow.id}`}
      aria-describedby={undefined}
    >
      <header class="flex shrink-0 flex-wrap items-start gap-x-4 gap-y-2 border-b px-5 py-3 pr-12">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {#if flow.kind === "trigger"}
              <Zap class="size-3" aria-hidden="true" />
            {:else if flow.kind === "command"}
              <Rocket class="size-3" aria-hidden="true" />
            {:else if flow.kind === "schedule"}
              <CalendarClock class="size-3" aria-hidden="true" />
            {:else}
              <FileClock class="size-3" aria-hidden="true" />
            {/if}
            {KIND_LABEL[flow.kind]}
          </span>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="font-mono text-lg font-semibold tracking-tight">{flow.id}</span>
            {#if flow.active}
              <span class="flex items-center gap-1.5 text-xs text-foreground">
                <Status tone="ok" pulse></Status>
                运行中
              </span>
            {:else if flow.enabled}
              <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Status tone="ok"></Status>
                已启用
              </span>
            {:else}
              <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Status tone="idle"></Status>
                已停用
              </span>
            {/if}
            <span class="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              能力 <span class="font-mono tracking-tight">{flow.capability}</span>
            </span>
          </div>
        </div>
        <div class="ml-auto flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="视图模式">
          <button
            type="button"
            class={cn(
              "flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === "view" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onclick={() => (mode = "view")}
            aria-pressed={mode === "view"}
          >
            <Eye class="size-3.5" aria-hidden="true" />
            查看
          </button>
          <button
            type="button"
            class={cn(
              "flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === "edit" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onclick={() => (mode = "edit")}
            aria-pressed={mode === "edit"}
          >
            <Pencil class="size-3.5" aria-hidden="true" />
            编辑
          </button>
        </div>
        <Button variant="ghost" size="icon" class="absolute right-2 top-2 size-8" onclick={() => (open = false)} aria-label="关闭">
          <X class="size-4" aria-hidden="true" />
        </Button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside class="shrink-0 overflow-y-auto border-b px-5 py-4 lg:w-80 lg:border-b-0 lg:border-r">
          {#if mode === "view"}
            <div class="flex flex-col gap-1 overflow-hidden rounded-lg border bg-muted/40">
              {@render RowView({ label: "类型", value: KIND_LABEL[flow.kind] })}
              {#if flow.capability}{@render RowView({ label: "能力", value: flow.capability, mono: true })}{/if}
              {#if flow.session}{@render RowView({ label: "会话", value: flow.session, mono: true })}{/if}
              {#if flow.symbol}{@render RowView({ label: "符号", value: flow.symbol, mono: true })}{/if}
              {#if flow.maxRuns !== undefined}{@render RowView({ label: "最多触发次数", value: String(flow.maxRuns) })}{/if}
              {#if flow.cron}{@render RowView({ label: "cron", value: flow.cron, mono: true })}{/if}
              {#if flow.intervalSeconds}{@render RowView({ label: "间隔（秒）", value: String(flow.intervalSeconds) })}{/if}
              {@render RowView({ label: "日志文件", value: flow.logFile ? "记录" : "不记录" })}
              {#if flow.startedAt}{@render RowView({ label: "启动于", value: flow.startedAt })}{/if}
            </div>
          {:else}
            <div class="flex flex-col gap-4">
              <section>
                <span class="mb-3 block text-xs font-medium text-muted-foreground">开关</span>
                <div class="flex flex-col gap-2">
                  {#if allowed.includes("enabled")}
                    <div class="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                      <Label for="flow-enabled">启用</Label>
                      <Switch id="flow-enabled" bind:checked={enabled} />
                    </div>
                  {/if}
                  {#if allowed.includes("logFile")}
                    <div class="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                      <Label for="flow-logfile">写入日志文件</Label>
                      <Switch id="flow-logfile" bind:checked={logFile} />
                    </div>
                  {/if}
                  {#if allowed.includes("autoStart")}
                    <div class="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                      <Label for="flow-autostart">随运行时自动启动</Label>
                      <Switch id="flow-autostart" bind:checked={autoStart} />
                    </div>
                  {/if}
                </div>
              </section>

              <section>
                <span class="mb-3 block text-xs font-medium text-muted-foreground">字段</span>
                <div class="flex flex-col gap-3">
                  {#if allowed.includes("session")}
                    <div class="flex flex-col gap-1.5">
                      <Label for="flow-session">会话</Label>
                      <input class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" id="flow-session" bind:value={session} placeholder="留空则无会话" />
                    </div>
                  {/if}
                  {#if allowed.includes("title")}
                    <div class="flex flex-col gap-1.5">
                      <Label for="flow-title">标题</Label>
                      <input class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="flow-title" bind:value={title} />
                    </div>
                  {/if}
                  {#if allowed.includes("symbol")}
                    <div class="flex flex-col gap-1.5">
                      <Label for="flow-symbol">符号</Label>
                      <input class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" id="flow-symbol" bind:value={symbol} placeholder="可选" />
                    </div>
                  {/if}
                  {#if allowed.includes("maxRuns")}
                    <div class="flex flex-col gap-1.5">
                      <Label for="flow-maxruns">最多触发次数</Label>
                      <input class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" id="flow-maxruns" bind:value={maxRuns} placeholder="留空无限制" />
                    </div>
                  {/if}
                  {#if flow.kind === "schedule"}
                    <div class="flex flex-col gap-1.5">
                      <Label for="flow-cron">cron 表达式</Label>
                      <input class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" id="flow-cron" bind:value={cron} placeholder="0 8 * * *" />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <Label for="flow-interval">间隔（秒）</Label>
                      <input class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono" id="flow-interval" bind:value={intervalSeconds} placeholder="每 N 秒" />
                    </div>
                  {/if}
                </div>
              </section>
            </div>
          {/if}
        </aside>

        <main class="min-h-0 flex-1 overflow-y-auto px-5 py-4 lg:px-6">
          {#if mode === "view"}
            <div class="flex flex-col gap-4">
              {#if flow.kind === "command" || flow.kind === "schedule"}
                <section class="rounded-lg border bg-muted/20 p-3">
                  <span class="mb-2 block text-xs font-medium text-muted-foreground">动作</span>
                  {@render ActionSummary({ index: 1, capability: flow.capability, session: flow.actionSession, hook: flow.hook, config: flow.config })}
                </section>
              {/if}
              {#if flow.kind === "trigger"}
                <section class="rounded-lg border bg-muted/20 p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <span class="text-xs font-medium text-muted-foreground">动作链</span>
                    <span class="text-xs text-muted-foreground">{flow.actions?.length ?? 0} 个动作</span>
                  </div>
                  {#if (flow.actions?.length ?? 0) === 0}
                    <p class="rounded-lg border border-dashed bg-background px-3 py-3 text-xs text-muted-foreground">
                      暂无动作
                    </p>
                  {:else}
                    <div class="flex flex-col gap-2">
                      {#each flow.actions ?? [] as action, index (index)}
                        {@render ActionSummary({ index: index + 1, capability: action.capability, session: action.session, hook: action.hook, config: action.config })}
                      {/each}
                    </div>
                  {/if}
                </section>
              {/if}
              {#if allowed.includes("config")}
                <section class="rounded-lg border bg-muted/20 p-3">
                  <span class="mb-2 block text-xs font-medium text-muted-foreground">自身配置</span>
                  <CollapsibleJson value={flow.config ?? {}} label="config" />
                </section>
              {/if}
            </div>
          {:else}
            <div class="flex flex-col gap-4">
              {#if flow.kind === "command" || flow.kind === "schedule"}
                <section class="rounded-lg border bg-muted/20 p-3">
                  <span class="mb-3 block text-xs font-medium text-muted-foreground">动作配置</span>
                  {#if run}
                    <ActionEditor draft={run} bordered={false} />
                  {/if}
                </section>
              {/if}

              {#if flow.kind === "trigger"}
                <section class="rounded-lg border bg-muted/20 p-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <span class="text-xs font-medium text-muted-foreground">动作链</span>
                    <Button variant="outline" size="sm" onclick={addAction}>
                      <Plus class="size-3.5" aria-hidden="true" />
                      添加动作
                    </Button>
                  </div>
                  {#if actions.length === 0}
                    <p class="rounded-lg border border-dashed bg-background px-3 py-3 text-xs text-muted-foreground">
                      暂无动作。添加一个动作，触发后按顺序执行。
                    </p>
                  {:else}
                    <div class="flex flex-col gap-2">
                      {#each actions as draft, index (index)}
                        <div class="overflow-hidden rounded-lg border bg-muted/20">
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onclick={() => (expanded[index] = !expanded[index])}
                            aria-expanded={expanded[index]}
                          >
                            <ChevronRight
                              class={cn("size-3.5 text-muted-foreground transition-transform", expanded[index] && "rotate-90")}
                              aria-hidden="true"
                            />
                            <span class="text-xs font-medium text-muted-foreground">动作 {index + 1}</span>
                            {#if draft.capability}
                              <span class="font-mono text-xs">{draft.capability}</span>
                            {/if}
                            <span class="flex-1"></span>
                            {#if draft.configError}
                              <span class="text-xs text-destructive">JSON 错误</span>
                            {/if}
                            <Button
                              variant="ghost"
                              size="icon"
                              class="size-6"
                              onclick={(event) => {
                                event.stopPropagation();
                                removeAction(index);
                              }}
                              aria-label={`移除动作 ${index + 1}`}
                              title="移除"
                            >
                              <Trash2 class="size-3.5" aria-hidden="true" />
                            </Button>
                          </button>
                          {#if expanded[index]}
                            <div class="border-t px-3 py-3">
                              <ActionEditor draft={draft} heading="" bordered={false} />
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              {/if}

              {#if allowed.includes("config")}
                <section class="rounded-lg border bg-muted/20 p-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <span class="text-xs font-medium text-muted-foreground">自身配置</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-6 px-2 text-xs"
                      onclick={formatConfig}
                      title="格式化 JSON"
                    >
                      <Wand2 class="size-3" aria-hidden="true" />
                      格式化
                    </Button>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <Label for="flow-config">config（JSON）</Label>
                    <JsonEditor
                      id="flow-config"
                      bind:value={configText}
                      placeholderText={"{}"}
                      minHeight="min-h-28"
                      invalid={configError !== null}
                    />
                    {#if configError}
                      <p class="text-xs text-destructive">{configError}</p>
                    {/if}
                  </div>
                </section>
              {/if}

              {#if formError}
                <p class="text-xs text-destructive">{formError}</p>
              {/if}
            </div>
          {/if}
        </main>
      </div>

      <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3">
        <div class="flex items-center gap-2">
          {#if flow.kind === "service"}
            <Button variant="outline" onclick={toggleService} disabled={busy}>
              {flow.active ? "停止服务" : "启动服务"}
            </Button>
          {/if}
          <Button variant="outline" onclick={reload} disabled={busy}>
            <RotateCw class="size-3.5" aria-hidden="true" />
            重载此条
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="ghost" onclick={() => (open = false)}>关闭</Button>
          <Button onclick={save} disabled={busy || configError !== null}>保存</Button>
        </div>
      </footer>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<AlertDialogRoot open={reloadPrompt} onOpenChange={(value) => (reloadPrompt = value)}>
  <AlertDialogPortal>
    <AlertDialogOverlay
      class="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
    />
    <AlertDialogContent
      class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2"
    >
      <AlertDialogTitle class="font-display text-lg font-semibold leading-none">配置已保存，立即重载？</AlertDialogTitle>
      <AlertDialogDescription class="text-sm text-muted-foreground">
        {KIND_LABEL[flow.kind]}的改动需要重载才会对运行中的实例生效。
      </AlertDialogDescription>
      <div class="flex justify-end gap-2">
        <AlertDialogCancel
          class="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          稍后
        </AlertDialogCancel>
        <AlertDialogAction
          class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => void reloadAfterSave()}
        >
          立即重载
        </AlertDialogAction>
      </div>
    </AlertDialogContent>
  </AlertDialogPortal>
</AlertDialogRoot>

{#snippet RowView({ label, value, mono = false }: { label: string; value: string; mono?: boolean })}
  <div class="flex items-start justify-between gap-3 px-3 py-2 text-xs">
    <span class="shrink-0 text-muted-foreground">{label}</span>
    <span class={cn("text-right", mono && "font-mono")}>{value}</span>
  </div>
{/snippet}

{#snippet ActionSummary({ index, capability, session, hook, config }: { index: number; capability: string; session?: string; hook?: string; config?: unknown })}
  <div class="rounded-lg border bg-background">
    <div class="flex items-center gap-2 border-b px-3 py-2">
      <span class="text-xs font-medium text-muted-foreground">{index}</span>
      <span class="font-mono text-xs">{capability}</span>
    </div>
    <div class="flex flex-col gap-1.5 px-3 py-2">
      {#if session}
        <div class="flex items-center gap-2 text-xs">
          <span class="w-16 shrink-0 text-muted-foreground">会话</span>
          <span class="font-mono">{session}</span>
        </div>
      {/if}
      {#if hook}
        <div class="flex items-center gap-2 text-xs">
          <span class="w-16 shrink-0 text-muted-foreground">hook</span>
          <span class="font-mono">{hook}</span>
        </div>
      {/if}
      <CollapsibleJson value={config ?? {}} label="config" />
    </div>
  </div>
{/snippet}
