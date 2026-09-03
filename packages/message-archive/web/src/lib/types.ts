export type TimeMode = "include" | "exclude" | "off";

export interface MediaItem {
  readonly id?: string | null;
  readonly message_id?: number | null;
  readonly message_rowid?: string | null;
  readonly media_url: string;
  readonly media_type?: string | null;
  readonly mime_type?: string | null;
}

export interface SearchRow {
  readonly id: string;
  readonly message_id: number;
  readonly chat_id: string;
  readonly grouped_id: string | null;
  readonly chat_title: string | null;
  readonly date: string;
  readonly sender_id: string | null;
  readonly sender_username: string | null;
  readonly sender_first_name: string | null;
  readonly sender_last_name: string | null;
  readonly has_media: boolean;
  readonly media_type: string | null;
  readonly mime_type: string | null;
  readonly message_type: string | null;
  readonly text: string;
  readonly media_items: readonly MediaItem[];
  readonly has_preview: boolean;
  readonly media_url: string | null;
}

export interface SearchPayload {
  readonly items: readonly SearchRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ContextPayload {
  readonly anchor: SearchRow | null;
  readonly before: readonly SearchRow[];
  readonly after: readonly SearchRow[];
  readonly before_n: number;
  readonly after_n: number;
}

export interface SearchQuery {
  readonly keyword: string;
  readonly excludeKeyword: string;
  readonly chatTitle: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly timeMode: TimeMode;
}

export interface SearchParams extends SearchQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface LightboxItem {
  readonly src: string;
  readonly alt: string;
}

export interface ContextTarget {
  readonly rowId: string;
  readonly keyword: string;
}