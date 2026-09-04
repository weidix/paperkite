<script lang="ts">
  import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock } from "lucide-svelte";
  import { DatePicker, Calendar } from "bits-ui";
  import { CalendarDate, type DateValue } from "@internationalized/date";
  import { cn } from "$lib/utils";
  import Button from "$lib/components/button.svelte";

  const { Root, Trigger, Portal, Content } = DatePicker;

  let {
    value = $bindable(""),
    placeholder = "选择日期",
    onvaluechange,
    disabled = false,
    triggerClass = "",
    class: className = "",
    "aria-label": ariaLabel
  }: {
    value?: string;
    placeholder?: string;
    onvaluechange?: (value: string | undefined) => void;
    disabled?: boolean;
    triggerClass?: string;
    class?: string;
    "aria-label"?: string;
  } = $props();

  let open = $state(false);
  let pendingDate = $state<CalendarDate | null>(null);
  let pendingTime = $state("");

  /** 值与 URL 均以本地日期时间字符串表达：YYYY-MM-DD[ HH:mm[:ss]]。 */
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/;
  const label = $derived(fmtLabel(value));

  $effect(() => {
    if (!open) return;
    pendingDate = toCalendarDate(value) ?? null;
    pendingTime = timePart(value);
  });

  function handleDateSelect(next: DateValue | undefined): void {
    pendingDate = next ? new CalendarDate(next.year, next.month, next.day) : null;
  }

  function commit(): void {
    if (!pendingDate) {
      clear();
      return;
    }
    value = storageOf(pendingDate, pendingTime);
    onvaluechange?.(value || undefined);
    open = false;
  }

  function clear(): void {
    value = "";
    onvaluechange?.(undefined);
    open = false;
  }

  function storageOf(date: CalendarDate, time: string): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    const day = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    return time.trim() ? `${day} ${time.trim()}` : day;
  }

  function toCalendarDate(value: string): CalendarDate | undefined {
    const match = DATE_RE.exec(value);
    if (!match) return undefined;
    try {
      return new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    } catch {
      return undefined;
    }
  }

  function timePart(value: string): string {
    const match = DATE_RE.exec(value);
    if (!match?.[4]) return "";
    return match[6] ? `${match[4]}:${match[5]}:${match[6]}` : `${match[4]}:${match[5]}`;
  }

  function fmtLabel(value: string): string {
    const match = DATE_RE.exec(value);
    if (!match) return "";
    const pad = (n: number): string => String(n).padStart(2, "0");
    const day = `${match[1]}/${match[2]}/${match[3]}`;
    const time = match[4] ? `${match[4]}:${match[5]}${match[6] ? `:${match[6]}` : ""}` : "";
    return time ? `${day} ${time}` : day;
  }
</script>

<Root
  locale="zh-CN"
  weekStartsOn={1}
  value={pendingDate ?? undefined}
  onValueChange={handleDateSelect}
  {disabled}
  closeOnDateSelect={false}
  bind:open
  preventDeselect={false}
>
  <Trigger
    aria-label={ariaLabel}
    class={cn(
      "inline-flex h-9 touch-none items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors data-[placeholder]:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      triggerClass,
      className
    )}
  >
    <span class="truncate">{label || placeholder}</span>
    <CalendarIcon class="ml-auto size-3.5 shrink-0 opacity-50" aria-hidden="true" />
  </Trigger>
  <Portal>
    <Content
      class="z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none"
      sideOffset={4}
    >
      <DatePicker.Calendar>
        {#snippet children({ months, weekdays })}
          <div class="w-64">
            <Calendar.Header class="flex items-center justify-between pb-2">
              <Calendar.PrevButton
                class="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="上个月"
              >
                <ChevronLeft class="size-4" aria-hidden="true" />
              </Calendar.PrevButton>
              <Calendar.Heading class="font-display text-sm font-semibold tracking-tight" />
              <Calendar.NextButton
                class="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="下个月"
              >
                <ChevronRight class="size-4" aria-hidden="true" />
              </Calendar.NextButton>
            </Calendar.Header>
            <Calendar.Grid class="w-full border-collapse">
              <Calendar.GridHead>
                {#each weekdays as weekday (weekday)}
                  <Calendar.HeadCell class="pb-1 text-center font-mono text-[10px] font-medium text-muted-foreground">
                    {weekday}
                  </Calendar.HeadCell>
                {/each}
              </Calendar.GridHead>
              <Calendar.GridBody>
                {#each months as month}
                  {#each month.weeks as weekDates}
                    <Calendar.GridRow class="h-9">
                      {#each weekDates as date}
                        <Calendar.Cell {date} month={month.value}>
                          {#snippet children({ selected, unavailable, disabled: dayDisabled })}
                            <Calendar.Day
                              class={cn(
                                "flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors data-[today]:font-semibold data-[outside-month]:text-muted-foreground/40 hover:data-[outside-month]:bg-transparent",
                                selected
                                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                                  : dayDisabled
                                    ? "pointer-events-none opacity-40"
                                    : unavailable
                                      ? "pointer-events-none opacity-40"
                                      : "hover:bg-accent"
                              )}
                            />
                          {/snippet}
                        </Calendar.Cell>
                      {/each}
                    </Calendar.GridRow>
                  {/each}
                {/each}
              </Calendar.GridBody>
            </Calendar.Grid>
          </div>
        {/snippet}
      </DatePicker.Calendar>
      <div class="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
        <Clock class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="time"
          step="1"
          bind:value={pendingTime}
          disabled={pendingDate === null}
          class="h-8 w-[7.5rem] rounded-md border border-input bg-background px-2 font-mono text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label="时间（精确到秒）"
        />
        <div class="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onclick={clear}>清除</Button>
          <Button size="sm" onclick={commit}>确定</Button>
        </div>
      </div>
    </Content>
  </Portal>
</Root>