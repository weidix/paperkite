<script lang="ts">
  import { Separator } from "bits-ui";
  import { cn } from "$lib/utils";

  const { Root } = Separator;

  let {
    orientation = "horizontal",
    class: className = ""
  }: { orientation?: "horizontal" | "vertical"; class?: string } = $props();
</script>

<Root
  {orientation}
  class={cn(
    "shrink-0 bg-border",
    orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
    className
  )}
/>