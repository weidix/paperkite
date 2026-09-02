import { readFile, writeFile } from "node:fs/promises";
import { YAMLMap, YAMLSeq, parseDocument } from "yaml";
import type { FlowSection } from "./model.js";

export async function updateItemInFile(
  file: string,
  section: FlowSection,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const text = await readFile(file, "utf8");
  const doc = parseDocument(text, { merge: true });
  const items = doc.get(section);
  if (!(items instanceof YAMLSeq)) throw new Error(`missing ${section} section`);
  const index = items.items.findIndex((item) => item instanceof YAMLMap && item.get("id") === id);
  if (index < 0) throw new Error(`missing ${section} item: ${id}`);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    doc.setIn([section, index, key], value);
  }
  await writeFile(file, doc.toString(), "utf8");
}