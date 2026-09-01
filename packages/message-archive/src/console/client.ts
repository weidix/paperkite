interface MediaItem {
  readonly id?: string | number | null;
  readonly message_id?: number | null;
  readonly message_rowid?: string | number | null;
  readonly media_url?: string;
  readonly media_type?: string | null;
  readonly mime_type?: string | null;
}

interface SearchRow {
  readonly id?: string | number | null;
  readonly date?: string;
  readonly chat_title?: string | null;
  readonly sender_username?: string | null;
  readonly sender_first_name?: string | null;
  readonly sender_last_name?: string | null;
  readonly message_type?: string | null;
  readonly text?: string;
  readonly has_media?: boolean;
  readonly media_type?: string | null;
  readonly mime_type?: string | null;
  readonly media_url?: string | null;
  readonly has_preview?: boolean;
  readonly media_items?: readonly MediaItem[] | null;
}

interface SearchPayload {
  readonly items: readonly SearchRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

interface ContextPayload {
  readonly anchor: SearchRow | null;
  readonly before: readonly SearchRow[];
  readonly after: readonly SearchRow[];
}

interface SearchQuery {
  keyword: string;
  exclude_keyword: string;
  chat_title: string;
  date_from: string;
  date_to: string;
  time_mode: string;
}

const CONTEXT_INITIAL_WINDOW = 120;

const contextState: { messageRowId: number | null; isLoading: boolean } = {
  messageRowId: null,
  isLoading: false
};

const resultState: {
  items: readonly SearchRow[];
  pageSize: number;
  total: number;
  page: number;
  query: SearchQuery | null;
} = { items: [], pageSize: 50, total: 0, page: 1, query: null };

const albumMediaItemsCache = new Map<string, Promise<MediaItem[]>>();

function toQueryString(data: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatMessageDate(value: string | undefined | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const year = pad2(date.getFullYear() % 100);
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function formatDisplayName(item: SearchRow): string {
  const first = String(item.sender_first_name ?? "").trim();
  const last = String(item.sender_last_name ?? "").trim();
  return `${first} ${last}`.trim() || "-";
}

function createTextCell(rawText: string | undefined): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "text-cell";
  appendHighlightedText(td, rawText || "");
  return td;
}

function buildMediaUrl(item: SearchRow): string {
  if (item && Array.isArray(item.media_items) && item.media_items.length > 0) {
    return item.media_items[0]?.media_url || "";
  }
  if (item && item.media_url) return item.media_url;
  if (item && item.id !== undefined && item.id !== null) {
    return `/api/messages/${item.id}/media`;
  }
  return "";
}

function getMediaItems(item: SearchRow): MediaItem[] {
  if (item && Array.isArray(item.media_items) && item.media_items.length > 0) {
    return item.media_items.filter((media) => media && media.media_url) as MediaItem[];
  }
  const fallbackUrl = buildMediaUrl(item);
  if (!item || !item.has_preview || !fallbackUrl) return [];
  return [{
    id: null,
    media_url: fallbackUrl,
    media_type: item.media_type || null,
    mime_type: item.mime_type || null
  }];
}

async function fetchAlbumMediaItems(messageRowId: string | number | null | undefined): Promise<MediaItem[]> {
  if (messageRowId === null || messageRowId === undefined) return [];
  const cacheKey = String(messageRowId);
  if (!albumMediaItemsCache.has(cacheKey)) {
    const request = callApi<{ items?: readonly MediaItem[] }>(`/api/messages/${messageRowId}/album`, {})
      .then((payload) => {
        if (!payload || !Array.isArray(payload.items)) return [];
        return payload.items.filter((media) => media && media.media_url) as MediaItem[];
      })
      .catch(() => {
        albumMediaItemsCache.delete(cacheKey);
        return [];
      });
    albumMediaItemsCache.set(cacheKey, request);
  }
  return albumMediaItemsCache.get(cacheKey) ?? Promise.resolve([]);
}

function escapeRegExp(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getHighlightTerms(): string[] {
  const keyword = resultState.query?.keyword ?? "";
  return Array.from(
    new Set(keyword.split(/\s+/).map((term) => term.trim()).filter(Boolean))
  ).sort((left, right) => right.length - left.length);
}

function appendHighlightedText(container: HTMLElement, rawText: string | undefined): void {
  const text = rawText || "";
  const terms = getHighlightTerms();
  if (!terms.length || !text) {
    container.textContent = text;
    return;
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);
  const fragment = document.createDocumentFragment();

  for (const part of parts) {
    if (!part) continue;
    const isHit = terms.some((term) => term.localeCompare(part, undefined, { sensitivity: "accent" }) === 0) ||
      terms.some((term) => term.toLowerCase() === part.toLowerCase());
    if (!isHit) {
      fragment.appendChild(document.createTextNode(part));
      continue;
    }
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = part;
    fragment.appendChild(mark);
  }

  container.replaceChildren(fragment);
}

function ensureMediaViewer(): HTMLElement {
  let viewer = document.getElementById("media-viewer");
  if (viewer) return viewer;

  viewer = document.createElement("div");
  viewer.id = "media-viewer";
  viewer.className = "media-viewer";
  viewer.setAttribute("aria-hidden", "true");
  viewer.innerHTML = `
    <div class="media-viewer-backdrop"></div>
    <div class="media-viewer-dialog">
      <button type="button" class="media-viewer-close">关闭</button>
      <img class="media-viewer-image" alt="" />
    </div>
  `;
  document.body.appendChild(viewer);
  return viewer;
}

function openMediaViewer(src: string, alt: string): void {
  const viewer = ensureMediaViewer();
  const image = viewer.querySelector(".media-viewer-image");
  if (!(image instanceof HTMLImageElement)) return;
  image.src = src;
  image.alt = alt || "消息图片";
  viewer.classList.add("open");
  viewer.setAttribute("aria-hidden", "false");
}

function closeMediaViewer(): void {
  const viewer = document.getElementById("media-viewer");
  if (!viewer) return;
  viewer.classList.remove("open");
  viewer.setAttribute("aria-hidden", "true");
}

function wireMediaViewer(): void {
  const viewer = ensureMediaViewer();
  viewer.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.classList.contains("media-viewer") ||
      event.target.classList.contains("media-viewer-backdrop") ||
      event.target.classList.contains("media-viewer-close")
    ) {
      closeMediaViewer();
    }
  });
}

