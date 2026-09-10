<script lang="ts">
  import {
    CalendarClock,
    CircleAlert,
    CirclePlay,
    FileClock,
    MoreHorizontal,
    RefreshCw,
    Rocket,
    SquarePen,
    TriangleAlert,
    Zap
  } from "lucide-svelte";
  import { DropdownMenu } from "bits-ui";
  import { toast } from "$lib/toast-store.svelte";
  import { isEmptyConfig } from "$lib/action-draft";
  import Badge from "$lib/components/ui/badge.svelte";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import Status from "$lib/components/ui/status.svelte";
  import Switch from "$lib/components/ui/switch.svelte";
  import Tabs from "$lib/components/ui/tabs.svelte";
  import FlowDialog from "$lib/components/flow-dialog.svelte";
  import { api } from "$lib/api";
  import { errorText } from "$lib/format";
  import { flowStatus } from "$lib/flow-status";
  import { runtime } from "$lib/runtime.svelte";
  import type { FlowKind, FlowSnapshot } from "$lib/runtime";
  import { cn } from "$lib/utils";

  const MenuRoot = DropdownMenu.Root;
  const MenuTrigger = DropdownMenu.Trigger;
  const MenuPortal = DropdownMenu.Portal;
  const MenuContent = DropdownMenu.Content;
  const MenuItem = DropdownMenu.Item;

  type FlowTab = "all" | "missing" | FlowKind;

  const TABS = [
    { value: "all" as FlowTab, label: "全部", icon: CirclePlay },
    { value: "missing" as FlowTab, label: "缺配置", icon: CircleAlert },
    { value: "trigger" as FlowTab, label: "触发器", icon: Zap },
    { value: "command" as FlowTab, label: "命令", icon: Rocket },
    { value: "schedule" as FlowTab, label: "定时任务", icon: CalendarClock },
    { value: "service" as FlowTab, label: "服务", icon: FileClock }
  ];

  const KIND_LABEL: Record<FlowKind, string> = {
    trigger: "触发器",
    command: "命令",
    schedule: "定时任务",
    service: "服务"
  };

  let tab = $state<FlowTab>("all");
  let selected: FlowSnapshot | null = $state(null);
  let dialogOpen = $state(false);
  let pending = $state<string | null>(null);
  let toggleTarget = $state<{ flow: FlowSnapshot; enabled: boolean } | null>(null);

  const snapshot = $derived(runtime.snapshot);
  const flows = $derived(snapshot?.flows ?? []);
  const visible = $derived(
    tab === "all"
      ? flows
      : tab === "missing"
        ? flows.filter((flow) => configSummary(flow).missing > 0)
        : flows.filter((flow) => flow.kind === tab)
  );
  const tabItems = $derived(
    TABS.map((item) => ({
      value: item.value,
      label: item.label,
      icon: item.icon,
      count:
        item.value === "all"
          ? flows.length
          : item.value === "missing"
            ? flows.filter((flow) => configSummary(flow).missing > 0).length
            : flows.filter((flow) => flow.kind === item.value).length
    }))
  );

  function flowSummary(flow: FlowSnapshot): string {
    if (flow.kind === "command") return flow.title ?? flow.id;
    if (flow.kind === "schedule") return flow.cron ?? `每 ${flow.intervalSeconds}s`;
    if (flow.kind === "service") return flow.autoStart ? "自启" : "手动";
    const actionCount = flow.actions?.length ?? 0;
    return `${actionCount} 个动作${flow.maxRuns ? ` · 最多 ${flow.maxRuns} 次` : ""}`;
  }

  function configSummary(flow: FlowSnapshot): { filled: number; total: number; missing: number } {
    const slots: { label: string; config: unknown }[] =
      flow.kind === "trigger"
        ? [
            { label: "自身", config: flow.config },
            ...(flow.actions ?? []).map((action, index) => ({ label: `动作 ${index + 1}`, config: action.config }))
          ]
        : flow.kind === "service"
          ? [{ label: "自身", config: flow.config }]
          : [{ label: "动作", config: flow.config }];
    const missing = slots.filter((slot) => isEmptyConfig(slot.config)).length;
    return { filled: slots.length - missing, total: slots.length, missing };
  }

  /** 行内状态图标：错误优先，其次配额耗尽与配置警告；完整信息进 title。 */
  function flowNotice(flow: FlowSnapshot): { tone: "error" | "warn"; title: string } | undefined {
    const lines: string[] = [];
    let tone: "error" | "warn" | undefined;
    if (!flow.suspended) {
      const reason = flow.lastStop?.reason;
      if (reason === "error") {
        tone = "error";
        lines.push(`启动失败：${flow.lastStop?.error ?? "未知错误"}`);
      } else if (reason === "maxruns") {
        tone = "warn";
        lines.push("已停用（配额耗尽）：触发次数已达 maxRuns，本次进程内停用");
      }
    }
    for (const warning of flow.warnings ?? []) {
      tone ??= "warn";
      lines.push(warning);
    }
    return tone ? { tone, title: lines.join("\n") } : undefined;
  }

  function suspensionTitle(flow: FlowSnapshot): string {
    const suspension = flow.suspended;
    if (!suspension) return "";
    const prefix = `会话 ${suspension.session ?? ""} 自 ${suspension.since} 起隔离`;
    return suspension.error ? `${prefix}：${suspension.error}` : `${prefix}，待会话恢复自动重启`;
  }

  function toggleTitle(target: { flow: FlowSnapshot; enabled: boolean }): string {
    return `确定${target.enabled ? "启用" : "停用"} ${target.flow.id}？`;
  }

  function toggleEffect(target: { flow: FlowSnapshot; enabled: boolean }): string {
    const { flow, enabled } = target;
    if (flow.kind === "trigger") return enabled ? "立即按新状态启动监听。" : "立即停止监听。";
    if (flow.kind === "schedule") return enabled ? "立即挂上调度。" : "立即卸下调度。";
    if (flow.autoStart) return enabled ? "自启服务立即启动。" : "自启服务立即停止。";
    return "手动服务只写回配置，运行状态需另行「启动服务」。";
  }

  async function run(flow: FlowSnapshot): Promise<void> {
    pending = flow.id;
    try {
      await api.runFlow(flow.id);
      toast.success(`已运行 ${flow.id}`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      pending = null;
    }
  }

  async function reload(flow: FlowSnapshot): Promise<void> {
    pending = flow.id;
    try {
      await api.reloadFlow(flow.id);
      toast.success(`已重载 ${flow.id}`);
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      pending = null;
    }
  }

  async function toggleService(flow: FlowSnapshot): Promise<void> {
    pending = flow.id;
    try {
      if (flow.active) await api.stopService(flow.id);
      else await api.startService(flow.id);
      toast.success(flow.active ? `${flow.id} 已停止` : `${flow.id} 已启动`);
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      pending = null;
    }
  }

  async function applyToggle(target: { flow: FlowSnapshot; enabled: boolean }): Promise<void> {
    const { flow, enabled } = target;
    pending = flow.id;
    try {
      const result = await api.updateFlow(flow.id, { enabled });
      if (!result.changed) {
        toast.info("没有变更");
        return;
      }
      try {
        await api.reloadFlow(flow.id);
        toast.success(`已${enabled ? "启用" : "停用"}并生效`);
      } catch (error) {
        toast.error(`配置已写回，重载失败：${errorText(error)}`);
      }
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
      await runtime.refresh();
    } finally {
      pending = null;
    }
  }

  function openDialog(flow: FlowSnapshot): void {
    selected = flow;
    dialogOpen = true;
  }
</script>

{#if !snapshot}
  <div class="flex flex-col gap-4">
    <div class="animate-pulse rounded-md bg-muted h-9 w-48 rounded-lg"></div>
    <div class="animate-pulse rounded-md bg-muted h-72 rounded-xl"></div>
  </div>
{:else}
  <div class="flex flex-col gap-4">
    <Tabs bind:value={tab} items={tabItems} />

    {#if visible.length === 0}
      <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span class="flex size-10 items-center justify-center rounded-full bg-muted">
            <CircleAlert class="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          {#if tab === "missing"}
            <p class="text-sm font-medium">没有缺配置的流程</p>
            <p class="max-w-sm text-xs text-muted-foreground">所有流程的自身配置与动作配置都已填写。</p>
          {:else}
            <p class="text-sm font-medium">没有已配置的流程</p>
            <p class="max-w-sm text-xs text-muted-foreground">在 flows.yml 中声明触发器、命令、定时任务或服务后，这里会出现对应条目。</p>
          {/if}
        </div>
    {:else}
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="p-0">
          <div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">
            <thead class="[&_tr]:border-b">
              <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-10"></th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">流程</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">能力</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 hidden md:table-cell">会话</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 hidden sm:table-cell">摘要</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 hidden lg:table-cell">配置</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-14 text-center">启用</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-12"></th>
              </tr>
            </thead>
            <tbody class="[&_tr:last-child]:border-0">
              {#each visible as flow (`${flow.kind}:${flow.id}`)}
                {@const busy = pending === flow.id}
                {@const summary = configSummary(flow)}
                {@const notice = flowNotice(flow)}
                {@const status = flowStatus(flow)}
                <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted cursor-pointer" onclick={() => openDialog(flow)}>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0" title={status.label}>
                    <Status tone={status.tone} pulse={status.pulse}></Status>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button
                        type="button"
                        class="text-left font-mono text-sm underline-offset-4 hover:underline"
                        onclick={(event) => {
                          event.stopPropagation();
                          openDialog(flow);
                        }}
                      >
                        {flow.id}
                      </button>
                      <span class="text-xs text-muted-foreground">{KIND_LABEL[flow.kind]}</span>
                      {#if notice}
                        <span
                          class={cn(
                            "inline-flex shrink-0 cursor-help items-center",
                            notice.tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                          )}
                          role="img"
                          aria-label={notice.title}
                          title={notice.title}
                        >
                          {#if notice.tone === "error"}
                            <CircleAlert class="size-3.5" aria-hidden="true" />
                          {:else}
                            <TriangleAlert class="size-3.5" aria-hidden="true" />
                          {/if}
                        </span>
                      {/if}
                      {#if flow.pendingReload}
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:pointer-events-none disabled:opacity-50 dark:text-amber-400"
                          disabled={busy}
                          title="按最新定义重载此条"
                          aria-label={`重载 ${flow.id}`}
                          onclick={(event) => {
                            event.stopPropagation();
                            void reload(flow);
                          }}
                        >
                          <RefreshCw class={cn("size-3.5", busy && "animate-spin")} aria-hidden="true" />
                          待重载
                        </button>
                      {/if}
                    </div>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                    <span class="font-mono tracking-tight text-xs text-muted-foreground">{flow.capability}</span>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden md:table-cell">
                    {#if flow.session}
                      <span class="font-mono tracking-tight text-xs text-muted-foreground">{flow.session}</span>
                      {#if flow.suspended}
                        <Badge variant="destructive" class="ml-1" title={suspensionTitle(flow)}>会话隔离</Badge>
                      {/if}
                    {:else}
                      <span class="text-xs text-muted-foreground/60">-</span>
                    {/if}
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden max-w-56 truncate sm:table-cell">
                    <span class="text-xs text-muted-foreground">{flowSummary(flow)}</span>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden lg:table-cell">
                    {#if summary.missing > 0}
                      <Badge variant="destructive" title={`${summary.filled}/${summary.total} 个配置已填写`}>
                        缺 {summary.missing} 项
                      </Badge>
                    {:else}
                      <Badge variant="outline" title={`${summary.filled}/${summary.total} 个配置已填写`}>
                        已配置
                      </Badge>
                    {/if}
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 text-center">
                    {#if flow.kind !== "command"}
                      <Switch
                        checked={flow.enabled}
                        controlled
                        onCheckedChange={(value) => (toggleTarget = { flow, enabled: value })}
                        disabled={busy}
                        onclick={(event) => event.stopPropagation()}
                        aria-label={`切换 ${flow.id} 启用状态`}
                      />
                    {/if}
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0" onclick={(event) => event.stopPropagation()}>
                    <MenuRoot>
                      <MenuTrigger
                        class="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${flow.id} 操作`}
                        onclick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal class="size-4" aria-hidden="true" />
                      </MenuTrigger>
                      <MenuPortal>
                        <MenuContent
                          class="z-50 min-w-[9rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                          sideOffset={4}
                          align="end"
                        >
                          <MenuItem
                            onSelect={() => openDialog(flow)}
                            class="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                          >
                            <SquarePen class="size-4" aria-hidden="true" />
                            修改此条
                          </MenuItem>
                          {#if flow.kind === "command" || flow.kind === "schedule"}
                            <MenuItem
                              onSelect={() => void run(flow)}
                              class="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                            >
                              <CirclePlay class="size-4" aria-hidden="true" />
                              运行一次
                            </MenuItem>
                          {/if}
                          {#if flow.kind === "service"}
                            <MenuItem
                              onSelect={() => void toggleService(flow)}
                              class="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                            >
                              {flow.active ? "停止服务" : "启动服务"}
                            </MenuItem>
                          {/if}
                          {#if flow.kind !== "command"}
                            <MenuItem
                              onSelect={() => void reload(flow)}
                              class="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent"
                            >
                              <RefreshCw class="size-4" aria-hidden="true" />
                              重载此条
                            </MenuItem>
                          {/if}
                        </MenuContent>
                      </MenuPortal>
                    </MenuRoot>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table></div>
        </div>
      </div>
    {/if}

    {#if selected}
      <FlowDialog flow={selected} bind:open={dialogOpen} onOpenChange={(open) => !open && (selected = null)} />
    {/if}

    {#if toggleTarget}
      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => {
          if (!open) toggleTarget = null;
        }}
        onCancel={() => void runtime.refresh()}
        title={toggleTitle(toggleTarget)}
        description={`${toggleEffect(toggleTarget)}确认后配置写回 flows.yml 并立即重载该条。`}
        confirmLabel={toggleTarget.enabled ? "启用" : "停用"}
        tone={toggleTarget.enabled ? "default" : "destructive"}
        onConfirm={() => {
          if (toggleTarget) void applyToggle(toggleTarget);
        }}
      />
    {/if}
  </div>
{/if}