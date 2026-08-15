import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { TarExtractionResult, TarLimits } from "./types.js";

const BLOCK_SIZE = 512;

const DEFAULT_LIMITS: TarLimits = {
  maxUnpackedBytes: 200 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxFiles: 10_000
};

export async function extractTarGz(
  archive: Buffer,
  destination: string,
  limits: Partial<TarLimits> = {}
): Promise<TarExtractionResult> {
  const applied: TarLimits = { ...DEFAULT_LIMITS, ...limits };
  const tarLimit =
    applied.maxUnpackedBytes +
    applied.maxFiles * BLOCK_SIZE * 2 +
    2 * 1024 * 1024;
  const tar = await gunzipBounded(archive, tarLimit);
  await fs.mkdir(destination, { recursive: true });

  const extractedFiles: string[] = [];
  const skippedLinks: string[] = [];
  const topLevels = new Set<string>();
  let totalPayload = 0;
  let fileCount = 0;
  let offset = 0;
  let nextLongName: string | undefined;
  let nextPaxPath: string | undefined;

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) break;
    verifyChecksum(header);

    const rawName = readTextField(header, 0, 100);
    const prefix = readTextField(header, 345, 155);
    const headerName = prefix ? prefix + "/" + rawName : rawName;
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error("tar 条目内容被截断：" + headerName);
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (typeFlag === "L") {
      nextLongName = trimNull(data.toString("utf8"));
      continue;
    }
    if (typeFlag === "x") {
      nextPaxPath = parsePaxPath(data);
      continue;
    }
    if (typeFlag === "g") continue;

    const archivePath = nextPaxPath ?? nextLongName ?? headerName;
    nextPaxPath = undefined;
    nextLongName = undefined;
    const safeRelative = validateArchivePath(archivePath);
    if (!safeRelative) continue;
    topLevels.add(safeRelative.split("/")[0] ?? safeRelative);

    if (typeFlag === "1" || typeFlag === "2") {
      skippedLinks.push(safeRelative);
      continue;
    }

    const target = resolveInside(destination, safeRelative);
    if (typeFlag === "5") {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    if (typeFlag !== "0" && typeFlag !== "\0" && typeFlag !== "") continue;

    fileCount += 1;
    if (fileCount > applied.maxFiles) {
      throw new Error("归档文件数量超过限制：" + applied.maxFiles);
    }
    if (size > applied.maxFileBytes) {
      throw new Error(
        "归档单文件超过限制：" + safeRelative + "，上限 " + applied.maxFileBytes + " 字节"
      );
    }
    totalPayload += size;
    if (totalPayload > applied.maxUnpackedBytes) {
      throw new Error("归档解压体积超过限制：" + applied.maxUnpackedBytes + " 字节");
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    extractedFiles.push(safeRelative);
  }

  const rootDir = await findArchiveRoot(destination, topLevels);
  return { rootDir, extractedFiles, skippedLinks, unpackedBytes: totalPayload };
}

async function gunzipBounded(archive: Buffer, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = Readable.from([archive]).pipe(createGunzip());
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error("gzip 解压数据超过安全上限：" + maxBytes + " 字节");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validateArchivePath(rawPath: string): string {
  const slashPath = rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    !slashPath ||
    slashPath.startsWith("/") ||
    slashPath.startsWith("//") ||
    /^[A-Za-z]:\//.test(slashPath)
  ) {
    throw new Error("不安全的归档路径：" + rawPath);
  }
  const segments = slashPath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error("不安全的归档路径：" + rawPath);
  }
  if (segments.some(isUnsafeWindowsSegment)) {
    throw new Error("不安全的 Windows 归档路径：" + rawPath);
  }
  return segments.filter((segment) => segment !== ".").join("/");
}

function isUnsafeWindowsSegment(segment: string): boolean {
  return (
    /[<>:"|?*\x00-\x1f]/.test(segment) ||
    /[ .]$/.test(segment) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
  );
}

function resolveInside(root: string, relative: string): string {
  const target = path.resolve(root, ...relative.split("/"));
  const relation = path.relative(path.resolve(root), target);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("不安全的归档路径：" + relative);
  }
  return target;
}

async function findArchiveRoot(destination: string, topLevels: Set<string>): Promise<string> {
  if (topLevels.size === 1) {
    const only = [...topLevels][0];
    if (only) {
      const candidate = path.join(destination, only);
      if (await exists(path.join(candidate, "package.json"))) return candidate;
    }
  }
  if (await exists(path.join(destination, "package.json"))) return destination;
  for (const topLevel of topLevels) {
    const candidate = path.join(destination, topLevel);
    if (await exists(path.join(candidate, "package.json"))) return candidate;
  }
  throw new Error("归档中找不到根 package.json。");
}

function parsePaxPath(data: Buffer): string | undefined {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(data.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const end = offset + length;
    if (end > data.length) break;
    const record = data.subarray(space + 1, end - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals >= 0 && record.slice(0, equals) === "path") {
      return record.slice(equals + 1);
    }
    offset += length;
  }
  return undefined;
}

function verifyChecksum(header: Buffer): void {
  const expected = readOctal(header, 148, 8);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (expected !== actual) {
    throw new Error("tar header checksum 不匹配。");
  }
}

function readTextField(buffer: Buffer, offset: number, length: number): string {
  return trimNull(buffer.subarray(offset, offset + length).toString("utf8"));
}

function trimNull(value: string): string {
  const nullIndex = value.indexOf("\0");
  return (nullIndex >= 0 ? value.slice(0, nullIndex) : value).trim();
}

function readOctal(buffer: Buffer, offset: number, length: number): number {
  const raw = readTextField(buffer, offset, length).replace(/\0/g, "").trim();
  if (!raw) return 0;
  const value = Number.parseInt(raw, 8);
  if (!Number.isFinite(value) || value < 0) throw new Error("tar 数值字段无效：" + raw);
  return value;
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
