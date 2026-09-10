<script lang="ts">
  import { cn } from "$lib/utils";

  type Tone = "ok" | "warn" | "bad" | "idle";

  let { tone = "idle", pulse = false }: { tone?: Tone; pulse?: boolean } = $props();

  const TONES: Record<Tone, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    idle: "bg-muted-foreground/40"
  };
</script>

<span class="relative inline-flex size-2.5 shrink-0 items-center justify-center" aria-hidden="true">
  {#if pulse}
    <span class={cn("status-breathe absolute inset-0 rounded-full", TONES[tone])}></span>
  {/if}
  <span class={cn("relative inline-block size-2.5 rounded-full", TONES[tone])}></span>
</span>
