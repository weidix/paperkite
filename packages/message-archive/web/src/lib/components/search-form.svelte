<script lang="ts">
  import { Search } from "lucide-svelte";
  import Button from "$lib/components/ui/button.svelte";
  import Label from "$lib/components/ui/label.svelte";
  import Select from "$lib/components/ui/select.svelte";
  import Spinner from "$lib/components/ui/spinner.svelte";
  import { toIsoString } from "$lib/format";
  import type { SearchQuery, TimeMode } from "$lib/types";

  let { loading, onSubmit }: { loading: boolean; onSubmit: (query: SearchQuery) => void } = $props();

  let keyword = $state("");
  let excludeKeyword = $state("");
  let chatTitle = $state("");
  let timeMode = $state<TimeMode>("include");
  let dateFrom = $state("");
  let dateTo = $state("");

  const TIME_OPTIONS = [
    { value: "include", label: "包含时间区间" },
    { value: "exclude", label: "不包含时间区间" },
    { value: "off", label: "不按时间筛选" }
  ];

  function switchTimeMode(value: string): void {
    timeMode = value as TimeMode;
  }

  $effect(() => {
    if (timeMode === "off") {
      if (dateFrom !== "") dateFrom = "";
      if (dateTo !== "") dateTo = "";
    }
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (loading) return;
    onSubmit({
      keyword: keyword.trim(),
      excludeKeyword: excludeKeyword.trim(),
      chatTitle: chatTitle.trim(),
      dateFrom: timeMode === "off" ? "" : toIsoString(dateFrom),
      dateTo: timeMode === "off" ? "" : toIsoString(dateTo),
      timeMode
    });
  }
</script>

<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
  <div class="flex flex-col gap-1.5 p-6">
    <h3 class="font-display text-base font-semibold leading-none tracking-tight">检索条件</h3>
  </div>
  <div class="p-6 pt-0">
    <form onsubmit={submit} novalidate class="flex flex-col gap-5">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label for="form-keyword">关键词</Label>
          <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            id="form-keyword"
            bind:value={keyword}
            placeholder="多个关键词用空格分隔，例如 clash 节点 香港"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="form-exclude-keyword">不显示关键词</Label>
          <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            id="form-exclude-keyword"
            bind:value={excludeKeyword}
            placeholder="多个关键词用空格分隔，例如 广告 抽奖"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="form-chat-title">群组名称</Label>
          <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" id="form-chat-title" bind:value={chatTitle} placeholder="支持模糊匹配，例如 技术群" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="form-time-mode">时间筛选</Label>
          <Select id="form-time-mode" bind:value={timeMode} options={TIME_OPTIONS} />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="form-date-from">开始时间</Label>
          <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            id="form-date-from"
            type="datetime-local"
            bind:value={dateFrom}
            disabled={timeMode === "off"}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="form-date-to">结束时间</Label>
          <input class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            id="form-date-to"
            type="datetime-local"
            bind:value={dateTo}
            disabled={timeMode === "off"}
          />
        </div>
      </div>
      <Button type="submit" class={loading ? "cursor-wait" : undefined}>
        {#if loading}
          <Spinner class="size-4" />
        {:else}
          <Search class="size-4" aria-hidden="true" />
        {/if}
        查询
      </Button>
    </form>
  </div>
</div>