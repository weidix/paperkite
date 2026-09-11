import type { SessionState, SessionUnavailable } from "@paperkite/sdk";

export class SessionUnavailableError extends Error implements SessionUnavailable {
  readonly code = "session_unavailable";

  constructor(
    readonly session: string,
    readonly state: SessionState,
    reason?: string
  ) {
    super("session " + session + " is " + state + (reason ? ": " + reason : ""));
  }
}

export function isSessionUnavailable(error: unknown): error is SessionUnavailable {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "session_unavailable";
}
