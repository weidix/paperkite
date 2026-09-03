<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  let {
    variant = "outline",
    align = "start",
    class: className = "",
    children,
    ...rest
  }: { variant?: "tinted" | "outline" | "ghost"; align?: "start" | "end"; class?: string; children?: Snippet } & HTMLAttributes<HTMLDivElement> = $props();

  const VARIANTS: Record<string, string> = {
    tinted: "bg-accent text-accent-foreground",
    outline: "border border-border bg-background",
    ghost: "border-none bg-transparent p-0"
  };
</script>

<div
  class={cn(
    "group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 data-[align=end]:self-end",
    VARIANTS[variant],
    className
  )}
  data-variant={variant}
  data-align={align}
  {...rest}
>
  {#if children}{@render children()}{/if}
</div>