import { readFile, writeFile } from "node:fs/promises";
import type { FlowSection } from "./model.js";

export async function setEnabledInFile(
  file: string,
  section: FlowSection,
  sourceIndex: number,
  id: string,
  enabled: boolean
): Promise<void> {
  const original = await readFile(file, "utf8");
  const lines = original.split(/(?<=\n)/);
  const sectionStart = lines.findIndex((line) => /^\s*(triggers|commands|schedules|services):\s*(?:#.*)?$/.test(line) && line.trimStart().startsWith(`${section}:`));
  if (sectionStart < 0) throw new Error(`missing ${section} section`);
  const sectionIndent = leadingSpaces(lines[sectionStart] ?? "");
  const sectionEnd = lines.findIndex((line, index) => index > sectionStart && line.trim() && leadingSpaces(line) <= sectionIndent);
  const end = sectionEnd < 0 ? lines.length : sectionEnd;
  const itemStarts: number[] = [];
  const itemIds: string[] = [];
  for (let index = sectionStart + 1; index < end; index += 1) {
    const match = /^\s*-\s+id:\s*(['"]?)([^'"#\s]+)\1\s*(?:#.*)?$/.exec((lines[index] ?? "").replace(/\r?\n$/, ""));
    if (match) {
      itemStarts.push(index);
      itemIds.push(match[2] ?? "");
    }
  }
  const targetPosition = itemIds.indexOf(id);
  const itemStart = targetPosition >= 0 ? itemStarts[targetPosition] : itemStarts[sourceIndex];
  if (itemStart === undefined) throw new Error(`missing ${section} item: ${id}`);
  const itemIndent = leadingSpaces(lines[itemStart] ?? "");
  const nextStart = itemStarts.find((value) => value > itemStart && leadingSpaces(lines[value] ?? "") <= itemIndent) ?? end;
  const value = enabled ? "true" : "false";
  for (let index = itemStart; index < nextStart; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(\s*)enabled\s*:\s*([^#\r\n]*)(.*)$/.exec(line.replace(/\r?\n$/, ""));
    if (!match) continue;
    const newline = line.endsWith("\n") ? "\n" : "";
    const comment = match[3]?.trim() ?? "";
    lines[index] = `${match[1]}enabled: ${value}${comment ? ` ${comment}` : ""}${newline}`;
    await writeFile(file, lines.join(""), "utf8");
    return;
  }
  const childIndent = findChildIndent(lines, itemStart + 1, nextStart, itemIndent + 2);
  lines.splice(itemStart + 1, 0, `${" ".repeat(childIndent)}enabled: ${value}\n`);
  await writeFile(file, lines.join(""), "utf8");
}

function leadingSpaces(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function findChildIndent(lines: string[], start: number, end: number, fallback: number): number {
  for (let index = start; index < end; index += 1) {
    if ((lines[index] ?? "").trim()) return leadingSpaces(lines[index] ?? "");
  }
  return fallback;
}
