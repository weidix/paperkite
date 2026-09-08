<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { json } from "@codemirror/lang-json";
  import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
  import { linter } from "@codemirror/lint";
  import { onMount } from "svelte";

  let {
    value = $bindable(""),
    id,
    placeholderText = "{}",
    minHeight = "min-h-24",
    invalid = false
  }: {
    value?: string;
    id?: string;
    placeholderText?: string;
    minHeight?: string;
    invalid?: boolean;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined = $state();

  const jsonLinter = linter((view) => {
    const doc = view.state.doc;
    try {
      JSON.parse(doc.toString());
      return [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [{ from: 0, to: doc.length, severity: "error" as const, message }];
    }
  });

  onMount(() => {
    if (!container) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        placeholder(placeholderText),
        json(),
        jsonLinter,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            value = update.state.doc.toString();
          }
        })
      ]
    });
    view = new EditorView({ state, parent: container });
  });

  $effect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      });
    }
  });
</script>

<div
  {id}
  bind:this={container}
  class="overflow-hidden rounded-md border bg-background {minHeight} {invalid ? 'border-destructive' : 'border-input'}"
  style="--cm-bg: var(--background);"
></div>

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
    max-height: 16rem;
  }
  div :global(.cm-gutters) {
    background: var(--cm-bg);
    color: var(--muted-foreground);
    border-right: 1px solid var(--border);
  }
  div :global(.cm-activeLine) {
    background: color-mix(in oklab, var(--muted) 45%, transparent);
  }
  div :global(.cm-activeLineGutter) {
    background: transparent;
  }
  div :global(.cm-tooltip) {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card);
    color: var(--foreground);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
  }
  div :global(.cm-tooltip-lint) {
    padding: 4px 8px;
  }
</style>
