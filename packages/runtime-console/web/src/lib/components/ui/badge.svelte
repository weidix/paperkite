<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";

  const VARIANTS: Record<Variant, string> = {
    default: "border-transparent bg-primary text-primary-foreground shadow-sm",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    outline: "text-foreground",
    ghost: "border-transparent bg-transparent text-muted-foreground",
    destructive: "border-transparent bg-destructive text-destructive-foreground shadow-sm"
  };

  let {
    variant = "outline",
    class: className = "",
    children,
    ...rest
  }: {
    variant?: Variant;
    class?: string;
    children?: Snippet;
  } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
  class={cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors [&_svg:not([class*='size-'])]:size-3.5",
    VARIANTS[variant],
    className
  )}
  {...rest}
>
  {#if children}{@render children()}{/if}
</span>