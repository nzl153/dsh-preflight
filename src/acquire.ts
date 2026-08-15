import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import { exists, realpathDirectory, removeTreeSafe } from "./fs-safe.js";
import { extractTarGz } from "./tar.js";
import type { CandidateArtifact, SourceSpec } from "./types.js";

export interface AcquireOptions {
  registry?: string;
  githubCodeload?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxDownloadBytes?: number;
  tempRoot?: string;
}

const DEFAULT_MAX_DOWNLOAD = 64 * 1024 * 1024;

export async function acquireCandidate(
  source: SourceSpec,
  options: AcquireOptions = {}
): Promise<CandidateArtifact> {
  if (source.kind === "local") {
    const rootDir = await realpathDirectory(source.path);
    if (!(await exists(path.join(rootDir, "package.json")))) {
      throw new Error("本地目录缺少 package.json：" + rootDir);
    }
    return {
      source,
      rootDir,
      installSpec: rootDir,
      temporary: false,
      async dispose() {}
    };
  }

  const tempBase = options.tempRoot ?? os.tmpdir();
  await fs.mkdir(tempBase, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tempBase, "dsh-preflight-"));
  try {
    const fetcher = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD;
    let archiveUrl: string;
    let integrity: string | undefined;
    let resolvedVersion: string | undefined;

    if (source.kind === "npm") {
      const registry = (options.registry ?? "https://registry.npmjs.org").replace(/\/$/, "");
      const encodedName = source.packageName.startsWith("@")
        ? source.packageName.replace("/", "%2f")
        : encodeURIComponent(source.packageName);
      const packument = await fetchJson(
        fetcher,
        registry + "/" + encodedName,
        timeoutMs,
        maxBytes
      ) as NpmPackument;
      const selected = selectNpmVersion(packument, source.selector);
      resolvedVersion = selected.version;
      archiveUrl = selected.dist?.tarball ?? "";
      integrity = selected.dist?.integrity;
      if (!archiveUrl) throw new Error("npm metadata 缺少 dist.tarball。 ");
    } else {
      const codeload = (options.githubCodeload ?? "https://codeload.github.com").replace(/\/$/, "");
      archiveUrl = `${codeload}/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/tar.gz/${encodeURIComponent(source.ref)}`;
    }

    const archive = await fetchBuffer(fetcher, archiveUrl, timeoutMs, maxBytes);
    if (integrity) verifyIntegrity(archive, integrity);
    const extraction = await extractTarGz(archive, path.join(tempDir, "content"));
    return {
      source,
      rootDir: extraction.rootDir,
      installSpec: source.raw,
      ...(resolvedVersion ? { resolvedVersion } : {}),
      temporary: true,
      async dispose() {
        await removeTreeSafe(tempDir);
      }
    };
  } catch (error) {
    await removeTreeSafe(tempDir);
    throw error;
  }
}

interface NpmVersion {
  version?: string;
  dist?: { tarball?: string; integrity?: string };
}
interface NpmPackument {
  versions?: Record<string, NpmVersion>;
  "dist-tags"?: Record<string, string>;
}

function selectNpmVersion(packument: NpmPackument, selector: string): Required<Pick<NpmVersion, "version">> & NpmVersion {
  const tagged = packument["dist-tags"]?.[selector];
  const ranged = !tagged && semver.validRange(selector)
    ? semver.maxSatisfying(Object.keys(packument.versions ?? {}), selector, { includePrerelease: true }) ?? undefined
    : undefined;
  const version = tagged ?? ranged ?? selector;
  const selected = packument.versions?.[version];
  if (!selected) throw new Error("npm 中找不到版本或 dist-tag：" + selector);
  return { ...selected, version: selected.version ?? version };
}

async function fetchJson(fetcher: typeof fetch, url: string, timeoutMs: number, maxBytes: number): Promise<unknown> {
  const buffer = await fetchBuffer(fetcher, url, timeoutMs, maxBytes);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("远端返回的 JSON 无效：" + url);
  }
}

async function fetchBuffer(fetcher: typeof fetch, url: string, timeoutMs: number, maxBytes: number): Promise<Buffer> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("下载体积超过限制：" + maxBytes + " 字节");
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of response.body) {
    const chunk = Buffer.from(raw);
    total += chunk.length;
    if (total > maxBytes) throw new Error("下载体积超过限制：" + maxBytes + " 字节");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function verifyIntegrity(data: Buffer, integrity: string): void {
  const token = integrity.split(/\s+/).find((item) => item.startsWith("sha512-"));
  if (!token) return;
  const actual = createHash("sha512").update(data).digest("base64");
  if (actual !== token.slice("sha512-".length)) throw new Error("npm tarball integrity 校验失败。");
}
