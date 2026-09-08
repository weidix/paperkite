import { open } from "node:fs/promises";

const TAIL_CHUNK_SIZE = 256 * 1024;
const MAX_LINES = 2_000;

export async function tailFile(filePath: string, requestedLines: number): Promise<string[]> {
  const desired = Math.min(Math.max(1, Math.trunc(requestedLines)), MAX_LINES);
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) return [];
    const chunkSize = Math.min(size, TAIL_CHUNK_SIZE);
    const buffer = Buffer.alloc(chunkSize);
    await handle.read(buffer, 0, chunkSize, size - chunkSize);
    let text = buffer.toString("utf8");
    const firstNewline = size > chunkSize ? text.indexOf("\n") : -1;
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines.slice(-desired);
  } finally {
    await handle.close();
  }
}