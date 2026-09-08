<script lang="ts">
  import { CalendarRange } from "lucide-svelte";
  import { CalendarDate } from "@internationalized/date";
  import { cn } from "$lib/utils";
  import { fmtLocalDate, fmtLocalRange } from "$lib/format";
  import Button from "$lib/components/button.svelte";
  import MiniCalendar from "$lib/components/mini-calendar.svelte";
  import type { TimeMode } from "$lib/model";

  /** 本地日期时间字符串（YYYY-MM-DD[ HH:mm[:ss]]）与日历日期互转。 */
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/;

  function toCalendarDate(value: string): CalendarDate | null {
    const match = DATE_RE.exec(value);
    if (!match) return null;
    try {
      return new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    } catch {
      return null;
    }
  }

  function fmtDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function timeOf(date: Date): string {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  }

  /** 预设：以本地时间表达（今天 00:00:00 – 23:59:59；近 N 天为 today-(N-1) 起）。 */
  function preset(label: string, daysBack: number): { label: string; from: string; to: string } {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { label, from: `${fmtDay(from)} ${timeOf(from)}`, to: `${fmtDay(to)} ${timeOf(to)}` };
  }

  const PRESETS = [preset("今天", 0), preset("昨天", 1), preset("近 7 天", 6), preset("近 30 天", 29)];

  let {
    from = $bindable(""),
    to = $bindable(""),
    mode = $bindable<TimeMode>("include"),
    onchange
  }: {
    from?: string;
    to?: string;
    mode?: TimeMode;
    /** 预设/开关即时生效；手动点选经应用按钮提交。 */
    onchange?: () => void;
  } = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let pendingFrom = $state<string | null>(null);
  let pendingTo = $state<string | null>(null);
  let pendingMode = $state<TimeMode>("include");

  const startDate = $derived(toCalendarDate(pendingFrom ?? ""));
  const endDate = $derived(toCalendarDate(pendingTo ?? ""));
  const hint = $derived(hintText());
  const applyDisabled = $derived(pendingFrom === null && pendingTo === null);
  /** 模式按钮可用性：有日期即可选（待选或已选）。 */
  const modeEnabled = $derived(pendingFrom !== null || pendingTo !== null || from !== "" || to !== "");

  $effect(() => {
    if (!open) return;
    pendingFrom = from || null;
    pendingTo = to || null;
    pendingMode = mode === "off" ? "include" : mode;
  });

  /** 单击/双击选择：第二次早于起点则改起点重等终点；完整区间后点击清空重选。 */
  function pick(date: CalendarDate): void {
    const value = new CalendarDate(date.year, date.month, date.day);
    if (pendingFrom === null) {
      pendingFrom = storageOf(value);
      pendingTo = null;
      return;
    }
    if (pendingTo === null) {
      const start = toCalendarDate(pendingFrom);
      if (start !== null && value.compare(start) < 0) {
        pendingFrom = storageOf(value);
        return;
      }
      pendingTo = storageOf(value);
      return;
    }
    pendingFrom = storageOf(value);
    pendingTo = null;
  }

  function storageOf(date: CalendarDate): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    const start = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    return `${start} 00:00:00`;
  }

  function commitPreset(item: { from: string; to: string }): void {
    from = item.from;
    to = item.to;
    onchange?.();
    open = false;
  }

  /** 应用待选区间与模式：仅当两侧都有待选值才可用。 */
  function apply(): void {
    from = pendingFrom ?? "";
    to = pendingTo ?? "";
    mode = pendingMode;
    onchange?.();
    open = false;
  }

  /** 清除：立即生效并关闭；无区间时模式回到区间内。 */
  function clear(): void {
    pendingFrom = null;
    pendingTo = null;
    pendingMode = "include";
    from = "";
    to = "";
    mode = "include";
    onchange?.();
    open = false;
  }

  /** 切换区间模式：有待选日期时随应用一并提交，否则立即生效。 */
  function setMode(next: TimeMode): void {
    pendingMode = next;
    if (pendingFrom === null && pendingTo === null) {
      mode = next;
      onchange?.();
    }
  }

  function hintText(): string {
    if (pendingFrom === null) return "先点选起始日期，再点选结束日期";
    if (pendingTo === null) return `${fmtLocalDate(pendingFrom)} 起 · 再点选结束日期`;
    return `${fmtLocalDate(pendingFrom)} – ${fmtLocalDate(pendingTo)}`;
  }

  const label = $derived(fmtLocalRange(from, to));

  $effect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") open = false;
    };
    const onDown = (event: PointerEvent): void => {
      if (rootEl !== null && !rootEl.contains(event.target as Node)) open = false;
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
    };
  });
</script>

<div bind:this={rootEl} class="relative shrink-0">
  <button
    type="button"
    class={cn(
      "inline-flex h-9 w-36 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      (from !== "" || to !== "") ? "text-foreground" : "text-muted-foreground"
    )}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label="日期范围"
    onclick={() => (open = !open)}
  >
    <CalendarRange class="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
    <span class="max-w-36 truncate">{label || "全部时间"}</span>
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full z-30 mt-1.5 w-80 rounded-md border bg-popover p-2.5 text-popover-foreground shadow-md"
      role="dialog"
      aria-label="日期范围"
    >
      <div class="grid grid-cols-4 gap-1">
        {#each PRESETS as item (item.label)}
          <button
            type="button"
            class={cn(
              "h-8 rounded-md px-1 font-mono text-[11px] transition-colors",
              from === item.from && to === item.to
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/70"
            )}
            onclick={() => commitPreset(item)}
          >
            {item.label}
          </button>
        {/each}
      </div>

      <MiniCalendar value={startDate} valueEnd={endDate} onpick={pick} />

      <p class="px-1.5 pb-1 text-center font-mono text-[11px] text-muted-foreground" aria-live="polite">
        {hint}
      </p>

      <div class="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div class="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
          <button
            type="button"
            class={cn(
              "inline-flex h-7 items-center rounded px-2 font-mono text-[11px] transition-colors",
              pendingMode === "include" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
            aria-pressed={pendingMode === "include"}
            disabled={!modeEnabled}
            onclick={() => setMode("include")}
          >
            区间内
          </button>
          <button
            type="button"
            class={cn(
              "inline-flex h-7 items-center rounded px-2 font-mono text-[11px] transition-colors",
              pendingMode === "exclude" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
            aria-pressed={pendingMode === "exclude"}
            disabled={!modeEnabled}
            onclick={() => setMode("exclude")}
          >
            区间外
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onclick={clear}>清除</Button>
          <Button size="sm" disabled={applyDisabled} onclick={apply}>应用</Button>
        </div>
      </div>
    </div>
  {/if}
</div>