<script lang="ts">
  import { Label } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  const { Root } = Label;

  let {
    class: className = "",
    children,
    id,
    for: htmlFor
  }: { class?: string; children?: Snippet; id?: string; for?: string } = $props();
</script>

<Root
  {id}
  for={htmlFor}
  class={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
>
  {#if children}{@render children()}{/if}
</Root>