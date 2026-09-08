import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export function normalizeSessionName(value: string): string {
  const result = String(value).trim();
  if (!result) throw new Error("session name cannot be empty");
  return result.endsWith(".session") ? result.slice(0, -8) : result;
}

export function sessionFilePath(directory: string, name: string): string {
  const filename = name.endsWith(".session") ? name : name + ".session";
  if (basename(filename) !== filename) throw new Error("invalid session name: " + name);
  return join(directory, filename);
}

export async function readSessionFile(directory: string, name: string): Promise<string> {
  const path = sessionFilePath(directory, name);
  try {
    await access(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "";
    throw error;
  }
  return readFile(path, "utf8");
}

export async function writeSessionFile(directory: string, name: string, value: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(sessionFilePath(directory, name), value, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}