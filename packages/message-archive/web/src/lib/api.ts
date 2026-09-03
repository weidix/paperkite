import type { ContextPayload, MediaItem, SearchParams, SearchPayload } from "@/lib/types";

const albumCache = new Map<string, Promise<MediaItem[]>>();

function toQueryString(data: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (response.ok) return response.json() as Promise<T>;
  throw new Error(await errorMessage(response));
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const payload = JSON.parse(text) as { error?: string };
    if (payload.error) return payload.error;
  } catch {
    // non-JSON body is shown as-is
  }
  return text || `HTTP ${response.status}`;
}

export const api = {
  search(params: SearchParams): Promise<SearchPayload> {
    const query = toQueryString({
      keyword: params.keyword,
      exclude_keyword: params.excludeKeyword,
      chat_title: params.chatTitle,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      time_mode: params.timeMode,
      limit: params.limit,
      offset: params.offset
    });
    return getJson(`/api/search/structured?${query}`);
  },

  context(messageRowId: string, before_n: number, after_n: number): Promise<ContextPayload> {
    const query = toQueryString({ message_rowid: messageRowId, before_n, after_n });
    return getJson(`/api/search/context?${query}`);
  },

  album(messageRowId: string): Promise<MediaItem[]> {
    let pending = albumCache.get(messageRowId);
    if (!pending) {
      pending = getJson<{ items?: readonly MediaItem[] }>(`/api/messages/${messageRowId}/album`)
        .then((payload) => (payload.items ?? []).filter((media) => media && media.media_url) as MediaItem[])
        .catch((error) => {
          albumCache.delete(messageRowId);
          throw error;
        });
      albumCache.set(messageRowId, pending);
    }
    return pending;
  }
};