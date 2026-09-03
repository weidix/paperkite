<script lang="ts">
  import { X } from "lucide-svelte";
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  const { Root, Trigger, Portal, Overlay, Content, Title, Description, Close } = Dialog;

  let {
    open = $bindable(false),
    onOpenChange,
    title,
    description,
    children,
    trigger,
    overlayClass = "",
    contentClass = "",
    hideClose = false
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title?: string;
    description?: string;
    children?: Snippet;
    trigger?: Snippet;
    overlayClass?: string;
    contentClass?: string;
    hideClose?: boolean;
  } = $props();
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
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2",
        contentClass
      )}
    >
      {#if title}
        <Title class="font-display text-lg font-semibold leading-none">{title}</Title>
      {/if}
      {#if description}
        <Description class="text-sm text-muted-foreground">{description}</Description>
      {/if}
      {#if children}{@render children()}{/if}
      {#if !hideClose}
        <Close
          class="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="关闭"
        >
          <X class="size-4" aria-hidden="true" />
        </Close>
      {/if}
    </Content>
  </Portal>
</Root>