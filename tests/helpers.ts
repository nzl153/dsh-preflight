import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

export async function makeTempDir(prefix = "dsh-preflight-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

export function makeTarGz(
  entries: Array<{ name: string; content?: string; type?: "file" | "directory" | "symlink" | "pax" | "longname"; linkName?: string }>
): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "", "utf8");
    const header = Buffer.alloc(512, 0);
    writeField(header, 0, 100, entry.name);
    writeField(header, 100, 8, "0000777");
    writeField(header, 108, 8, "0000000");
    writeField(header, 116, 8, "0000000");
    const hasContent = entry.type === "file" || !entry.type || entry.type === "pax" || entry.type === "longname";
    writeField(header, 124, 12, toOctal(hasContent ? content.length : 0, 11));
    writeField(header, 136, 12, toOctal(Math.floor(Date.now() / 1000), 11));
    header.fill(0x20, 148, 156);
    header[156] = (entry.type === "directory" ? "5" : entry.type === "symlink" ? "2" : entry.type === "pax" ? "x" : entry.type === "longname" ? "L" : "0").charCodeAt(0);
    if (entry.linkName) writeField(header, 157, 100, entry.linkName);
    writeField(header, 257, 6, "ustar");
    writeField(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeField(header, 148, 8, toOctal(checksum, 6) + "\0 ");
    blocks.push(header);
    if (content.length > 0 && hasContent) {
      blocks.push(content);
      const padding = (512 - (content.length % 512)) % 512;
      if (padding > 0) blocks.push(Buffer.alloc(padding, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

function writeField(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value.slice(0, length), offset, length, "utf8");
}

function toOctal(value: number, width: number): string {
  return value.toString(8).padStart(width, "0");
}
