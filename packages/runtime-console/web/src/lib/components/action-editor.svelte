<script lang="ts">
  import { Trash2, Wand2 } from "lucide-svelte";
  import type { ActionDraft } from "$lib/action-draft";
  import CapabilityField from "$lib/components/capability-field.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Label from "$lib/components/ui/label.svelte";
  import JsonEditor from "$lib/components/json-editor.svelte";
  import { tryFormatJson } from "$lib/format";

  let {
    draft,
    heading = "动作",
    removable = false,
    bordered = true,
    onRemove
  }: {
    draft: ActionDraft;
    heading?: string;
    removable?: boolean;
    bordered?: boolean;
    onRemove?: () => void;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 8);

  function formatConfig(): void {
    const result = tryFormatJson(draft.configText);
    if (result.error) {
      draft.configError = result.error;
      return;
    }
    draft.configText = result.formatted ?? "";
    draft.configError = null;
  }
</script>

<div class={bordered ? "rounded-lg border bg-muted/20 p-3" : ""}>
  <div class="mb-3 flex items-center gap-2">
    <span class="text-xs font-medium text-muted-foreground">{heading}</span>
    <span class="flex-1"></span>
    {#if removable}
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        onclick={onRemove}
        aria-label={`移除 ${heading}`}
        title="移除"
      >
        <Trash2 class="size-3.5" aria-hidden="true" />
      </Button>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="col-span-2">
      <CapabilityField bind:value={draft.capability} id={`${uid}-cap`} label="能力 *" />
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for={`${uid}-session`}>会话（可选）</Label>
      <input
        id={`${uid}-session`}
        bind:value={draft.session}
        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
        placeholder="留空沿用上层会话"
        spellcheck={false}
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for={`${uid}-hook`}>hook（可选）</Label>
      <input
        id={`${uid}-hook`}
        bind:value={draft.hook}
        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
        placeholder="hooks/xxx.ts"
        spellcheck={false}
      />
    </div>
    <div class="col-span-2 flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <Label for={`${uid}-config`}>config（JSON，可选）</Label>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-xs"
          onclick={formatConfig}
          title="格式化 JSON"
        >
          <Wand2 class="size-3" aria-hidden="true" />
          格式化
        </Button>
      </div>
      <JsonEditor
        id={`${uid}-config`}
        bind:value={draft.configText}
        placeholderText={"{}"}
        minHeight="min-h-20"
        invalid={draft.configError !== null}
      />
      {#if draft.configError}
        <p class="text-xs text-destructive">{draft.configError}</p>
      {/if}
    </div>
  </div>
</div>
