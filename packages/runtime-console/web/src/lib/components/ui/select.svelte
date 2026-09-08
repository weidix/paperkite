<script lang="ts">
  import { Check, ChevronDown, ChevronUp } from "lucide-svelte";
  import { Select } from "bits-ui";
  import { cn } from "$lib/utils";

  const { Root, Trigger, Value, Portal, Content, Viewport, Item, ScrollUpButton, ScrollDownButton } = Select;

  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  let {
    value = $bindable(""),
    placeholder = "请选择",
    disabled = false,
    options = [],
    triggerClass = "",
    contentClass = "",
    class: className = "",
    id,
    "aria-label": ariaLabel
  }: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    options?: SelectOption[];
    triggerClass?: string;
    contentClass?: string;
    class?: string;
    id?: string;
    "aria-label"?: string;
  } = $props();
</script>

<Root items={options} bind:value {disabled} type="single">
  <Trigger
    {id}
    aria-label={ariaLabel}
    class={cn(
      "inline-flex h-9 w-full touch-none items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&[data-state=open]>svg]:rotate-180",
      triggerClass,
      className
    )}
  >
    <Value {placeholder} class="truncate" />
    <ChevronDown class="ml-auto size-4 shrink-0 opacity-50 transition-transform duration-200" aria-hidden="true" />
  </Trigger>
  <Portal>
    <Content
      class={cn(
        "z-50 w-[var(--bits-select-anchor-width)] min-w-[var(--bits-select-anchor-width)] max-h-[var(--bits-select-content-available-height)] select-none overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        contentClass
      )}
      sideOffset={4}
    >
      <ScrollUpButton class="flex w-full items-center justify-center py-0.5 text-muted-foreground" aria-label="向上滚动">
        <ChevronUp class="size-3.5" aria-hidden="true" />
      </ScrollUpButton>
      <Viewport class="max-h-[var(--bits-select-content-available-height)] overflow-y-auto p-1">
        {#each options as option (option.value)}
          <Item
            value={option.value}
            label={option.label}
            disabled={option.disabled}
            class="relative flex h-9 w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            {#snippet children({ selected })}
              <span class="truncate">{option.label}</span>
              {#if selected}
                <Check class="ml-auto size-4 shrink-0" aria-hidden="true" />
              {/if}
            {/snippet}
          </Item>
        {/each}
      </Viewport>
      <ScrollDownButton class="flex w-full items-center justify-center py-0.5 text-muted-foreground" aria-label="向下滚动">
        <ChevronDown class="size-3.5" aria-hidden="true" />
      </ScrollDownButton>
    </Content>
  </Portal>
</Root>