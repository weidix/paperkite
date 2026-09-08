<script lang="ts">
  import { List } from "lucide-svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Label from "$lib/components/ui/label.svelte";
  import Select from "$lib/components/ui/select.svelte";
  import { errorText } from "$lib/format";
  import { actionCapabilities, loadPlugins } from "$lib/plugins.svelte";
  import type { PluginInfo } from "$lib/runtime";

  const MANUAL_OPTION = "__manual__";

  let {
    value = $bindable(""),
    id,
    label = "能力",
    placeholder = "选择能力…"
  }: {
    value?: string;
    id?: string;
    label?: string;
    placeholder?: string;
  } = $props();

  let plugins = $state<readonly PluginInfo[] | null>(null);
  let pluginError = $state(false);
  let mode = $state<"pick" | "type">("pick");
  let inputEl: HTMLInputElement | null = $state(null);

  $effect(() => {
    let cancelled = false;
    loadPlugins()
      .then((items) => {
        if (!cancelled) plugins = items;
      })
      .catch(() => {
        if (!cancelled) {
          plugins = [];
          pluginError = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  const capabilities = $derived(actionCapabilities(plugins ?? []));

  $effect(() => {
    if (value === MANUAL_OPTION) {
      value = "";
      mode = "type";
      queueMicrotask(() => inputEl?.focus());
    }
  });

  $effect(() => {
    if (capabilities.length > 0 && value !== "" && !capabilities.includes(value) && mode === "pick") {
      mode = "type";
    }
  });

  const options = $derived([
    ...capabilities.map((name) => ({ value: name, label: name })),
    { value: MANUAL_OPTION, label: "手动输入能力名…" }
  ]);
</script>

<div class="flex flex-col gap-1.5">
  <Label for={id}>{label}</Label>
  {#if mode === "pick"}
    <Select
      {id}
      bind:value
      options={options}
      placeholder={plugins ? placeholder : "读取能力清单…"}
      triggerClass="w-full font-mono"
      disabled={!plugins}
    />
  {:else}
    <div class="flex items-center gap-2">
      <input
        bind:this={inputEl}
        {id}
        bind:value
        class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
        placeholder="如 notify.bark"
        spellcheck={false}
      />
      <Button
        variant="outline"
        size="icon"
        onclick={() => (mode = "pick")}
        aria-label="从列表选择能力"
        title="从列表选择能力"
        disabled={!plugins}
      >
        <List class="size-4" aria-hidden="true" />
      </Button>
    </div>
  {/if}
  {#if pluginError}
    <p class="text-xs text-destructive">能力清单读取失败，可手动输入能力名</p>
  {/if}
</div>
