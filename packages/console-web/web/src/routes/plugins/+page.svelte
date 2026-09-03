<script lang="ts">
  import { Package, Puzzle } from "lucide-svelte";
  import Badge from "$lib/components/ui/badge.svelte";
  import { api } from "$lib/api";
  import { errorText } from "$lib/format";
  import type { PluginCapability } from "$lib/runtime";

  const KIND_LABEL: Record<PluginCapability["kind"], string> = {
    action: "动作",
    trigger: "触发器",
    service: "服务"
  };

  let plugins: readonly import("$lib/runtime").PluginInfo[] | null = $state(null);
  let error = $state<string | null>(null);

  $effect(() => {
    let cancelled = false;
    api
      .plugins()
      .then((items) => {
        if (!cancelled) plugins = items;
      })
      .catch((cause: unknown) => {
        if (!cancelled) error = errorText(cause);
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if !plugins && !error}
  <div class="flex flex-col gap-4">
    <div class="animate-pulse rounded-md bg-muted h-9 w-48 rounded-lg"></div>
    <div class="animate-pulse rounded-md bg-muted h-64 rounded-xl"></div>
  </div>
{:else if error}
  <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <span class="flex size-10 items-center justify-center rounded-full bg-muted">
        <Puzzle class="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <p class="text-sm font-medium">插件清单读取失败</p>
      <p class="max-w-sm text-xs text-muted-foreground">{error}</p>
    </div>
{:else if plugins!.length === 0}
  <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span class="flex size-10 items-center justify-center rounded-full bg-muted">
            <Puzzle class="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p class="text-sm font-medium">没有已安装的插件</p>
          <p class="max-w-sm text-xs text-muted-foreground">通过 paperkite plugin add 安装插件，或在核心 bundles 中声明内置插件。</p>
        </div>
{:else}
  <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
    <div class="p-0">
      <div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">
        <thead class="[&_tr]:border-b">
          <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
            <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">插件</th>
            <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0">版本</th>
            <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 hidden md:table-cell">能力</th>
            <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 w-24 text-center">状态</th>
          </tr>
        </thead>
        <tbody class="[&_tr:last-child]:border-0">
          {#each plugins! as plugin (plugin.name)}
            <tr class="border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted">
              <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                <div class="flex items-center gap-2">
                  <span class="flex size-7 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                    <Package class="size-3.5" aria-hidden="true" />
                  </span>
                  <span class="font-mono tracking-tight text-sm">{plugin.name}</span>
                </div>
              </td>
              <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                <span class="font-mono text-xs text-muted-foreground">{plugin.version ?? "-"}</span>
              </td>
              <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 hidden md:table-cell">
                <div class="flex flex-wrap gap-1">
                  {#each plugin.capabilities as item (item.name)}
                    <Badge
                      variant={item.kind === "action"
                        ? "default"
                        : item.kind === "trigger"
                          ? "outline"
                          : "secondary"}
                    >
                      <span class="font-mono">{item.name}</span>
                      <span class="text-[10px] opacity-70">· {KIND_LABEL[item.kind]}</span>
                    </Badge>
                  {/each}
                </div>
              </td>
              <td class="p-4 align-middle [&:has([role=checkbox])]:pr-0 text-center">
                {#if plugin.loaded}
                  <Badge variant="secondary">已加载</Badge>
                {:else}
                  <Badge variant="outline" class="text-muted-foreground">未加载</Badge>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table></div>
    </div>
  </div>
{/if}