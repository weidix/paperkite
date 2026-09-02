import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { RuntimeEvent, RuntimeSnapshot } from "@/lib/runtime";

export interface EventEntry {
  readonly seq: number;
  readonly event: RuntimeEvent;
}

interface RuntimeValue {
  readonly snapshot: RuntimeSnapshot | null;
  readonly snapshotAt: number;
  readonly connected: boolean;
  readonly events: readonly EventEntry[];
  readonly refresh: () => Promise<void>;
}

const MAX_EVENTS = 600;
const POLL_INTERVAL_MS = 6_000;
const REFRESH_DEBOUNCE_MS = 400;

const RuntimeContext = createContext<RuntimeValue>({
  snapshot: null,
  snapshotAt: 0,
  connected: false,
  events: [],
  refresh: async () => undefined
});

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [snapshotAt, setSnapshotAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const seqRef = useRef(0);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
      setSnapshotAt(Date.now());
    } catch {
      // snapshot stays stale while the console itself is reachable
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== undefined) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = undefined;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => {
      setConnected(true);
      void refresh();
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as RuntimeEvent;
        seqRef.current += 1;
        setEvents((current) => [...current.slice(-(MAX_EVENTS - 1)), { seq: seqRef.current, event }]);
        scheduleRefresh();
      } catch {
        // malformed frames are ignored
      }
    };
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      source.close();
      window.clearInterval(interval);
      if (refreshTimerRef.current !== undefined) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refresh, scheduleRefresh]);

  return (
    <RuntimeContext.Provider value={{ snapshot, snapshotAt, connected, events, refresh }}>{children}</RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeValue {
  return useContext(RuntimeContext);
}