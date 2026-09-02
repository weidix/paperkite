import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { prettyJson } from "@/lib/format";

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[0.85em] tracking-tight", className)}>{children}</span>;
}

export function CollapsibleJson({ value, label = "载荷" }: { value: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  const text = prettyJson(value);
  if (!text) return null;
  return (
    <div className="rounded-lg border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRightIcon data-icon="inline-end" className={cn("transition-transform", open && "rotate-90")} />
        {label}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">{text.length} 字符</span>
      </button>
      {open ? <pre className="max-h-72 overflow-auto border-t bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed">{text}</pre> : null}
    </div>
  );
}