function loadInlineMedia(frame: HTMLButtonElement, mediaWrap: HTMLElement, itemText: string, imageIndex: number): boolean {
  const mediaUrl = frame.dataset.mediaUrl || "";
  if (!mediaUrl) return false;
  if (frame.dataset.loaded === "true") return true;

  const image = document.createElement("img");
  image.className = "message-media-image";
  image.alt = itemText || `消息图片 ${imageIndex + 1}`;
  image.loading = "lazy";
  image.hidden = true;
  const loadingIndicator = createMediaLoadingIndicator();
  frame.dataset.loaded = "true";
  frame.classList.add("is-loaded");
  mediaWrap.classList.remove("is-error");
  frame.replaceChildren(loadingIndicator, image);
  image.addEventListener("load", () => {
    loadingIndicator.remove();
    image.hidden = false;
  });
  image.addEventListener("error", () => {
    frame.dataset.loaded = "false";
    frame.classList.remove("is-loaded");
    frame.replaceChildren(createMediaPlaceholder());
    mediaWrap.classList.add("is-error");
  });
  image.src = mediaUrl;
  return false;
}

function createMediaPlaceholder(): HTMLElement {
  const placeholder = document.createElement("span");
  placeholder.className = "message-media-placeholder";
  placeholder.textContent = "加载图片";
  return placeholder;
}

