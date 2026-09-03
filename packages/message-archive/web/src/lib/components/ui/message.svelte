<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    align = "start",
    class: className = "",
    children,
    ...rest
  }: { align?: "start" | "end"; class?: string; children?: Snippet } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
  class={cn(
    "group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse",
    className
  )}
  data-align={align}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>