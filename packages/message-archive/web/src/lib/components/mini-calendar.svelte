<script lang="ts">
  import { CalendarDate, getDayOfWeek } from "@internationalized/date";
  import { ChevronLeft, ChevronRight } from "lucide-svelte";
  import { cn } from "$lib/utils";

  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

  let {
    value = null,
    valueEnd = null,
    onpick
  }: {
    /** 起点日期（无选择时为 null）。 */
    value: CalendarDate | null;
    /** 终点高亮（无终点时为 null）。 */
    valueEnd: CalendarDate | null;
    onpick: (date: CalendarDate) => void;
  } = $props();

  /** 展示月份：初始当前月，跟随起点值所在月。 */
  const now = new Date();
  const today = new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  let visible = $state(today);

  $effect(() => {
    if (value !== null) visible = new CalendarDate(value.year, value.month, 1);
  });

  /** 6 周网格（42 格）：周一起始，前后补齐当月范围。 */
  const days = $derived(buildDays(visible));

  function buildDays(month: CalendarDate): CalendarDate[] {
    const first = new CalendarDate(month.year, month.month, 1);
    const offset = getDayOfWeek(first, "zh-CN") - 1;
    const start = first.subtract({ days: offset });
    return Array.from({ length: 42 }, (_, index) => start.add({ days: index }));
  }

  function inMonth(date: CalendarDate): boolean {
    return date.year === visible.year && date.month === visible.month;
  }

  /** 格子角色：起止端与区间内的底色/圆角互不相同，区间内不响应 hover。 */
  function roleOf(date: CalendarDate): "start" | "end" | "mid" | "single" | "normal" {
    if (value === null || valueEnd === null) {
      return value !== null && date.compare(value) === 0 ? "start" : "normal";
    }
    const [a, b] = value.compare(valueEnd) <= 0 ? [value, valueEnd] : [valueEnd, value];
    if (date.compare(a) === 0 && date.compare(b) === 0) return "single";
    if (date.compare(a) === 0) return "start";
    if (date.compare(b) === 0) return "end";
    if (date.compare(a) > 0 && date.compare(b) < 0) return "mid";
    return "normal";
  }

  function cellClass(date: CalendarDate): string {
    const base = "flex h-7 w-full items-center justify-center text-sm tabular-nums transition-colors";
    const dim = inMonth(date) ? "" : " text-muted-foreground/40";
    const hover = inMonth(date) ? " hover:bg-accent" : "";
    const todayMark = date.compare(today) === 0 ? " font-semibold" : "";
    switch (roleOf(date)) {
      case "start": return cn(base, "rounded-l-md bg-primary text-primary-foreground shadow-sm", todayMark);
      case "end": return cn(base, "rounded-r-md bg-primary text-primary-foreground shadow-sm", todayMark);
      case "single": return cn(base, "rounded-md bg-primary text-primary-foreground shadow-sm", todayMark);
      case "mid": return cn(base, "rounded-none bg-accent text-accent-foreground");
      default: return cn(base, "rounded-md", dim, hover, todayMark);
    }
  }

  function dateLabel(date: CalendarDate): string {
    return `${date.year}年${date.month}月${date.day}日`;
  }

  function prevMonth(): void {
    visible = visible.subtract({ months: 1 });
  }

  function nextMonth(): void {
    visible = visible.add({ months: 1 });
  }
</script>

<div class="p-2.5">
  <div class="flex items-center justify-between pb-2">
    <button
      type="button"
      class="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="上个月"
      onclick={prevMonth}
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
    </button>
    <span class="font-display text-sm font-semibold tracking-tight">
      {visible.year}年{visible.month}月
    </span>
    <button
      type="button"
      class="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="下个月"
      onclick={nextMonth}
    >
      <ChevronRight class="size-4" aria-hidden="true" />
    </button>
  </div>

  <div class="grid grid-cols-7">
    {#each WEEKDAYS as weekday, index (index)}
      <div class="pb-1 text-center font-mono text-[10px] font-medium text-muted-foreground">
        {weekday}
      </div>
    {/each}
  </div>

  <div class="grid grid-cols-7">
    {#each days as date (dateLabel(date))}
      <button
        type="button"
        class={cellClass(date)}
        aria-label={dateLabel(date)}
        onclick={() => onpick(date)}
      >
        {date.day}
      </button>
    {/each}
  </div>
</div>