function createMediaLoadingIndicator(): HTMLElement {
  const indicator = document.createElement("span");
  indicator.className = "message-media-loading";
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function createMediaGallery(item: SearchRow, mediaItems: readonly MediaItem[], extraClass = ""): HTMLDivElement {
  const gallery = document.createElement("div");
  gallery.className = extraClass ? `message-media-gallery ${extraClass}` : "message-media-gallery";

  mediaItems.forEach((media, index) => {
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "message-media";

    const frame = document.createElement("button");
    frame.type = "button";
    frame.className = "message-media-frame";
    frame.dataset.mediaUrl = media.media_url ?? "";
    frame.dataset.loaded = "false";
    frame.setAttribute("aria-label", `点击加载图片 ${index + 1}`);

    frame.addEventListener("click", () => {
      const alreadyLoaded = loadInlineMedia(frame, mediaWrap, item.text || "", index);
      if (alreadyLoaded) {
        openMediaViewer(media.media_url ?? "", item.text || `消息图片 ${index + 1}`);
      }
    });

    frame.appendChild(createMediaPlaceholder());
    mediaWrap.appendChild(frame);
    gallery.appendChild(mediaWrap);
  });

  return gallery;
}

async function maybeHydrateAlbumMedia(gallery: HTMLDivElement, item: SearchRow, extraClass = ""): Promise<void> {
  const currentItems = getMediaItems(item);
  if (!item || !item.has_preview || currentItems.length > 1) return;
  if (item.id === null || item.id === undefined) return;

  const albumItems = await fetchAlbumMediaItems(item.id);
  if (albumItems.length <= currentItems.length || !gallery.isConnected) return;

  gallery.replaceWith(createMediaGallery(item, albumItems, extraClass));
}

function appendInlineMedia(container: HTMLElement, item: SearchRow, extraClass = ""): void {
  if (!item || !item.has_preview) return;

  const mediaItems = getMediaItems(item);
  if (!mediaItems.length) return;

  const gallery = createMediaGallery(item, mediaItems, extraClass);
  container.appendChild(gallery);
  void maybeHydrateAlbumMedia(gallery, item, extraClass);
}

function createMessageCell(item: SearchRow): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "text-cell";

  td.appendChild(createMessageMeta(item));

  const text = document.createElement("div");
  text.className = "message-text";
  appendHighlightedText(text, item.text || "");
  td.appendChild(text);

  appendInlineMedia(td, item);
  return td;
}

function createMessageMeta(item: SearchRow): HTMLDivElement {
  const meta = document.createElement("div");
  meta.className = "message-meta";

  const parts = [
    formatMessageDate(item.date),
    item.chat_title || "-",
    item.sender_username ? `@${item.sender_username}` : "@-",
    formatDisplayName(item)
  ];

  for (const part of parts) {
    const span = document.createElement("span");
    span.className = "message-meta-item";
    span.textContent = part;
    meta.appendChild(span);
  }

  return meta;
}

function createContextButton(item: SearchRow): HTMLTableCellElement {
  const td = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button detail-button";
  button.textContent = "详情";

  const hasAnchor = item && item.id !== undefined && item.id !== null;
  button.disabled = !hasAnchor;
  if (hasAnchor) {
    button.addEventListener("click", () => {
      openContextPanel(item.id as number);
    });
  }

  td.appendChild(button);
  return td;
}

function renderRows(items: readonly SearchRow[]): void {
  const body = document.getElementById("result-body");
  if (!body) return;
  body.innerHTML = "";

  if (!items || items.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 2;
    emptyCell.textContent = "没有匹配结果";
    emptyRow.appendChild(emptyCell);
    body.appendChild(emptyRow);
    return;
  }

  for (const item of items) {
    const row = document.createElement("tr");
    row.appendChild(createMessageCell(item));
    row.appendChild(createContextButton(item));
    body.appendChild(row);
  }
}

