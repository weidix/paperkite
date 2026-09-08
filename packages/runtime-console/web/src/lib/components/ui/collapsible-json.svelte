<script lang="ts">
  import { Check, ChevronRight, Copy } from "lucide-svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { json } from "@codemirror/lang-json";
  import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
  import { onDestroy } from "svelte";
  import { cn } from "$lib/utils";
  import { prettyJson } from "$lib/format";

  let { value, label = "载荷" }: { value: unknown; label?: string } = $props();

  let open = $state(false);
  let copied = $state(false);
  let container: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined = $state();
  const text = $derived(prettyJson(value));

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // 剪贴板不可用时静默失败，用户仍可手动框选复制
    }
  }

  $effect(() => {
    if (!view && open && container) {
      const state = EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          json(),
          EditorView.lineWrapping
        ]
      });
      view = new EditorView({ state, parent: container });
    } else if (view && text !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text }
      });
    }
  });

  onDestroy(() => {
    view?.destroy();
    view = undefined;
  });
</script>

{#if text}
  <div class="overflow-hidden rounded-lg border bg-muted/40">
    <div class="flex items-center gap-1">
      <button
        type="button"
        onclick={() => (open = !open)}
        class="flex min-w-0 flex-1 items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <ChevronRight class={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden="true" />
        {label}
        <span class="ml-auto font-mono text-[10px] text-muted-foreground/70">{text.length} 字符</span>
      </button>
      <button
        type="button"
        onclick={() => void copyAll()}
        class="flex shrink-0 items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="复制全部内容"
      >
        {#if copied}
          <Check class="size-3.5 text-emerald-600" aria-hidden="true" />
          已复制
        {:else}
          <Copy class="size-3.5" aria-hidden="true" />
          复制
        {/if}
      </button>
    </div>
    {#if open}
      <div
        bind:this={container}
        class="border-t bg-background/60"
        style="--cm-bg: transparent;"
        role="img"
        aria-label={`${label} 内容`}
      ></div>
    {/if}
  </div>
{/if}

<style>
  div :global(.cm-editor) {
    background: var(--cm-bg);
    color: var(--foreground);
  }
  div :global(.cm-editor.cm-focused) {
    outline: none;
  }
  div :global(.cm-scroller) {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.6;
    max-height: 18rem;
    outline: none;
  }
  div :global(.cm-line) {
    padding: 0 12px;
  }
</style>