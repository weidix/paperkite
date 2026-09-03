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

const LINK_PATTERN = /\[([^\][]*)\]\(([^)]+)\)|((?:https?:\/\/|www\.|t\.me\/)[^\s<>"'，。；：！？、（）《》〈〉【】]+)/g;

function normalizeLinkUrl(value: string): string | undefined {
  const url = value.trim().replace(/[)\]》，。；：！？、…]+$/g, "");
  if (/^(?:https?|tg):\/\//i.test(url)) return url;
  if (/^t\.me\//i.test(url) || /^www\./i.test(url)) return `https://${url}`;
  return undefined;
}

function pushHighlighted(nodes: ReactNode[], text: string, terms: readonly string[], nextKey: () => number): void {
  if (!text) return;
  if (!terms.length) {
    nodes.push(text);
    return;
  }
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  for (const part of text.split(pattern)) {
    if (!part) continue;
    if (!matchesTerm(part, terms)) {
      nodes.push(part);
      continue;
    }
    nodes.push(
      <mark key={nextKey()} className={cn("rounded-[3px] bg-primary/15 px-0.5 text-foreground")}>
        {part}
      </mark>
    );
  }
}

function tokenize(text: string, terms: readonly string[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  const nextKey = (): number => key++;
  let cursor = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) pushHighlighted(nodes, text.slice(cursor, index), terms, nextKey);
    const [, label, markdownUrl, bareUrl] = match;
    const url = normalizeLinkUrl(markdownUrl ?? bareUrl ?? "");
    if (url === undefined) {
      pushHighlighted(nodes, match[0], terms, nextKey);
    } else {
      nodes.push(
        <a
          key={nextKey()}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {label ?? match[0]}
        </a>
      );
    }
    cursor = index + match[0].length;
  }
  if (cursor < text.length) pushHighlighted(nodes, text.slice(cursor), terms, nextKey);
  return nodes;
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
  const nodes = useMemo(() => tokenize(text ?? "", terms), [text, terms]);
  return <span className={cn("wrap-break-word", className)}>{nodes}</span>;
}