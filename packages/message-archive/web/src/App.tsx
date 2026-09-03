import { useCallback, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextPanel } from "@/components/context-panel";
import { MediaLightbox } from "@/components/media-lightbox";
import { ResultsTable } from "@/components/results-table";
import { SearchForm } from "@/components/search-form";
import { api } from "@/lib/api";
import { errorText } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { ContextTarget, LightboxItem, SearchQuery, SearchRow } from "@/lib/types";

const PAGE_SIZE = 50;

export default function App() {
  const { theme, toggle } = useTheme();
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [items, setItems] = useState<readonly SearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<ContextTarget | null>(null);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  const runSearch = useCallback(async (nextQuery: SearchQuery, nextPage: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.search({
        ...nextQuery,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE
      });
      setQuery(nextQuery);
      setItems(payload.items);
      setTotal(payload.total);
      setPage(nextPage);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const submitSearch = (nextQuery: SearchQuery): void => {
    void runSearch(nextQuery, 1);
  };

  const goPrev = (): void => {
    if (query && page > 1 && !loading) void runSearch(query, page - 1);
  };

  const goNext = (): void => {
    if (query && !loading) void runSearch(query, page + 1);
  };

  const openContext = (row: SearchRow): void => {
    setContext({ rowId: row.id, keyword: query?.keyword ?? "" });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <span className="block size-3 rotate-45 rounded-[3px] border-2 border-primary-foreground" aria-hidden="true" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-sm font-semibold tracking-tight">纸鸢</span>
          <span className="text-[11px] text-muted-foreground">消息检索</span>
        </div>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={toggle} aria-label="切换主题">
          {theme === "dark" ? <SunIcon data-icon="inline-end" /> : <MoonIcon data-icon="inline-end" />}
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          <div className="lg:sticky lg:top-6">
            <SearchForm loading={loading} onSubmit={submitSearch} />
          </div>
          <ResultsTable
            query={query}
            items={items}
            total={total}
            page={page}
            loading={loading}
            error={error}
            onOpenContext={openContext}
            onOpenMedia={setLightbox}
            onPrev={goPrev}
            onNext={goNext}
          />
        </div>
      </main>

      <ContextPanel
        target={context}
        open={context !== null}
        onOpenChange={(open) => !open && setContext(null)}
        onOpenMedia={setLightbox}
      />
      <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}