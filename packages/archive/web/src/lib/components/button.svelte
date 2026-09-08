<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  type Variant = "default" | "secondary" | "outline" | "ghost";
  type Size = "default" | "sm" | "icon";

  const VARIANTS: Record<Variant, string> = {
    default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
    outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground"
  };

  const SIZES: Record<Size, string> = {
    default: "h-9 px-4 py-2",
    sm: "h-8 rounded-md px-3 text-xs",
    icon: "size-8"
  };

  let {
    variant = "default",
    size = "default",
    class: className = "",
    children,
    ...rest
  }: {
    variant?: Variant;
    size?: Size;
    class?: string;
    children?: Snippet;
  } & HTMLButtonAttributes = $props();
</script>

<button
  class={cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
    VARIANTS[variant],
    SIZES[size],
    className
  )}
  {...rest}
>
  {#if children}{@render children()}{/if}
</button>