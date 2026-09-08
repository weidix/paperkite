<script lang="ts">
  import { CircleCheck, CircleX, Info } from "lucide-svelte";
  import { toasts } from "$lib/toast-store.svelte";

  const icons = {
    success: CircleCheck,
    error: CircleX,
    info: Info
  } as const;
</script>

<div
  class="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4"
  aria-live="polite"
  role="status"
>
  {#each toasts as item (item.id)}
    {@const Icon = icons[item.kind]}
    <div
      class="pointer-events-auto flex items-center gap-2 rounded-lg border bg-card px-3.5 py-2 text-sm shadow-lg data-[kind=error]:border-destructive/40"
      data-kind={item.kind}
    >
      <Icon class="size-4 shrink-0 {item.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}" />
      <span class="min-w-0">{item.message}</span>
    </div>
  {/each}
</div>