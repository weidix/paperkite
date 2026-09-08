<script lang="ts">
  import { FileText, RefreshCw } from "lucide-svelte";
  import { toast } from "$lib/toast-store.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Select from "$lib/components/ui/select.svelte";
  import Switch from "$lib/components/ui/switch.svelte";
  import { api } from "$lib/api";
  import { errorText } from "$lib/format";
  import { runtime } from "$lib/runtime.svelte";
  import { cn } from "$lib/utils";

  const LINE_OPTIONS = [100, 200, 500, 2000];
  const REFRESH_INTERVAL_MS = 3_000;

  let scope = $state("");
  let linesText = $state("200");
  let autoRefresh = $state(true);
  let content: readonly string[] = $state([]);
  let busy = $state(false);
  let viewport: HTMLDivElement | null = $state(null);
  const lines = $derived(Number(linesText));

  const snapshot = $derived(runtime.snapshot);
  const scopes = $derived(snapshot?.logs ?? []);
  const effectiveScope = $derived(scopes.some((item) => item.scope === scope) ? scope : (scopes[0]?.scope ?? ""));
  const scopeOptions = $derived(scopes.map((item) => ({ value: item.scope, label: item.scope })));
  const lineOptions = $derived(LINE_OPTIONS.map((count) => ({ value: String(count), label: `最近 ${count} 行` })));

  async function load(): Promise<void> {
    if (!effectiveScope) return;
    busy = true;
    try {
      const result = await api.logLines(effectiveScope, lines);
      content = result.lines;
      viewport?.scrollTo({ top: viewport.scrollHeight });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    if (!autoRefresh || !effectiveScope) return;
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  });
</script>

{#if scopes.length === 0}
  <div class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span class="flex size-10 items-center justify-center rounded-full bg-muted">
            <FileText class="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p class="text-sm font-medium">没有可用的日志文件</p>
          <p class="max-w-sm text-xs text-muted-foreground">在 settings.yml 中配置 logging.directory 后，运行时会为核心与每个插件写入日志文件。</p>
        </div>
{:else}
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <Select bind:value={scope} options={scopeOptions} triggerClass="w-64" aria-label="日志来源" />
      <Select bind:value={linesText} options={lineOptions} triggerClass="w-28" aria-label="显示行数" />
      <label class="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch bind:checked={autoRefresh} aria-label="自动刷新" />
        自动刷新
      </label>
      <span class="flex-1"></span>
      <Button variant="outline" size="sm" onclick={load} disabled={busy}>
        <RefreshCw class={cn("size-4", busy && "animate-spin")} aria-hidden="true" />
        刷新
      </Button>
      <Button variant="ghost" size="sm" onclick={() => void runtime.refresh()}>更新日志列表</Button>
    </div>

    <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div class="p-0">
        <div class="flex items-center gap-2 border-b px-4 py-2">
          <FileText class="size-4 text-muted-foreground" aria-hidden="true" />
          <span class="font-mono tracking-tight text-xs text-muted-foreground">
            {scopes.find((item) => item.scope === effectiveScope)?.path}
          </span>
        </div>
        <div bind:this={viewport} class="h-[60vh] overflow-auto">
          {#if content.length === 0}
            <p class="px-4 py-10 text-center font-mono text-xs text-muted-foreground">暂无日志内容</p>
          {:else}
            <pre class="whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed">{content.join("\n")}</pre>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}