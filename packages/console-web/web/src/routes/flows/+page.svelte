<script lang="ts">
  import {
    CalendarClock,
    CirclePlay,
    FileClock,
    MoreHorizontal,
    RefreshCw,
    Rocket,
    Zap
  } from "lucide-svelte";
  import { DropdownMenu } from "bits-ui";
  import { toast } from "$lib/toast-store.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Status from "$lib/components/ui/status.svelte";
  import Switch from "$lib/components/ui/switch.svelte";
  import Tabs from "$lib/components/ui/tabs.svelte";
  import FlowDialog from "$lib/components/flow-dialog.svelte";
  import { api } from "$lib/api";
  import { errorText } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import type { FlowKind, FlowSnapshot } from "$lib/runtime";

  const MenuRoot = DropdownMenu.Root;
  const MenuTrigger = DropdownMenu.Trigger;
  const MenuPortal = DropdownMenu.Portal;
  const MenuContent = DropdownMenu.Content;
  const MenuItem = DropdownMenu.Item;

  type FlowTab = "all" | FlowKind;

  const TABS = [
    { value: "all" as FlowTab, label: "全部", icon: CirclePlay },
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

  const snapshot = $derived(runtime.snapshot);
  const flows = $derived(snapshot?.flows ?? []);
  const visible = $derived(tab === "all" ? flows : flows.filter((flow) => flow.kind === tab));
  const tabItems = $derived(
    TABS.map((item) => ({
      value: item.value,
      label: item.label,
      icon: item.icon,
      count: item.value === "all" ? flows.length : flows.filter((flow) => flow.kind === item.value).length
    }))
  );

  function flowSummary(flow: FlowSnapshot): string {
    if (flow.kind === "command") return flow.title ?? flow.id;
    if (flow.kind === "schedule") return flow.cron ?? `每 ${flow.intervalSeconds}s`;
    if (flow.kind === "service") return flow.autoStart ? "自启" : "手动";
    const actionCount = flow.actions?.length ?? 0;
    return `${actionCount} 个动作${flow.maxRuns ? ` · 最多 ${flow.maxRuns} 次` : ""}`;
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

  async function setEnabled(flow: FlowSnapshot, enabled: boolean): Promise<void> {
    pending = flow.id;
    try {
      const result = await api.updateFlow(flow.id, { enabled });
      toast.success(result.changed ? `已${enabled ? "启用" : "停用"} ${flow.id}` : "没有变更");
      await runtime.refresh();
    } catch (error) {
      toast.error(errorText(error));
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
            <CirclePlay class="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p class="text-sm font-medium">没有已配置的流程</p>
          <p class="max-w-sm text-xs text-muted-foreground">在 flows.yml 中声明触发器、命令、定时任务或服务后，这里会出现对应条目。</p>
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
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-14 text-center">启用</th>
                <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-12"></th>
              </tr>
            </thead>
            <tbody class="[&_tr:last-child]:border-0">
              {#each visible as flow (`${flow.kind}:${flow.id}`)}
                {@const busy = pending === flow.id}
                <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted cursor-pointer" onclick={() => openDialog(flow)}>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                    {#if flow.active}
                      <Status tone="ok" pulse></Status>
                    {:else if flow.enabled || flow.kind === "command"}
                      <Status tone="ok"></Status>
                    {:else}
                      <Status tone="idle"></Status>
                    {/if}
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
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
                    <span class="ml-2 text-xs text-muted-foreground">{KIND_LABEL[flow.kind]}</span>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                    <span class="font-mono tracking-tight text-xs text-muted-foreground">{flow.capability}</span>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden md:table-cell">
                    {#if flow.session}
                      <span class="font-mono tracking-tight text-xs text-muted-foreground">{flow.session}</span>
                    {:else}
                      <span class="text-xs text-muted-foreground/60">-</span>
                    {/if}
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden max-w-56 truncate sm:table-cell">
                    <span class="text-xs text-muted-foreground">{flowSummary(flow)}</span>
                  </td>
                  <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 text-center">
                    {#if flow.kind !== "command"}
                      <Switch
                        checked={flow.enabled}
                        onCheckedChange={(value) => void setEnabled(flow, value)}
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
  </div>
{/if}