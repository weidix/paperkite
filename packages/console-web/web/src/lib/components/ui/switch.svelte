<script lang="ts">
  import { Switch } from "bits-ui";
  import { cn } from "$lib/utils";

  const { Root, Thumb } = Switch;

  let {
    checked = $bindable(false),
    disabled = false,
    onCheckedChange,
    class: className = "",
    id,
    onclick,
    "aria-label": ariaLabel
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    class?: string;
    id?: string;
    onclick?: (event: MouseEvent) => void;
    "aria-label"?: string;
  } = $props();

  function handleChange(next: boolean): void {
    onCheckedChange?.(next);
    checked = next;
  }
</script>

<Root
  checked={checked}
  onCheckedChange={handleChange}
  {disabled}
  {id}
  aria-label={ariaLabel}
  onclick={(event) => onclick?.(event)}
  class={cn(
    "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
    className
  )}
>
  <Thumb
    class="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
  />
</Root>