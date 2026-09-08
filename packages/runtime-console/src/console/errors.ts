export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function isHttpError(value: unknown): value is HttpError {
  return value instanceof HttpError;
}