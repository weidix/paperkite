<script lang="ts">
  import type { SvelteComponent } from "svelte";
  import { Tabs } from "bits-ui";
  import { cn } from "$lib/utils";

  const { Root, List, Trigger } = Tabs;

  export interface TabItem {
    value: string;
    label: string;
    icon?: new (...args: any[]) => any;
    count?: number;
  }

  let {
    value = $bindable("all"),
    items = [],
    listClass = ""
  }: {
    value?: string;
    items?: TabItem[];
    listClass?: string;
  } = $props();
</script>

<Root bind:value loop={false}>
  <List
    class={cn(
      "inline-flex h-9 items-center justify-start gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
      listClass
    )}
  >
    {#each items as item (item.value)}
      {@const Icon = item.icon}
      <Trigger
        value={item.value}
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
      >
        {#if Icon}<Icon class="size-3.5" aria-hidden="true" />{/if}
        {item.label}
        {#if item.count !== undefined}
          <span class="font-mono text-xs tabular-nums opacity-60">{item.count}</span>
        {/if}
      </Trigger>
    {/each}
  </List>
</Root>