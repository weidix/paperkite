import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export interface ProcessLock {
  release(): Promise<void>;
}

export async function acquireProcessLock(file: string): Promise<ProcessLock> {
  await mkdir(dirname(file), { recursive: true });
  try {
    const handle = await open(file, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await handle.close();
        await unlink(file).catch(() => undefined);
      }
    };
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const existing = await readLock(file);
    if (existing?.pid && isRunning(existing.pid)) {
      throw new Error("another paperkite process is using " + file);
    }
    await unlink(file).catch(() => undefined);
    return acquireProcessLock(file);
  }
}

async function readLock(file: string): Promise<{ pid?: number } | undefined> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (typeof value === "object" && value !== null && "pid" in value) {
      const pid = Number((value as { pid?: unknown }).pid);
      return Number.isInteger(pid) ? { pid } : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isRunning(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
