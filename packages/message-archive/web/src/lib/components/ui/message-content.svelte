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

<div class={cn("flex w-full min-w-0 flex-col gap-2.5 break-words", className)} {...rest}>
  {#if children}{@render children()}{/if}
</div>