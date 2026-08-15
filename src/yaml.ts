import path from "node:path";
import yaml from "js-yaml";
import { findLine, readUtf8 } from "./io.js";
import type { PatchEntry } from "./types.js";

const jsScalar = new yaml.Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  construct: (value) => value ?? ""
});
const DSH_SCHEMA = yaml.DEFAULT_SCHEMA.extend([jsScalar]);

export async function readPatchEntries(filePath: string): Promise<PatchEntry[]> {
  const text = await readUtf8(filePath);
  let document: unknown;
  try {
    document = yaml.load(text, { schema: DSH_SCHEMA, filename: filePath });
  } catch (error) {
    throw new Error(`YAML 解析失败：${filePath}：${(error as Error).message}`);
  }
  if (document == null) return [];
  if (!Array.isArray(document)) throw new Error("DSH patch 顶层必须是数组：" + filePath);
  const result: PatchEntry[] = [];
  let lineCursor = 1;
  for (const row of document) {
    if (!isObject(row)) continue;
    if (Array.isArray(row.insert)) {
      for (const item of row.insert) {
        if (!isObject(item) || typeof item.id !== "string") continue;
        const line = findLine(text, "id: " + item.id, lineCursor);
        lineCursor = line;
        result.push(toEntry(item, filePath, line));
      }
    } else if (typeof row.id === "string") {
      const line = findLine(text, "id: " + row.id, lineCursor);
      lineCursor = line;
      result.push(toEntry(row, filePath, line));
    }
  }
  return result;
}

function toEntry(value: Record<string, unknown>, sourceFile: string, line: number): PatchEntry {
  return {
    id: String(value.id),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(isObject(value.config) ? { config: value.config } : {}),
    sourceFile: path.resolve(sourceFile),
    line
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
