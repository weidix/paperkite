import { resolve } from "node:path";
import { PostgresArchiveStore } from "./postgres.js";
import { SqliteArchiveStore } from "./sqlite.js";
import type { ArchiveStore, ArchiveStoreOptions } from "./model.js";

export * from "./model.js";
export { PostgresArchiveStore } from "./postgres.js";
export { SqliteArchiveStore } from "./sqlite.js";

export function createArchiveStore(options: ArchiveStoreOptions = {}): ArchiveStore {
  const url = options.url ?? "sqlite:data/archive.db";
  if (resolveBackend(url) === "sqlite") {
    const file = url.slice("sqlite:".length) || "data/archive.db";
    return new SqliteArchiveStore(resolve(file));
  }
  return new PostgresArchiveStore(url, options.schema ?? "public");
}

export function resolveBackend(url: string | undefined): "sqlite" | "postgres" {
  const value = (url ?? "sqlite:data/archive.db").trim().toLowerCase();
  if (value.startsWith("postgres:") || value.startsWith("postgresql:")) return "postgres";
  if (value.startsWith("sqlite:")) return "sqlite";
  throw new Error(`unknown archive backend scheme in url: ${String(url)} (use sqlite: or postgresql:)`);
}