<script lang="ts">
  import { cn } from "$lib/utils";

  export interface HighlightToken {
    readonly kind: "text" | "mark" | "link";
    readonly text: string;
    readonly url?: string;
  }

  function escapeRegExp(text: string): string {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightTerms(keyword: string): string[] {
    return Array.from(
      new Set(
        keyword
          .split(/\s+/)
          .map((term) => term.trim())
          .filter(Boolean)
      )
    ).sort((left, right) => right.length - left.length);
  }

  const LINK_PATTERN = /\[([^\][]*)\]\(([^)]+)\)|((?:https?:\/\/|www\.|t\.me\/)[^\s<>"'，。；：！？、（）《》〈〉【】]+)/g;

  function normalizeLinkUrl(value: string): string | undefined {
    const url = value.trim().replace(/[)\]》，。；：！？、…]+$/g, "");
    if (/^(?:https?|tg):\/\//i.test(url)) return url;
    if (/^t\.me\//i.test(url) || /^www\./i.test(url)) return `https://${url}`;
    return undefined;
  }

  function matchesTerm(part: string, terms: readonly string[]): boolean {
    return terms.some(
      (term) => term.localeCompare(part, undefined, { sensitivity: "accent" }) === 0 || term.toLowerCase() === part.toLowerCase()
    );
  }

  function tokenize(text: string, terms: readonly string[]): HighlightToken[] {
    const tokens: HighlightToken[] = [];
    const pushHighlighted = (part: string): void => {
      if (!part) return;
      if (!terms.length) {
        tokens.push({ kind: "text", text: part });
        return;
      }
      const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
      for (const piece of part.split(pattern)) {
        if (!piece) continue;
        tokens.push(matchesTerm(piece, terms) ? { kind: "mark", text: piece } : { kind: "text", text: piece });
      }
    };
    let cursor = 0;
    for (const match of text.matchAll(LINK_PATTERN)) {
      const index = match.index ?? 0;
      if (index > cursor) pushHighlighted(text.slice(cursor, index));
      const [, label, markdownUrl, bareUrl] = match;
      const url = normalizeLinkUrl(markdownUrl ?? bareUrl ?? "");
      if (url === undefined) {
        pushHighlighted(match[0]);
      } else {
        tokens.push({ kind: "link", text: label ?? match[0], url });
      }
      cursor = index + match[0].length;
    }
    if (cursor < text.length) pushHighlighted(text.slice(cursor));
    return tokens;
  }

  let { text, keyword, class: className = "" }: { text: string | null | undefined; keyword: string; class?: string } = $props();

  const tokens = $derived(tokenize(text ?? "", highlightTerms(keyword)));
</script>

<span class={cn("break-words", className)}>
  {#each tokens as token, index (index)}
    {#if token.kind === "mark"}
      <mark class="rounded-[3px] bg-foreground/12 px-0.5 text-foreground">{token.text}</mark>
    {:else if token.kind === "link"}
      <a
        href={token.url}
        target="_blank"
        rel="noreferrer"
        class="break-all text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground"
      >
        {token.text}
      </a>
    {:else}
      {token.text}
    {/if}
  {/each}
</span>