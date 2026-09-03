<script lang="ts">
  import SearchForm from "$lib/components/search-form.svelte";
  import ResultsTable from "$lib/components/results-table.svelte";
  import ContextPanel from "$lib/components/context-panel.svelte";
  import MediaLightbox from "$lib/components/media-lightbox.svelte";
  import { api } from "$lib/api";
  import { errorText } from "$lib/format";
  import type { ContextTarget, LightboxItem, SearchQuery, SearchRow } from "$lib/types";

  const PAGE_SIZE = 50;

  let query: SearchQuery | null = $state(null);
  let items: readonly SearchRow[] = $state([]);
  let total = $state(0);
  let page = $state(1);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let context: ContextTarget | null = $state(null);
  let contextOpen = $state(false);
  let lightbox: LightboxItem | null = $state(null);

  async function runSearch(nextQuery: SearchQuery, nextPage: number): Promise<void> {
    loading = true;
    error = null;
    try {
      const payload = await api.search({
        ...nextQuery,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE
      });
      query = nextQuery;
      items = payload.items;
      total = payload.total;
      page = nextPage;
    } catch (cause) {
      error = errorText(cause);
    } finally {
      loading = false;
    }
  }

  function submitSearch(nextQuery: SearchQuery): void {
    void runSearch(nextQuery, 1);
  }

  function goPrev(): void {
    if (query && page > 1 && !loading) void runSearch(query, page - 1);
  }

  function goNext(): void {
    if (query && !loading) void runSearch(query, page + 1);
  }

  function openContext(row: SearchRow): void {
    context = { rowId: row.id, keyword: query?.keyword ?? "" };
    contextOpen = true;
  }
</script>

<div class="lg:sticky lg:top-6">
  <SearchForm loading={loading} onSubmit={submitSearch} />
</div>
<ResultsTable
  {query}
  {items}
  {total}
  {page}
  {loading}
  {error}
  onOpenContext={openContext}
  onOpenMedia={(item) => (lightbox = item)}
  onPrev={goPrev}
  onNext={goNext}
/>

<ContextPanel
  target={context}
  bind:open={contextOpen}
  onOpenChange={(open) => !open && (context = null)}
  onOpenMedia={(item) => (lightbox = item)}
/>
<MediaLightbox item={lightbox} onClose={() => (lightbox = null)} />