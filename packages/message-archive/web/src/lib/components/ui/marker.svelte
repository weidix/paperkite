<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    variant = "default",
    class: className = "",
    children,
    ...rest
  }: { variant?: "default" | "separator" | "border"; class?: string; children?: Snippet } & HTMLAttributes<HTMLDivElement> = $props();

  const VARIANTS: Record<string, string> = {
    default: "",
    separator:
      "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
    border: "border-b border-border pb-2"
  };
</script>

<div
  class={cn(
    "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
    VARIANTS[variant],
    className
  )}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>