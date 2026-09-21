import { api } from "$lib/api";
import type { RuntimeEvent, RuntimeSnapshot } from "$lib/runtime";

export interface EventEntry {
  readonly seq: number;
  readonly event: RuntimeEvent;
}

const MAX_EVENTS = 2000;
const POLL_INTERVAL_MS = 6_000;
const REFRESH_DEBOUNCE_MS = 400;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

class RuntimeStore {
  snapshot: RuntimeSnapshot | null = $state(null);
  snapshotAt = $state(0);
  connected = $state(false);
  events: EventEntry[] = $state([]);
  /** SSE 传输层是否可用（EventSource 为 null 表示未连接） */
  private source: EventSource | null = null;
  private seq = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private stopped = false;

  start(): void {
    this.stopped = false;
    if (this.source) return;
    this.connect();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (!document.hidden) void this.refresh();
    }, POLL_INTERVAL_MS);
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    this.connected = false;
    this.reconnectDelay = RECONNECT_BASE_MS;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  async refresh(): Promise<void> {
    try {
      this.snapshot = await api.snapshot();
      this.snapshotAt = Date.now();
    } catch {
      // 快照保持上一次的值，等待下一次轮询
    }
  }

  private onVisibility = (): void => {
    if (!document.hidden) {
      if (!this.source && !this.stopped) this.connect();
      void this.refresh();
    }
  };

  private connect(): void {
    if (this.stopped || this.source) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const source = new EventSource("/api/events");
    this.source = source;
    source.onopen = () => {
      this.connected = true;
      this.reconnectDelay = RECONNECT_BASE_MS;
      void this.refresh();
    };
    source.onerror = () => {
      this.connected = false;
      source.close();
      if (this.source === source) this.source = null;
      if (!this.stopped) this.scheduleReconnect();
    };
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as RuntimeEvent;
        this.seq += 1;
        this.events.push({ seq: this.seq, event });
        if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        this.scheduleRefresh();
      } catch {
        // 解析失败的消息帧直接忽略
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.source || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && !this.source) this.connect();
    }, delay);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!document.hidden) void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }
}

export const runtime = new RuntimeStore();