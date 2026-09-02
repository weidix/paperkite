import { cn } from "@/lib/utils";

export function StatusDot({ tone, pulse = false }: { tone: "ok" | "warn" | "bad" | "idle"; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden="true">
      <span
        className={cn(
          "inline-block size-2 rounded-full",
          tone === "ok" && "bg-chart-4",
          tone === "warn" && "bg-chart-3",
          tone === "bad" && "bg-destructive",
          tone === "idle" && "bg-muted-foreground/50",
          pulse && "animate-pulse"
        )}
      />
    </span>
  );
}

export function LiveBadge({ label, tone }: { label: string; tone: "ok" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone === "ok" ? "border-chart-4/40 bg-chart-4/10 text-chart-4" : "border-destructive/40 bg-destructive/10 text-destructive"
      )}
    >
      <StatusDot tone={tone === "ok" ? "ok" : "bad"} pulse={tone === "ok"} />
      {label}
    </span>
  );
}