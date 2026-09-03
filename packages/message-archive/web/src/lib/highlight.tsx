import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function highlightTerms(keyword: string): string[] {
  return Array.from(
    new Set(
      keyword
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => right.length - left.length);
}

function escapeRegExp(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesTerm(part: string, terms: readonly string[]): boolean {
  return terms.some(
    (term) => term.localeCompare(part, undefined, { sensitivity: "accent" }) === 0 || term.toLowerCase() === part.toLowerCase()
  );
}

function splitByTerms(text: string, terms: readonly string[]): ReactNode[] {
  if (!terms.length || !text) return [text];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, index) => {
    if (!part || !matchesTerm(part, terms)) return part;
    return (
      <mark key={index} className={cn("rounded-[3px] bg-primary/15 px-0.5 text-foreground")}>
        {part}
      </mark>
    );
  });
}

export function HighlightedText({
  text,
  keyword,
  className
}: {
  readonly text: string | null | undefined;
  readonly keyword: string;
  readonly className?: string;
}) {
  const terms = useMemo(() => highlightTerms(keyword), [keyword]);
  return <span className={cn("wrap-break-word", className)}>{splitByTerms(text ?? "", terms)}</span>;
}