async function callApi<T>(url: string, query: Record<string, unknown>): Promise<T> {
  const qs = toQueryString(query);
  const response = await fetch(qs ? `${url}?${qs}` : url, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text || `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text) as { error?: string; detail?: string };
      message = payload.error ?? payload.detail ?? message;
    } catch {
      // 非 JSON 响应体原样展示
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function setContextOpen(open: boolean): void {
  const panel = document.getElementById("context-panel");
  if (!panel) return;
  panel.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
}

function createContextRow(row: SearchRow, role: string): HTMLElement {
  const item = document.createElement("article");
  item.className = `context-item ${role}`;
  item.dataset.rowid = row && row.id !== undefined && row.id !== null ? String(row.id) : "";

  const header = document.createElement("div");
  header.className = "context-item-header";
  header.textContent = `${formatMessageDate(row.date)} | ${row.chat_title || "-"} | ${row.sender_username || "-"}`;

  const detail = document.createElement("div");
  detail.className = "context-item-meta";
  detail.textContent = `姓名: ${formatDisplayName(row)} | 类型: ${row.message_type || "-"}`;

  const text = document.createElement("pre");
  text.className = "context-item-text";
  appendHighlightedText(text, row.text || "");

  item.appendChild(header);
  item.appendChild(text);
  appendInlineMedia(item, row, "context-item-media");
  item.appendChild(detail);
  return item;
}

function renderContextPayload(payload: ContextPayload): void {
  const meta = document.getElementById("context-meta");
  const list = document.getElementById("context-list");
  if (!meta || !list) return;

  if (!payload || !payload.anchor) {
    meta.textContent = "未找到上下文";
    list.replaceChildren();
    return;
  }

  const before = payload.before || [];
  const after = payload.after || [];
  meta.textContent =
    `群组: ${payload.anchor.chat_title || "-"} | 时间: ${formatMessageDate(payload.anchor.date)} | ` +
    `上文 ${before.length} 条 | 下文 ${after.length} 条`;
  const fragment = document.createDocumentFragment();
  for (const row of before) fragment.appendChild(createContextRow(row, "before"));
  fragment.appendChild(createContextRow(payload.anchor, "anchor"));
  for (const row of after) fragment.appendChild(createContextRow(row, "after"));
  list.replaceChildren(fragment);
}

function centerAnchorInView(): void {
  const list = document.getElementById("context-list");
  if (!list) return;
  const anchor = list.querySelector<HTMLElement>(".context-item.anchor");
  if (!anchor) return;
  const anchorCenterY = anchor.offsetTop + anchor.offsetHeight / 2;
  const nextScrollTop = Math.max(anchorCenterY - list.clientHeight / 2, 0);
  list.scrollTop = nextScrollTop;
}

function getPageCount(): number {
  return Math.max(1, Math.ceil(resultState.total / resultState.pageSize));
}

function scrollResultsToTop(): void {
  const tableWrap = document.querySelector(".table-wrap");
  if (!tableWrap) return;
  tableWrap.scrollTop = 0;
}

function setElementText(id: string, value: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.textContent = value;
  return true;
}

function setElementDisabled(id: string, disabled: boolean): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  (element as HTMLButtonElement).disabled = disabled;
  return true;
}

function renderPagedRows(): void {
  const pageCount = getPageCount();
  const safePage = Math.min(Math.max(resultState.page, 1), pageCount);
  resultState.page = safePage;

  renderRows(resultState.items);

  setElementText("result-page", `第 ${safePage} / ${pageCount} 页`);
  setElementDisabled("result-prev", safePage <= 1);
  setElementDisabled("result-next", safePage >= pageCount);
}

function applyResultPayload(payload: SearchPayload, page: number): void {
  resultState.items = payload.items || [];
  resultState.total = payload.total || 0;
  resultState.pageSize = payload.limit || resultState.pageSize;
  resultState.page = page;

  setElementText(
    "result-meta",
    `共 ${resultState.total} 条，当前第 ${resultState.page} 页，本页 ${resultState.items.length} 条`
  );
  renderPagedRows();
}

async function loadContext(options: { centerAnchor?: boolean } = {}): Promise<void> {
  if (contextState.messageRowId === null || contextState.isLoading) return;

  const { centerAnchor = false } = options;
  const list = document.getElementById("context-list");
  const meta = document.getElementById("context-meta");
  if (!list) return;
  const previousMetaText = meta ? meta.textContent : "";
  const shouldAnnounceLoading = centerAnchor || list.childElementCount === 0;

  contextState.isLoading = true;
  if (meta && shouldAnnounceLoading) {
    meta.textContent = "上下文查询中...";
  }
  try {
    const payload = await callApi<ContextPayload>("/api/search/context", {
      message_rowid: contextState.messageRowId,
      before_n: CONTEXT_INITIAL_WINDOW,
      after_n: CONTEXT_INITIAL_WINDOW
    });
    renderContextPayload(payload);

    if (centerAnchor) {
      centerAnchorInView();
    }
  } catch (error) {
    if (meta && shouldAnnounceLoading) {
      meta.textContent = previousMetaText || "请选择一条消息查看上下文";
    }
    throw error;
  } finally {
    contextState.isLoading = false;
  }
}

function openContextPanel(messageRowId: number): void {
  const list = document.getElementById("context-list");
  contextState.messageRowId = messageRowId;
  if (list) {
    list.replaceChildren();
    list.scrollTop = 0;
  }
  setContextOpen(true);
  loadContext({ centerAnchor: true }).catch((error) => {
    alert(error instanceof Error ? error.message : String(error));
  });
}

function closeContextPanel(): void {
  setContextOpen(false);
}

function setLoading(button: HTMLButtonElement | null, loading: boolean): void {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.textContent ?? "";
    button.textContent = "查询中...";
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.originalText || "查询";
  button.disabled = false;
}

function toIsoString(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function buildSearchPayload(form: HTMLFormElement): SearchQuery {
  const data = new FormData(form);
  const keyword = String(data.get("keyword") ?? "").trim();
  const excludeKeyword = String(data.get("exclude_keyword") ?? "").trim();
  const chatTitle = String(data.get("chat_title") ?? "").trim();
  return {
    keyword,
    exclude_keyword: excludeKeyword,
    chat_title: chatTitle,
    date_from: toIsoString(String(data.get("date_from") ?? "")),
    date_to: toIsoString(String(data.get("date_to") ?? "")),
    time_mode: String(data.get("time_mode") ?? "include")
  };
}

function buildStructuredPayload(query: SearchQuery, page: number): Record<string, unknown> {
  const safePage = Math.max(page, 1);
  return {
    keyword: query.keyword,
    exclude_keyword: query.exclude_keyword,
    chat_title: query.chat_title,
    date_from: query.date_from,
    date_to: query.date_to,
    time_mode: query.time_mode,
    limit: resultState.pageSize,
    offset: (safePage - 1) * resultState.pageSize
  };
}

async function fetchSearchPage(page: number): Promise<void> {
  if (!resultState.query) return;

  const safePage = Math.max(page, 1);
  const payload = await callApi<SearchPayload>("/api/search/structured", buildStructuredPayload(resultState.query, safePage));
  applyResultPayload(payload, safePage);
  scrollResultsToTop();
}

function syncTimeRangeInputs(): void {
  const selector = document.getElementById("time-mode");
  const form = document.getElementById("query-form");
  if (!selector || !form) return;

  const enabled = selector instanceof HTMLSelectElement && selector.value !== "off";
  const dateInputs = form.querySelectorAll('input[name="date_from"], input[name="date_to"]');
  dateInputs.forEach((input) => {
    const element = input as HTMLInputElement;
    element.disabled = !enabled;
    if (!enabled) element.value = "";
  });
}

function wireContextControls(): void {
  const centerButton = document.getElementById("context-center-anchor");
  if (!centerButton) return;

  centerButton.addEventListener("click", () => {
    centerAnchorInView();
  });
}

async function submitFusion(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  setLoading(button, true);
  setElementText("result-meta", "查询中...");

  try {
    resultState.query = buildSearchPayload(form);
    await fetchSearchPage(1);
  } finally {
    setLoading(button, false);
  }
}

function bootstrap(): void {
  const form = document.getElementById("query-form");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    submitFusion(event).catch((error) => {
      alert(error instanceof Error ? error.message : String(error));
    });
  });

  const prevButton = document.getElementById("result-prev");
  if (prevButton) {
    prevButton.addEventListener("click", () => {
      fetchSearchPage(resultState.page - 1).catch((error) => {
        alert(error instanceof Error ? error.message : String(error));
      });
    });
  }

  const nextButton = document.getElementById("result-next");
  if (nextButton) {
    nextButton.addEventListener("click", () => {
      fetchSearchPage(resultState.page + 1).catch((error) => {
        alert(error instanceof Error ? error.message : String(error));
      });
    });
  }

  const timeMode = document.getElementById("time-mode");
  if (timeMode) {
    timeMode.addEventListener("change", () => {
      syncTimeRangeInputs();
    });
  }
  syncTimeRangeInputs();

  const contextClose = document.getElementById("context-close");
  if (contextClose) {
    contextClose.addEventListener("click", () => {
      closeContextPanel();
    });
  }
  wireContextControls();
  wireMediaViewer();

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMediaViewer();
      closeContextPanel();
    }
  });

  document.addEventListener("click", (event) => {
    const panel = document.getElementById("context-panel");
    if (!panel || !panel.classList.contains("open")) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("#media-viewer")) return;
    if (event.target.closest("#context-panel")) return;
    if (event.target.closest(".detail-button")) return;
    closeContextPanel();
  });

  renderPagedRows();
}

document.addEventListener("DOMContentLoaded", () => bootstrap());