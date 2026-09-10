<script lang="ts">
  import { Switch } from "bits-ui";
  import { cn } from "$lib/utils";

  const { Root, Thumb } = Switch;

  let {
    checked = $bindable(false),
    controlled = false,
    disabled = false,
    onCheckedChange,
    class: className = "",
    id,
    onclick,
    "aria-label": ariaLabel
  }: {
    checked?: boolean;
    /** 受控模式：状态只由父级驱动，点击不回写本地外观。 */
    controlled?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    class?: string;
    id?: string;
    onclick?: (event: MouseEvent) => void;
    "aria-label"?: string;
  } = $props();

  function handleChange(next: boolean): void {
    if (!controlled) checked = next;
    onCheckedChange?.(next);
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