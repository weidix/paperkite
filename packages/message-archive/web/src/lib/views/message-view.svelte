<script lang="ts">
  import { ArrowLeft, ChevronRight, X } from "lucide-svelte";
  import { tick } from "svelte";
  import { fetchContext, fetchState, mediaDiskUrl, mediaRowUrl, type ArchiveState } from "$lib/api";
  import { fmtCount, fmtTs, highlightSegments, senderName } from "$lib/format";
  import { albumLightboxItems, kindOfFile, kindOfRow, openAlbumLightbox, openMessageLightbox } from "$lib/media";
  import { backToSearch, navigate } from "$lib/state.svelte";
  import AlbumRow from "$lib/components/album-row.svelte";
  import Button from "$lib/components/button.svelte";
  import MessageRow from "$lib/components/message-row.svelte";
  import MediaStrip, { type StripTile } from "$lib/components/media-strip.svelte";
  import type { AlbumContextEntry, ContextEntry, MessageRecord } from "$lib/model";

  const WINDOW = 20;
  const PAGE = 20;
  let generation = 0;
  const remembered = backToSearch();
  const terms = remembered.kind === "search" ? remembered.q.trim().split(/\s+/).filter(Boolean) : [];

  let { rowId } = $props<{ rowId: string }>();

  let anchor = $state<ContextEntry | null>(null);
  let before = $state<ContextEntry[]>([]);
  let after = $state<ContextEntry[]>([]);
  let beforeTotal = $state(0);
  let afterTotal = $state(0);
  let archiveState = $state<ArchiveState | null>(null);
  let error = $state("");
  let moving = $state(false);
  let loadingBefore = $state(false);
  let loadingAfter = $state(false);
  let scrollAnchor = $state<string | null>(null);
  let expanded = $state(false);

  const album = $derived(anchor?.kind === "album" ? anchor : null);
  const messageAnchor = $derived(anchor?.kind === "message" ? anchor.record : null);
  const anchorRecord = $derived(album?.rows[0] ?? messageAnchor ?? null);
  const anchorText = $derived(album?.captionText ?? messageAnchor?.text ?? "");
  const segments = $derived(highlightSegments(anchorText, terms));
  const stripTiles = $derived(buildStripTiles());

  /** 锚点文本实际被 line-clamp 截断时提供展开/收起（与字符数无关）。 */
  let anchorTextEl = $state<HTMLParagraphElement | null>(null);
  let anchorClipped = $state(false);

  $effect(() => {
    const el = anchorTextEl;
    // 锚点文本变化时重新测量：元素被复用且 clamp 高度不变时 ResizeObserver 不会触发
    void anchorText;
    if (el === null || expanded) return;
    const check = (): void => {
      anchorClipped = el.scrollHeight > el.clientHeight + 1;
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  });

  const showExpand = $derived(anchorClipped || expanded);

  const remainingBefore = $derived(beforeTotal - before.length);
  const remainingAfter = $derived(afterTotal - after.length);

  $effect(() => {
    if (anchor !== null && anchorRowId(anchor) === rowId) return;
    loadContext(rowId);
  });

  $effect(() => {
    fetchState().then((value) => (archiveState = value)).catch(() => {});
  });

  $effect(() => {
    if (!scrollAnchor) return;
    const id = scrollAnchor;
    scrollAnchor = null;
    tick().then(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center" });
    });
  });

  $effect(() => {
    if (anchor) expanded = false;
  });

  async function loadContext(id: string): Promise<void> {
    const token = ++generation;
    moving = true;
    error = "";
    try {
      const ctx = await fetchContext(id, WINDOW, WINDOW);
      if (token !== generation) return;
      before = [...ctx.before];
      after = [...ctx.after];
      beforeTotal = ctx.beforeN;
      afterTotal = ctx.afterN;
      anchor = ctx.anchor ?? null;
      scrollAnchor = id;
    } catch (e) {
      if (token === generation) error = messageOf(e);
    } finally {
      if (token === generation) moving = false;
    }
  }

  async function loadBefore(): Promise<void> {
    if (!anchor || loadingBefore) return;
    loadingBefore = true;
    const token = generation;
    const stick = document.getElementById(`msg-${entryRowId(anchor)}`)?.getBoundingClientRect().top;
    try {
      const ctx = await fetchContext(entryRowId(anchor), PAGE, 0, before.length, 0);
      if (token !== generation) return;
      before = [...ctx.before, ...before];
      beforeTotal = ctx.beforeN;
      if (stick !== undefined) {
        await tick();
        const now = document.getElementById(`msg-${entryRowId(anchor)}`)?.getBoundingClientRect().top;
        if (now !== undefined) {
          document.querySelector("main")?.scrollBy({ top: now - stick });
        }
      }
    } catch (e) {
      if (token === generation) error = messageOf(e);
    } finally {
      if (token === generation) loadingBefore = false;
    }
  }

  async function loadAfter(): Promise<void> {
    if (!anchor || loadingAfter) return;
    loadingAfter = true;
    const token = generation;
    try {
      const ctx = await fetchContext(entryRowId(anchor), 0, PAGE, 0, after.length);
      if (token !== generation) return;
      after = [...after, ...ctx.after];
      afterTotal = ctx.afterN;
    } catch (e) {
      if (token === generation) error = messageOf(e);
    } finally {
      if (token === generation) loadingAfter = false;
    }
  }

  function openInChat(): void {
    const chatId = album?.rows[0]?.chatId ?? messageAnchor?.chatId;
    if (!chatId) return;
    navigate({ kind: "search", q: "", chat: chatId, from: "", to: "", mode: "include" });
  }

  /** 点击缩略图：定位到对应项并直接进入预览。 */
  function selectStrip(index: number): void {
    if (album !== null) {
      openAlbumLightbox(album, index);
    } else if (messageAnchor !== null) {
      openMessageLightbox(messageAnchor, index);
    }
  }

  function buildStripTiles(): StripTile[] {
    if (album !== null) {
      const tiles: StripTile[] = [];
      for (const row of album.rows) {
        if (row.mediaFiles.length > 0) {
          const first = row.mediaFiles[0];
          if (!first) continue;
          const kind = kindOfFile(first);
          tiles.push({
            key: `file-${first.id}`,
            kind,
            file: first,
            label: String(tiles.length + 1),
            name: first.fileName ?? `media_${first.messageId}`,
            badge: row.mediaFiles.length > 1 ? `×${row.mediaFiles.length}` : undefined,
            thumbUrl: hasThumbKind(kind) ? mediaDiskUrl(first.id) : undefined,
            live: false
          });
        } else if (row.hasMedia) {
          tiles.push(liveTile(row, String(tiles.length + 1)));
        }
      }
      return tiles;
    }
    if (messageAnchor !== null && messageAnchor.mediaFiles.length > 0) {
      return messageAnchor.mediaFiles.map((file, i) => {
        const kind = kindOfFile(file);
        return {
          key: `file-${file.id}`,
          kind,
          file,
          label: String(i + 1),
          name: file.fileName ?? `media_${file.id}`,
          thumbUrl: hasThumbKind(kind) ? mediaDiskUrl(file.id) : undefined,
          live: false
        };
      });
    }
    if (messageAnchor?.hasMedia) {
      return [liveTile(messageAnchor, "1")];
    }
    return [];
  }

  function liveTile(row: MessageRecord, label: string): StripTile {
    const kind = kindOfRow(row);
    return {
      key: `live-${row.rowId}`,
      kind,
      file: null,
      label,
      name: `media_${row.messageId}`,
      live: true,
      disabled: archiveState?.session === null,
      thumbUrl: hasThumbKind(kind) && archiveState?.session !== null ? mediaRowUrl(row.rowId) : undefined
    };
  }

  function hasThumbKind(kind: StripTile["kind"]): boolean {
    return kind === "image" || kind === "video";
  }

  function entryRowId(entry: ContextEntry): string {
    return entry.kind === "album" ? entry.rowId : entry.record.rowId;
  }

  function anchorRowId(entry: ContextEntry): string {
    return entry.kind === "album" ? (entry.focusRowId ?? entry.rowId) : entry.record.rowId;
  }

  function ctxCount(loaded: number, total: number): string {
    return loaded >= total ? `共 ${fmtCount(total)} 条` : `${fmtCount(loaded)}/${fmtCount(total)}`;
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

<div class="flex flex-col gap-4">
  <div class="sticky top-0 z-20 -mx-6 -mt-6 border-b border-border/60 bg-background/95 px-6 pb-3 pt-6 backdrop-blur-sm">
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="icon" class="size-8" aria-label="返回检索" onclick={() => navigate(backToSearch())}>
        <ArrowLeft class="size-4" aria-hidden="true" />
      </Button>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <h1 class="truncate font-display text-base font-semibold tracking-tight">
            {album?.rows[0]?.chatTitle ?? messageAnchor?.chatTitle ?? "未知会话"}
          </h1>
          {#if archiveState?.session}
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">会话 {archiveState.session}</span>
          {/if}
        </div>
        <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {#if messageAnchor}
            #{messageAnchor.messageId} · 行 {messageAnchor.rowId} · {fmtTs(messageAnchor.date)} · {messageAnchor.messageType}
          {:else if album}
            相册 {album.rows.length} 张 · #{album.rows[0]?.messageId} · {fmtTs(album.rows[0]?.date ?? "")}
          {:else}
            …
          {/if}
        </div>
      </div>
      <Button variant="ghost" size="sm" class="hidden sm:inline-flex" onclick={openInChat}>
        在会话中打开
        <ChevronRight class="size-3.5" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" class="size-8" aria-label="关闭" onclick={() => navigate(backToSearch())}>
        <X class="size-4" aria-hidden="true" />
      </Button>
    </div>
  </div>

  <div class="transition-opacity {moving ? 'pointer-events-none opacity-60' : ''}">
    {#if anchor === null && error}
      <div class="rounded-lg border bg-card p-6 text-center shadow-sm">
        <p class="font-mono text-xs text-muted-foreground">{error}</p>
        <Button variant="ghost" size="sm" class="mt-3" onclick={() => loadContext(rowId)}>重试</Button>
      </div>
    {:else if anchor === null}
      <div class="grid gap-4">
        {#each Array(4) as _, i (i)}
          <div class="h-16 animate-pulse rounded-xl bg-muted"></div>
        {/each}
      </div>
    {:else}
      {#if error}
        <div class="rounded-lg border bg-card p-4 text-center shadow-sm">
          <p class="font-mono text-xs text-muted-foreground">{error}</p>
          <Button variant="ghost" size="sm" class="mt-2" onclick={() => loadContext(rowId)}>重试</Button>
        </div>
      {/if}
      <div class="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div class="px-4 py-3">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="truncate text-sm font-medium">{anchorRecord ? senderName(anchorRecord) : ""}</span>
            {#if anchorRecord?.senderUsername || anchorRecord?.senderId}
              <span class="truncate font-mono text-[10px] text-muted-foreground">
                {anchorRecord?.senderUsername ? `@${anchorRecord?.senderUsername}` : ""}
                {anchorRecord?.senderUsername && anchorRecord?.senderId ? " · " : ""}
                {anchorRecord?.senderId ?? ""}
              </span>
            {/if}
            <span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {#if album !== null}
                相册 {album.rows.length} 张 · #{album.rows[0]?.messageId} · {fmtTs(album.rows[0]?.date)}
              {:else if messageAnchor}
                #{messageAnchor.messageId} · {fmtTs(messageAnchor.date)} · {messageAnchor.messageType}
              {/if}
            </span>
          </div>
          <p
            class="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-snug {expanded ? '' : 'line-clamp-3'}"
            bind:this={anchorTextEl}
          >
            {#if anchorText}
              {#each segments as segment, i (i)}
                {#if segment.hit}
                  <mark class="rounded-md bg-foreground px-1 text-background">{segment.text}</mark>
                {:else}
                  <span>{segment.text}</span>
                {/if}
              {/each}
            {:else}
              <span class="text-muted-foreground">（无文本）</span>
            {/if}
          </p>
          {#if showExpand}
            <button
              class="mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onclick={() => (expanded = !expanded)}
              aria-expanded={expanded}
              aria-label={expanded ? "收起全文" : "展开全文"}
            >
              <span>{expanded ? "收起" : "展开全文"}</span>
              <span class="text-muted-foreground/60">· {anchorText.length} 字</span>
            </button>
          {/if}
        </div>
        {#if stripTiles.length > 0}
          <MediaStrip tiles={stripTiles} onselect={selectStrip} />
        {/if}
      </div>

      <div class="mb-1 mt-2 flex items-center gap-3 px-1">
        <span class="font-mono text-[10px] tracking-widest text-muted-foreground">更早 · {ctxCount(before.length, beforeTotal)}</span>
        <span class="h-px flex-1 bg-border/70" aria-hidden="true"></span>
        {#if remainingBefore > 0}
          <Button variant="ghost" size="sm" class="h-6 px-2 text-[10px]" onclick={loadBefore} disabled={loadingBefore}>
            {loadingBefore ? "加载中…" : `加载更早 ${fmtCount(remainingBefore)} 条`}
          </Button>
        {/if}
      </div>
      {#each before as entry (entryRowId(entry))}
        {#if entry.kind === "album"}
          <AlbumRow {entry} highlights={terms} />
        {:else}
          <MessageRow record={entry.record} highlights={terms} />
        {/if}
      {/each}
      <div class="my-1">
        {#if anchor.kind === "album"}
          <AlbumRow entry={anchor} anchor highlights={terms} />
        {:else}
          <MessageRow record={anchor.record} anchor fullText highlights={terms} />
        {/if}
      </div>
      <div class="mb-1 mt-3 flex items-center gap-3 px-1">
        <span class="font-mono text-[10px] tracking-widest text-muted-foreground">更晚 · {ctxCount(after.length, afterTotal)}</span>
        <span class="h-px flex-1 bg-border/70" aria-hidden="true"></span>
        {#if remainingAfter > 0}
          <Button variant="ghost" size="sm" class="h-6 px-2 text-[10px]" onclick={loadAfter} disabled={loadingAfter}>
            {loadingAfter ? "加载中…" : `加载更晚 ${fmtCount(remainingAfter)} 条`}
          </Button>
        {/if}
      </div>
      {#each after as entry (entryRowId(entry))}
        {#if entry.kind === "album"}
          <AlbumRow {entry} highlights={terms} />
        {:else}
          <MessageRow record={entry.record} highlights={terms} />
        {/if}
      {/each}
      <p class="mt-3 px-1 font-mono text-[10px] text-muted-foreground">
        上下文仅限本会话 · 点击任一行可移动锚点
      </p>
    {/if}
  </div>
</div>