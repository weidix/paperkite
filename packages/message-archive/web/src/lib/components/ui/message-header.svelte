<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    class: className = "",
    children,
    ...rest
  }: { class?: string; children?: Snippet } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
  class={cn(
    "flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground",
    className
  )}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>