import { isSessionUnavailable } from "@paperkite/sdk";

export type SessionFailureKind = "auth" | "account" | "action" | "none";

const AUTH_NAMES = [
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "AUTH_KEY_DUPLICATED",
  "AUTH_KEY_PERM_EMPTY",
  "AUTH_KEY_BANNED",
  "AUTH_KEY_NOT_FOUND",
  "AUTH_RESTART",
  "RESTART_AUTH",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "SESSION_PASSWORD_NEEDED",
  "ACTIVE_USER_LIMIT",
  "USER_DEACTIVATED_BAN",
  "USER_DEACTIVATED",
  "PHONE_CODE_INVALID",
  "PHONE_CODE_EXPIRED",
  "PHONE_NUMBER_INVALID",
  "PHONE_NUMBER_BANNED"
];

const ACCOUNT_NAMES = [
  "FLOOD_WAIT",
  "FLOOD_PREMIUM_WAIT",
  "FLOOD",
  "MSG_WAIT",
  "CONNECTION_NOT_INITED",
  "NETWORK_MIGRATE",
  "USER_MIGRATE",
  "PHONE_MIGRATE",
  "FILE_MIGRATE",
  "INTERNAL"
];

const ACTION_NAMES = ["SLOWMODE_WAIT", "EMAIL_UNCONFIRMED"];

const NETWORK_PHRASES = [
  "CONNECTION CLOSED",
  "CONNECTION LOST",
  "CONNECTION REFUSED",
  "CONNECTION ERROR",
  "SOCKET CLOSED",
  "SOCKET ERROR",
  "UNABLE TO CONNECT",
  "CANNOT CONNECT",
  "RECONNECT",
  "UNEXPECTED DATA CENTER",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "TIMED OUT",
  "REQUEST TIMEOUT",
  "NETWORK ERROR"
];

export function classifySessionFailure(error: unknown): SessionFailureKind {
  if (isSessionUnavailable(error)) return "none";
  const fields = rpcFields(error);
  if (fields) return classifyRpc(fields.name, fields.code);
  const text = String(error instanceof Error ? error.message : error).toUpperCase();
  if (containsAny(text, AUTH_NAMES)) return "auth";
  if (containsAny(text, NETWORK_PHRASES)) return "account";
  return "none";
}

function classifyRpc(name: string, code: number | undefined): SessionFailureKind {
  if (containsAny(name, AUTH_NAMES)) return "auth";
  if (containsAny(name, ACCOUNT_NAMES)) return "account";
  if (containsAny(name, ACTION_NAMES)) return "action";
  const absolute = code === undefined ? 0 : Math.abs(code);
  if (absolute === 401 || absolute === 406) return "auth";
  if (absolute === 420 || (absolute >= 500 && absolute <= 599)) return "account";
  if (absolute === 400 || absolute === 403 || absolute === 404 || absolute === 409 || absolute === 303) {
    return "action";
  }
  return "none";
}

function rpcFields(error: unknown): { name: string; code: number | undefined } | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { errorMessage?: unknown; code?: unknown };
  if (typeof candidate.errorMessage !== "string") return undefined;
  return {
    name: candidate.errorMessage.toUpperCase(),
    code: typeof candidate.code === "number" ? candidate.code : undefined
  };
}

function containsAny(text: string, names: readonly string[]): boolean {
  return names.some((name) => text.includes(name));
}
