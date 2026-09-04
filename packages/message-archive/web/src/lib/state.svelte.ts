import { fetchChats, type ChatLedger, type TimeMode } from "./api";
import type { ArchiveSearchResult } from "./model";

type View =
  | { kind: "search"; q: string; chat: string; from: string; to: string; mode: TimeMode }
  | { kind: "message"; rowId: string };

class ViewStore {
  current: View = $state(emptySearch());
  private searchMemory = emptySearch();

  navigate(next: View): void {
    if (next.kind === "search") this.searchMemory = next;
    const target = hashOf(next);
    if (location.hash === target) {
      this.current = next;
      return;
    }
    location.hash = target;
  }

  backToSearch(): View {
    return { ...this.searchMemory };
  }

  reset(): void {
    const next = parseHash(location.hash);
    this.current = next;
    if (next.kind === "search") this.searchMemory = next;
  }
}

export const viewStore = new ViewStore();

export function navigate(next: View): void {
  viewStore.navigate(next);
}

export function backToSearch(): View {
  return viewStore.backToSearch();
}

export function initRouter(): () => void {
  viewStore.reset();
  const onChange = (): void => {
    viewStore.reset();
  };
  addEventListener("hashchange", onChange);
  return () => removeEventListener("hashchange", onChange);
}

export function parseHash(hash: string): View {
  const raw = hash.replace(/^#/, "");
  if (raw.startsWith("/m/")) {
    const rowId = raw.slice(3).split("?")[0] ?? "";
    if (/^\d+$/.test(rowId)) return { kind: "message", rowId };
    return emptySearch();
  }
  if (raw.startsWith("/q")) {
    const query = new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?")) : "");
    return {
      kind: "search",
      q: query.get("q") ?? "",
      chat: query.get("chat") ?? "",
      from: query.get("from") ?? "",
      to: query.get("to") ?? "",
      mode: modeOf(query.get("mode"))
    };
  }
  return emptySearch();
}

function hashOf(view: View): string {
  if (view.kind === "message") return `#/m/${view.rowId}`;
  const query = new URLSearchParams();
  if (view.q) query.set("q", view.q);
  if (view.chat) query.set("chat", view.chat);
  if (view.from) query.set("from", view.from);
  if (view.to) query.set("to", view.to);
  if (view.mode !== "include") query.set("mode", view.mode);
  const text = query.toString();
  return text ? `#/q?${text}` : "#/q";
}

export function emptySearch(): View {
  return { kind: "search", q: "", chat: "", from: "", to: "", mode: "include" };
}

export function isEmptySearch(v: View): boolean {
  return v.kind === "search" && !v.q && !v.chat && !v.from && !v.to;
}

function modeOf(value: string | null): TimeMode {
  return value === "exclude" || value === "off" ? value : "include";
}

export type Theme = "light" | "dark";

const THEME_KEY = "archive-console-theme";

class ThemeStore {
  value: Theme = $state(initialTheme());

  toggle(): void {
    this.value = this.value === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, this.value);
  }
}

export const themeStore = new ThemeStore();

export function toggleTheme(): void {
  themeStore.toggle();
}

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const chats = $state<{
  items: ChatLedger[];
  loading: boolean;
  loaded: boolean;
  error: string;
  capped: boolean;
}>({ items: [], loading: false, loaded: false, error: "", capped: false });

/** 最近一次检索结果缓存：返回检索页时直接呈现，不再重复请求。 */
export const searchCache = $state<{ key: string; results: ArchiveSearchResult | null }>({ key: "", results: null });

/** 离开检索页时记住的滚动位置，返回时按查询键恢复。 */
export const searchScroll = $state<{ key: string; top: number }>({ key: "", top: 0 });

export async function loadChats(force = false): Promise<void> {
  if (chats.loading || (chats.loaded && !force)) return;
  chats.loading = true;
  chats.error = "";
  try {
    const result = await fetchChats();
    chats.items = [...result.chats];
    chats.capped = result.capped;
  } catch (error) {
    chats.error = error instanceof Error ? error.message : String(error);
  } finally {
    chats.loading = false;
    chats.loaded = true;
  }
}

export interface LightboxItem {
  readonly name: string;
  readonly mime: string;
  readonly size?: number;
  readonly spec: string;
  load(): Promise<{ url: string; source: "落盘" | "在线" }>;
}

export const lightbox = $state<{
  open: boolean;
  items: LightboxItem[];
  index: number;
  src: string;
  failed: boolean;
  source: "落盘" | "在线";
}>({ open: false, items: [], index: 0, src: "", failed: false, source: "落盘" });

export function showLightbox(items: LightboxItem[], index: number): void {
  lightbox.items = items;
  lightbox.index = index;
  lightbox.open = true;
}

export function closeLightbox(): void {
  lightbox.open = false;
  lightbox.items = [];
  lightbox.src = "";
}

export function stepLightbox(delta: number): void {
  if (lightbox.items.length < 2) return;
  lightbox.index = (lightbox.index + delta + lightbox.items.length) % lightbox.items.length;
}

export const pendingSearchFocus = $state({ armed: false });

/** / 快捷键：检索框存在即聚焦，否则先回检索页再聚焦。 */
export function requestSearchFocus(): void {
  const field = document.getElementById("global-search");
  if (field) {
    field.focus();
    return;
  }
  pendingSearchFocus.armed = true;
}