<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  const { Root, Trigger, Portal, Overlay, Content, Title, Description } = Dialog;

  type Side = "left" | "right";

  let {
    open = $bindable(false),
    onOpenChange,
    side = "right",
    title,
    description,
    children,
    trigger,
    overlayClass = "",
    contentClass = ""
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    side?: Side;
    title?: string;
    description?: string;
    children?: Snippet;
    trigger?: Snippet;
    overlayClass?: string;
    contentClass?: string;
  } = $props();

  const POSITION: Record<Side, string> = {
    left: "left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
    right: "right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
  };
</script>

<Root bind:open {onOpenChange}>
  {#if trigger}{@render trigger()}{/if}
  <Portal>
    <Overlay
      class={cn(
        "fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        overlayClass
      )}
    />
    <Content
      class={cn(
        "fixed inset-y-0 z-50 flex w-full flex-col bg-card shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out sm:max-w-sm",
        POSITION[side],
        contentClass
      )}
    >
      {#if title}
        <div class="flex flex-col gap-1 border-b px-4 py-3">
          <Title class="font-display text-base font-semibold">{title}</Title>
          {#if description}
            <Description class="text-xs text-muted-foreground">{description}</Description>
          {/if}
        </div>
      {/if}
      {#if children}{@render children()}{/if}
    </Content>
  </Portal>
</Root>