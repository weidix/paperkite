export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE"
]);

export function isDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== "string") return false;
  if (NETWORK_ERROR_CODES.has(code)) return true;
  return /^(08|57P0[123]|53300)/.test(code);
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}