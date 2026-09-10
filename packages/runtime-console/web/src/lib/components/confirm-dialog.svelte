<script lang="ts">
  import type { Snippet } from "svelte";
  import { AlertDialog } from "bits-ui";
  import { cn } from "$lib/utils";

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel = "确认",
    cancelLabel = "取消",
    tone = "default",
    onOpenChange,
    onConfirm,
    onCancel
  }: {
    open?: boolean;
    title: string;
    description?: Snippet | string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: "default" | "destructive";
    onOpenChange?: (open: boolean) => void;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  } = $props();

  let confirmed = $state(false);

  /** 取消、遮罩与 Esc 统一走这里；确认按钮已自行标记，不触发 onCancel。 */
  function handleOpenChange(next: boolean): void {
    if (!next) {
      if (!confirmed) onCancel?.();
      confirmed = false;
    }
    onOpenChange?.(next);
  }

  /** 先交付回调，再收起；保证调用方仍能读到本次确认的目标。 */
  function confirm(): void {
    confirmed = true;
    void onConfirm?.();
    open = false;
    onOpenChange?.(false);
  }
</script>

<AlertDialog.Root bind:open onOpenChange={handleOpenChange}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay
      class="fixed inset-0 z-50 bg-black/45 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
    />
    <AlertDialog.Content
      class="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2"
    >
      <AlertDialog.Title class="font-display text-lg font-semibold leading-none">{title}</AlertDialog.Title>
      {#if description}
        <AlertDialog.Description class="text-sm text-muted-foreground">
          {#if typeof description === "string"}
            {description}
          {:else}
            {@render description()}
          {/if}
        </AlertDialog.Description>
      {/if}
      <div class="flex justify-end gap-2">
        <AlertDialog.Cancel
          class="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {cancelLabel}
        </AlertDialog.Cancel>
        <AlertDialog.Action
          class={cn(
            "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            tone === "destructive"
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          onclick={confirm}
        >
          {confirmLabel}
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
