import { resolve } from "node:path";
import { PostgresArchiveStore } from "./postgres.js";
import { SqliteArchiveStore } from "./sqlite.js";
import type { ArchiveStore, ArchiveStoreOptions } from "./model.js";

export * from "./model.js";
export { PostgresArchiveStore } from "./postgres.js";
export { SqliteArchiveStore } from "./sqlite.js";

export function createArchiveStore(options: ArchiveStoreOptions = {}): ArchiveStore {
  const backend = (options.backend ?? inferBackend(options)).toLowerCase();
  if (backend === "sqlite") {
    const file = options.file ?? "data/archive.db";
    return new SqliteArchiveStore(resolve(file));
  }
  if (backend === "postgres" || backend.startsWith("pg")) {
    if (!options.url) throw new Error("postgres archive backend needs url");
    return new PostgresArchiveStore(options.url, options.schema ?? "public");
  }
  throw new Error(`unknown archive backend: ${backend} (choose sqlite or postgres)`);
}

function inferBackend(options: ArchiveStoreOptions): string {
  if (options.url) return "postgres";
  if (options.backend) return options.backend;
  return "sqlite";
}