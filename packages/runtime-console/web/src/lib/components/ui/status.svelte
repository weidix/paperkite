<script lang="ts">
  import { cn } from "$lib/utils";

  type Tone = "ok" | "warn" | "bad" | "idle";

  let { tone = "idle", pulse = false }: { tone?: Tone; pulse?: boolean } = $props();

  const TONES: Record<Tone, string> = {
    ok: "bg-foreground",
    warn: "bg-chart-3",
    bad: "bg-destructive",
    idle: "bg-muted-foreground/40"
  };
</script>

<span class="relative inline-flex size-2 shrink-0" aria-hidden="true">
  <span class={cn("inline-block size-2 rounded-full", TONES[tone], pulse && "animate-pulse")}></span>
</span>