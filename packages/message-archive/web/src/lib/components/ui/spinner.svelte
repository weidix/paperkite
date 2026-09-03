<script lang="ts">
  import { Loader2 } from "lucide-svelte";
  import { cn } from "$lib/utils";

  let { class: className = "" }: { class?: string } = $props();
</script>

<Loader2 class={cn("size-4 animate-spin", className)} aria-label="加载中" />