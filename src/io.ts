import fs from "node:fs/promises";

export async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  const text = await readUtf8(filePath);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`JSON 解析失败：${filePath}：${(error as Error).message}`);
  }
}

export function findLine(text: string, needle: string, fromLine = 1): number {
  const lines = text.split(/\r?\n/);
  for (let index = Math.max(0, fromLine - 1); index < lines.length; index += 1) {
    if (lines[index]?.includes(needle)) return index + 1;
  }
  return fromLine;
}
