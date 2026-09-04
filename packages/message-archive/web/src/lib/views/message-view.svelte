<script lang="ts">
  import { ArrowLeft, ChevronRight, Download, Image as ImageIcon, X } from "lucide-svelte";
  import { tick } from "svelte";
  import { fetchContext, fetchMediaMeta, fetchState, mediaDiskUrl, mediaLiveThumbUrl, mediaLiveUrl, type ArchiveState } from "$lib/api";
  import { fmtCount, fmtTs, senderName } from "$lib/format";
  import { backToSearch, navigate, showLightbox, type LightboxItem } from "$lib/state.svelte";
  import AlbumRow from "$lib/components/album-row.svelte";
  import Button from "$lib/components/button.svelte";
  import MessageRow from "$lib/components/message-row.svelte";
  import MediaTile from "$lib/components/media-tile.svelte";
  import type { ContextEntry, MessageRecord, StoredMediaFile } from "$lib/model";

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
  let albumIndex = $state(0);

  const album = $derived(anchor?.kind === "album" ? anchor : null);
  const messageAnchor = $derived(anchor?.kind === "message" ? anchor.record : null);
  const anchorRecord = $derived(album?.rows[0] ?? messageAnchor ?? null);
  const albumCurrent = $derived(album !== null ? (album.rows[albumIndex] ?? null) : null);
  const liveRow = $derived(
    album !== null
      ? (albumCurrent !== null && albumCurrent.hasMedia && albumCurrent.mediaFiles.length === 0
        ? albumCurrent
        : null)
      : (messageAnchor?.hasMedia && messageAnchor.mediaFiles.length === 0 ? messageAnchor : null)
  );

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
    if (anchor?.kind === "album") {
      const focus = anchor.focusRowId;
      const index = focus !== undefined ? anchor.rows.findIndex((row) => row.rowId === focus) : 0;
      albumIndex = index >= 0 ? index : 0;
    }
    liveShown = false;
    liveFailed = false;
    liveBusy = false;
    liveErrorText = "";
    if (liveSrc) {
      URL.revokeObjectURL(liveSrc);
      liveSrc = "";
    }
  });

  let liveShown = $state(false);
  let liveFailed = $state(false);
  let liveBusy = $state(false);
  let liveErrorText = $state("");
  let liveSrc = $state("");

  const remainingBefore = $derived(beforeTotal - before.length);
  const remainingAfter = $derived(afterTotal - after.length);

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

  function switchAlbum(index: number): void {
    albumIndex = index;
    liveShown = false;
    liveFailed = false;
    liveBusy = false;
    liveErrorText = "";
    if (liveSrc) {
      URL.revokeObjectURL(liveSrc);
      liveSrc = "";
    }
  }

  function openInChat(): void {
    const chatId = album?.rows[0]?.chatId ?? messageAnchor?.chatId;
    if (!chatId) return;
    navigate({ kind: "search", q: "", chat: chatId, from: "", to: "", mode: "include" });
  }

  async function loadLiveThumb(): Promise<void> {
    if (!liveRow || liveBusy) return;
    liveBusy = true;
    liveFailed = false;
    liveErrorText = "";
    try {
      const res = await fetch(mediaLiveThumbUrl(liveRow.rowId));
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        liveErrorText = body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `取回失败 (${res.status})`;
        liveFailed = true;
        return;
      }
      liveSrc = URL.createObjectURL(await res.blob());
      liveShown = true;
    } catch {
      liveErrorText = "网络错误";
      liveFailed = true;
    } finally {
      liveBusy = false;
    }
  }

  function openLiveLightbox(): void {
    if (!liveRow) return;
    const url = mediaLiveThumbUrl(liveRow.rowId);
    showLightbox([{
      name: `media_${liveRow.rowId}`,
      mime: liveRow.mimeType ?? "image/jpeg",
      size: undefined,
      spec: liveRow.mediaType ?? "",
      load: () => Promise.resolve({ url, source: "在线" })
    }], 0);
  }

  function openAlbumLightbox(): void {
    if (!album) return;
    const items: LightboxItem[] = [];
    const starts: number[] = [];
    for (const row of album.rows) {
      starts.push(items.length);
      const files = row.mediaFiles.filter(isPreviewable);
      if (files.length > 0) {
        for (const file of files) {
          items.push({
            name: file.fileName ?? `media_${file.id}`,
            mime: file.mimeType ?? "",
            size: file.fileSize,
            spec: file.mediaType,
            load: () => loadPreview(file)
          });
        }
      } else if (row.hasMedia) {
        const url = mediaLiveThumbUrl(row.rowId);
        items.push({
          name: `media_${row.messageId}`,
          mime: row.mimeType ?? "image/jpeg",
          size: undefined,
          spec: row.mediaType ?? "",
          load: () => Promise.resolve({ url, source: "在线" })
        });
      }
    }
    if (items.length === 0) return;
    showLightbox(items, starts[albumIndex] ?? 0);
  }

  function openLightbox(file: StoredMediaFile): void {
    if (!messageAnchor) return;
    const previewable = messageAnchor.mediaFiles.filter(isPreviewable);
    const index = previewable.indexOf(file);
    if (index < 0) return;
    const items: LightboxItem[] = previewable.map((item) => ({
      name: item.fileName ?? `media_${item.id}`,
      mime: item.mimeType ?? "",
      size: item.fileSize,
      spec: item.mediaType,
      load: () => loadPreview(item)
    }));
    showLightbox(items, index);
  }

  function isPreviewable(file: StoredMediaFile): boolean {
    const mime = file.mimeType ?? "";
    return mime.startsWith("image/") || mime.startsWith("video/")
      || file.mediaType === "photo" || file.mediaType === "sticker" || file.mediaType === "animation";
  }

  async function loadPreview(file: StoredMediaFile): Promise<{ url: string; source: "落盘" | "在线" }> {
    try {
      const meta = await fetchMediaMeta(file.id);
      return {
        url: meta.onDisk ? mediaDiskUrl(file.id) : mediaLiveUrl(file.id),
        source: meta.onDisk ? "落盘" : "在线"
      };
    } catch {
      return { url: mediaLiveUrl(file.id), source: "在线" };
    }
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
            相册 {album.rows.length} 张 · #{albumCurrent?.messageId ?? album.rows[0]?.messageId} · {fmtTs(albumCurrent?.date ?? album.rows[0]?.date ?? "")}
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
        <div class="px-6 py-5">
          <div class="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span class="font-medium">{anchorRecord ? senderName(anchorRecord) : ""}</span>
            {#if anchorRecord?.senderUsername || anchorRecord?.senderId}
              <span class="font-mono text-[11px] text-muted-foreground">
                {anchorRecord?.senderUsername ? `@${anchorRecord?.senderUsername}` : ""}
                {anchorRecord?.senderUsername && anchorRecord?.senderId ? " · " : ""}
                {anchorRecord?.senderId ?? ""}
              </span>
            {/if}
          </div>
          <p class="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
            {#if album ? album.captionText : messageAnchor?.text}
              {album ? album.captionText : messageAnchor?.text}
            {:else}
              <span class="text-muted-foreground">（无文本）</span>
            {/if}
          </p>
        </div>
        {#if album}
          <div class="border-t border-border/60 px-6 py-4">
            <div class="mb-3 flex flex-wrap items-center gap-1">
              <span class="mr-1 font-mono text-[11px] text-muted-foreground">相册 {album.rows.length} 张</span>
              {#each album.rows as row, i (row.rowId)}
                <button
                  class="rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-accent"
                  class:bg-accent={i === albumIndex}
                  onclick={() => switchAlbum(i)}
                >
                  {i + 1}/{album.rows.length}
                </button>
              {/each}
            </div>
            {#if albumCurrent !== null && albumCurrent.mediaFiles.length > 0}
              <MediaTile file={albumCurrent.mediaFiles[0]!} session={archiveState?.session ?? null} onpreview={openAlbumLightbox} />
            {:else if liveRow}
              <div class="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {#if liveShown && !liveFailed}
                  <button class="h-full w-full" aria-label="放大预览" onclick={openLiveLightbox}>
                    <img
                      src={liveSrc}
                      alt="图片"
                      class="h-full w-full object-cover"
                      onerror={() => {
                        liveFailed = true;
                        liveErrorText = liveErrorText || "图片解码失败";
                      }}
                    />
                  </button>
                  <span class="absolute left-1 top-1 rounded border bg-card/90 px-1 py-px font-mono text-[9px] text-muted-foreground">
                    在线
                  </span>
                {:else}
                  <div class="flex flex-col items-center gap-1 p-2">
                    <ImageIcon class="size-5 text-muted-foreground" aria-hidden="true" />
                    <span class="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                      {liveFailed ? liveErrorText : liveRow.mediaType ?? "媒体"}
                    </span>
                    {#if !archiveState?.session}
                      <span class="font-mono text-[10px] text-muted-foreground/60">未配置会话，无法在线取回</span>
                    {:else}
                      <span class="flex items-center gap-1">
                        <Button variant="outline" size="sm" class="h-7 px-1.5 font-mono text-[10px]" onclick={loadLiveThumb} disabled={liveBusy}>
                          {liveBusy ? "取回中…" : "在线取回"}
                        </Button>
                        <a
                          href={`${mediaLiveThumbUrl(liveRow.rowId)}?download=1`}
                          class="inline-flex h-7 items-center justify-center rounded-md border border-input bg-background px-1.5 font-mono text-[10px] shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          aria-label="下载媒体文件"
                        >
                          <Download class="size-3" aria-hidden="true" />
                        </a>
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <div class="flex aspect-[4/3] items-center justify-center rounded-lg border bg-muted font-mono text-[10px] text-muted-foreground">
                （无媒体）
              </div>
            {/if}
          </div>
        {:else if messageAnchor && (messageAnchor.mediaFiles.length > 0 || messageAnchor.hasMedia)}
          <div class="border-t border-border/60 px-6 py-4">
            {#if messageAnchor.mediaFiles.length > 0}
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {#each messageAnchor.mediaFiles as file (file.id)}
                  <MediaTile {file} session={archiveState?.session ?? null} onpreview={openLightbox} />
                {/each}
              </div>
            {:else if liveRow}
              <div class="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {#if liveShown && !liveFailed}
                  <button class="h-full w-full" aria-label="放大预览" onclick={openLiveLightbox}>
                    <img
                      src={liveSrc}
                      alt="图片"
                      class="h-full w-full object-cover"
                      onerror={() => {
                        liveFailed = true;
                        liveErrorText = liveErrorText || "图片解码失败";
                      }}
                    />
                  </button>
                  <span class="absolute left-1 top-1 rounded border bg-card/90 px-1 py-px font-mono text-[9px] text-muted-foreground">
                    在线
                  </span>
                {:else}
                  <div class="flex flex-col items-center gap-1 p-2">
                    <ImageIcon class="size-5 text-muted-foreground" aria-hidden="true" />
                    <span class="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                      {liveFailed ? liveErrorText : liveRow.mediaType ?? "媒体"}
                    </span>
                    {#if !archiveState?.session}
                      <span class="font-mono text-[10px] text-muted-foreground/60">未配置会话，无法在线取回</span>
                    {:else}
                      <span class="flex items-center gap-1">
                        <Button variant="outline" size="sm" class="h-7 px-1.5 font-mono text-[10px]" onclick={loadLiveThumb} disabled={liveBusy}>
                          {liveBusy ? "取回中…" : "在线取回"}
                        </Button>
                        <a
                          href={`${mediaLiveThumbUrl(liveRow.rowId)}?download=1`}
                          class="inline-flex h-7 items-center justify-center rounded-md border border-input bg-background px-1.5 font-mono text-[10px] shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                          aria-label="下载媒体文件"
                        >
                          <Download class="size-3" aria-hidden="true" />
                        </a>
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
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
          <AlbumRow {entry} />
        {:else}
          <MessageRow record={entry.record} highlights={terms} />
        {/if}
      {/each}
      <div class="my-1">
        {#if anchor.kind === "album"}
          <AlbumRow entry={anchor} anchor />
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
          <AlbumRow {entry} />
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