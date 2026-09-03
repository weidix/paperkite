<script lang="ts">
  import { cn } from "$lib/utils";
  import Status from "$lib/components/ui/status.svelte";

  let { label, tone = "ok" }: { label: string; tone?: "ok" | "bad" } = $props();
</script>

<span
  class={cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
    tone === "ok" ? "border-muted-foreground/30 bg-muted/50 text-foreground" : "border-destructive/40 bg-destructive/10 text-destructive"
  )}
>
  <Status tone={tone === "ok" ? "ok" : "bad"} pulse={tone === "ok"} />
  {label}
</span>