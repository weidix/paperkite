import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isIP } from "node:net";
import { basename, join, resolve } from "node:path";

export interface SessionMigrationResult {
  readonly migrated: readonly string[];
  readonly skipped: readonly string[];
}

interface LegacySessionRow {
  readonly dc_id: unknown;
  readonly server_address: unknown;
  readonly port: unknown;
  readonly auth_key: unknown;
}

export async function migrateSessionDirectory(
  sourceDirectory: string,
  targetDirectory: string,
  force = false
): Promise<SessionMigrationResult> {
  const source = resolve(sourceDirectory);
  const target = resolve(targetDirectory);
  if (source === target) throw new Error("session source and target must be different directories");
  const entries = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".session"))
    .map((entry) => entry.name)
    .sort();
  await mkdir(target, { recursive: true });
  const migrated: string[] = [];
  const skipped: string[] = [];
  for (const name of entries) {
    const destination = join(target, name);
    if (!force && await exists(destination)) {
      skipped.push(name);
      continue;
    }
    const value = await convertSessionFile(join(source, name));
    await writeFile(destination, value, { encoding: "utf8", flag: force ? "w" : "wx" });
    migrated.push(name);
  }
  return { migrated, skipped };
}

export async function convertSessionFile(file: string): Promise<string> {
  const database = new DatabaseSync(resolve(file), { readOnly: true });
  try {
    const row = database.prepare(
      "SELECT dc_id, server_address, port, auth_key FROM sessions LIMIT 1"
    ).get() as LegacySessionRow | undefined;
    if (!row) throw new Error("session has no authenticated account: " + basename(file));
    return encodeStringSession(row, file);
  } finally {
    database.close();
  }
}

function encodeStringSession(row: LegacySessionRow, file: string): string {
  const dcId = integer(row.dc_id, "dc_id", file);
  if (dcId < 1 || dcId > 255) throw new Error("session dc_id is outside the supported range: " + basename(file));
  const address = String(row.server_address ?? "").trim();
  const addressVersion = isIP(address);
  const addressBytes = encodeAddress(address, addressVersion, file);
  const port = integer(row.port, "port", file);
  if (port < 1 || port > 65_535) throw new Error("session port is invalid: " + basename(file));
  const authKey = toBytes(row.auth_key);
  if (authKey.byteLength !== 256) throw new Error("session auth_key must be 256 bytes: " + basename(file));
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  const addressPart = addressVersion === 4
    ? addressBytes
    : Buffer.concat([lengthPrefix(addressBytes.byteLength), addressBytes]);
  return "1" + Buffer.concat([
    Buffer.from([dcId]),
    addressPart,
    portBytes,
    authKey
  ]).toString("base64");
}

function encodeAddress(value: string, version: number, file: string): Buffer {
  if (version === 4) return Buffer.from(value.split(".").map((part) => Number(part)));
  if (version === 6) return Buffer.from(value);
  throw new Error("session server_address is not an IP address: " + basename(file));
}

function lengthPrefix(value: number): Buffer {
  const result = Buffer.alloc(2);
  result.writeInt16BE(value);
  return result;
}

function integer(value: unknown, field: string, file: string): number {
  const result = Number(value);
  if (!Number.isInteger(result)) throw new Error("session " + field + " is invalid: " + basename(file));
  return result;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return value;
  throw new Error("session auth_key is not binary");
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
