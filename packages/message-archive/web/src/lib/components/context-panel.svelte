<script lang="ts">
  import Sheet from "$lib/components/ui/sheet.svelte";
  import ContextThread from "$lib/components/context-thread.svelte";
  import { api } from "$lib/api";
  import { formatMessageDate, errorText } from "$lib/format";
  import type { ContextPayload, ContextTarget, LightboxItem } from "$lib/types";

  const CONTEXT_INITIAL_WINDOW = 120;

  let {
    target,
    open = $bindable(false),
    onOpenChange,
    onOpenMedia
  }: {
    target: ContextTarget | null;
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenMedia: (item: LightboxItem) => void;
  } = $props();

  let payload: ContextPayload | null = $state(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open || !target) return;
    let cancelled = false;
    loading = true;
    error = null;
    payload = null;
    api
      .context(target.rowId, CONTEXT_INITIAL_WINDOW, CONTEXT_INITIAL_WINDOW)
      .then((result) => {
        if (!cancelled) payload = result;
      })
      .catch((cause: unknown) => {
        if (!cancelled) error = errorText(cause);
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  function threadWithAnchor(value: ContextPayload | null): ContextPayload | null {
    return value && value.anchor ? value : null;
  }

  function describeThread(value: ContextPayload | null): string {
    if (!value?.anchor) return "选择一条消息后查看同群上下文";
    return (
      `${value.anchor.chat_title || "未知群组"} · ${formatMessageDate(value.anchor.date)} · ` +
      `上文 ${value.before.length} 条 · 下文 ${value.after.length} 条`
    );
  }

  const threadPayload = $derived(threadWithAnchor(payload));
  const meta = $derived(describeThread(threadPayload));
</script>

<Sheet bind:open {onOpenChange} side="right" title="同群上下文" description={meta} contentClass="sm:max-w-2xl">
  <div class="flex min-h-0 flex-1 flex-col">
    {#if loading && !payload}
      <div class="flex flex-col gap-4 p-4">
        {#each [0, 1, 2, 3] as index (index)}
          <div class="flex flex-col gap-2">
            <div class="animate-pulse rounded-md bg-muted h-3 w-40"></div>
            <div class="animate-pulse rounded-md bg-muted h-16 w-2/3"></div>
          </div>
        {/each}
      </div>
    {:else if error}
      <div class="p-4">
        <div role="alert" class="relative w-full rounded-lg border border-destructive/50 px-4 py-3 text-sm text-destructive dark:border-destructive [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-destructive">
          <div class="inline-flex items-center gap-2 font-medium">加载上下文失败</div>
          <div class="text-sm [&_p]:leading-relaxed">{error}</div>
        </div>
      </div>
    {:else if !threadPayload}
      <div class="p-4 text-sm text-muted-foreground">未找到上下文</div>
    {:else}
      <ContextThread payload={threadPayload} keyword={target?.keyword ?? ""} {onOpenMedia} />
    {/if}
  </div>
</Sheet>