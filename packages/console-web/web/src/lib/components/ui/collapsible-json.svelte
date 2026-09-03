<script lang="ts">
  import { ChevronRight } from "lucide-svelte";
  import { cn } from "$lib/utils";
  import { prettyJson } from "$lib/format";

  let { value, label = "载荷" }: { value: unknown; label?: string } = $props();

  let open = $state(false);
  const text = $derived(prettyJson(value));
</script>

{#if text}
  <div class="rounded-lg border bg-muted/40">
    <button
      type="button"
      onclick={() => (open = !open)}
      class="flex w-full items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight class={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
      {label}
      <span class="ml-auto font-mono text-[10px] text-muted-foreground/70">{text.length} 字符</span>
    </button>
    {#if open}
      <pre class="max-h-72 overflow-auto border-t bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed">{text}</pre>
    {/if}
  </div>
{/if}