import fs from "node:fs/promises";
import path from "node:path";
import { snapshotProfile } from "./profile.js";
import { createReport, quoteArg, type Report } from "./report.js";
import type { Finding, ProfileSnapshot } from "./types.js";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const DEFAULT_LOG_NAMES = ["dsh.err.log", "dsh.log", "dsh.restart.log", "launch-trace.log"];
const BUILT_IN_BUNDLES = new Set(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
const ERROR_LINE = /\b(?:error|fatal|exception|failed|ERR_[A-Z_]+)\b/i;

export interface ExplainOptions {
  profileDir: string;
  installRoot: string;
  profileName: string;
  logFile?: string;
}

interface LogContent {
  file: string;
  lines: string[];
}

interface LogRecord {
  file: string;
  line: string;
}

export async function explainRuntime(options: ExplainOptions): Promise<Report> {
  const profile = await snapshotProfile(options.profileDir, options.installRoot);
  const files = options.logFile
    ? [path.resolve(options.logFile)]
    : DEFAULT_LOG_NAMES.map((name) => path.join(options.installRoot, name));
  const logs = (await Promise.all(files.map(readLogTail))).filter((item): item is LogContent => item !== undefined);
  if (logs.length === 0) {
    return createReport("explain", options.profileName, [{
      id: "NO_LOGS_TO_ANALYZE",
      level: "INFO",
      category: "runtime",
      title: "没有可分析的日志",
      detail: "没有可分析的日志：文件不存在或内容为空。",
      evidence: files.join("; "),
      relatedFiles: files
    }]);
  }

  return createReport("explain", options.profileName, analyzeLogs(logs, profile, options.profileName));
}

async function readLogTail(file: string): Promise<LogContent | undefined> {
  let handle;
  try {
    handle = await fs.open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (stat.size === 0) return undefined;
    const length = Math.min(stat.size, MAX_LOG_BYTES);
    const position = stat.size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    let text = buffer.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, "");
    if (position > 0) {
      const firstNewline = text.indexOf("\n");
      if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.length > 0 ? { file, lines } : undefined;
  } finally {
    await handle.close();
  }
}

function analyzeLogs(logs: LogContent[], profile: ProfileSnapshot, profileName: string): Finding[] {
  const findings: Finding[] = [];
  const records = logs.flatMap((log) => log.lines.map((line) => ({ file: log.file, line })));

  const portLines = records.filter(({ line }) => /EADDRINUSE|address already in use/i.test(line));
  if (portLines.length > 0) findings.push({
    id: "PORT_ALREADY_IN_USE",
    level: "BLOCK",
    category: "runtime",
    title: "DSH 监听端口已被占用",
    detail: "新 DSH 实例没有成功启动。后续大量插件加载失败只是连锁表象，看起来像所有插件都坏了，实际根因通常是旧实例仍占用端口。",
    evidence: formatEvidence(portLines),
    consequence: "webServer 无法提供服务，等待它的插件会持续 pending 或加载失败。",
    remediation: "Get-NetTCPConnection -LocalPort 3080 -State Listen",
    relatedFiles: uniqueFiles(portLines)
  });

  const hasModuleNotFound = records.some(({ line }) => /ERR_MODULE_NOT_FOUND/.test(line));
  const missingEntries = new Map<string, LogRecord[]>();
  // 归不到包名的缺失文件单独存，否则它们会掉进 UNRECOGNIZED_ERROR，
  // 而「产物少了个文件」明明是能确定下结论的。
  const missingFiles = new Map<string, LogRecord[]>();
  if (hasModuleNotFound) {
    for (const record of records) {
      const packageName = packageFromInternalMissingPath(record.line, profile.resolvedPackages);
      if (packageName) {
        addMatch(missingEntries, packageName, record);
        continue;
      }
      const file = missingModulePath(record.line);
      if (file) addMatch(missingFiles, file, record);
    }
  }
  for (const [packageName, matches] of missingEntries) findings.push({
    id: "MODULE_ENTRY_MISSING",
    level: "BLOCK",
    category: "runtime",
    title: `已安装包缺少内部入口：${packageName}`,
    detail: `ERR_MODULE_NOT_FOUND 指向 ${packageName} 包内文件，发布产物可能没有包含声明的入口。`,
    evidence: formatEvidence(matches),
    remediation: `dsh-preflight check ${quoteArg(packageName)}`,
    relatedFiles: uniqueFiles(matches)
  });

  for (const [file, matches] of missingFiles) findings.push({
    id: "MODULE_ENTRY_MISSING",
    level: "BLOCK",
    category: "runtime",
    title: `导入失败的文件不存在：${file}`,
    detail: "ERR_MODULE_NOT_FOUND 指向的文件不在磁盘上，且该路径不落在任何已解析的包内，无法确定归属包名。常见于本地 link: 安装的插件没有重新构建。",
    evidence: formatEvidence(matches),
    remediation: "在该文件所属的插件目录执行其构建命令后重启 DSH。",
    relatedFiles: uniqueFiles(matches)
  });

  const unresolved = collectUnresolvedBundles(records, new Set(missingEntries.keys()));
  for (const [packageName, matches] of unresolved) {
    const inBundles = profile.bundles.includes(packageName);
    const inDependencies = Object.hasOwn(profile.dependencies, packageName);
    const resolvable = Object.hasOwn(profile.resolvedPackages, packageName);
    const residue = inBundles && !inDependencies && !BUILT_IN_BUNDLES.has(packageName);
    findings.push({
      id: "BUNDLE_UNRESOLVED_AT_BOOT",
      level: "BLOCK",
      category: "runtime",
      title: `启动时无法解析 bundle：${packageName}`,
      detail: residue
        ? `${packageName} 仍在 profile bundles 中，但不在 dependencies 且磁盘上无法解析。这符合插件卸载中断后留下的 bundles 残骸。`
        : `${packageName} 在启动时无法解析。profile 状态：bundles=${inBundles ? "有" : "无"}，dependencies=${inDependencies ? "有" : "无"}，磁盘=${resolvable ? "可解析" : "不可解析"}。`,
      evidence: formatEvidence(matches),
      remediation: `dsh-preflight audit --profile ${quoteArg(profileName)}`,
      relatedFiles: uniqueFiles(matches)
    });
  }

  const collisionLines = records.filter(({ line }) => isEntryCollision(line));
  if (collisionLines.length > 0) {
    const ids = collisionLines.map(({ line }) => extractEntryId(line)).filter((value): value is string => Boolean(value));
    findings.push({
      id: "ENTRY_ID_COLLISION_AT_BOOT",
      level: "BLOCK",
      category: "runtime",
      title: ids.length > 0 ? `启动时发现重复 entry id：${[...new Set(ids)].join("、")}` : "启动时发现重复 entry id",
      detail: "日志显示同一个 entry id 被重复注册或覆盖。",
      evidence: formatEvidence(collisionLines),
      remediation: `dsh-preflight audit --profile ${quoteArg(profileName)}`,
      relatedFiles: uniqueFiles(collisionLines)
    });
  }

  if (findings.length === 0) {
    const errors = records.filter(({ line }) => ERROR_LINE.test(line)).slice(0, 5);
    if (errors.length > 0) findings.push({
      id: "UNRECOGNIZED_ERROR",
      level: "UNKNOWN",
      category: "runtime",
      title: "日志包含无法归类的错误",
      detail: "现有确定性规则无法识别这些错误，未推断原因。",
      evidence: formatEvidence(errors, 5),
      relatedFiles: uniqueFiles(errors)
    });
  }

  return findings.length > 0 ? findings : [{
    id: "NO_RECOGNIZED_RUNTIME_ERROR",
    level: "INFO",
    category: "runtime",
    title: "日志中没有可识别的错误",
    detail: "读取到了日志，但没有匹配到错误行或已实现模式。",
    evidence: logs.map((log) => log.file).join("; "),
    relatedFiles: logs.map((log) => log.file)
  }];
}

function collectUnresolvedBundles(records: LogRecord[], internalMissingPackages: Set<string>): Map<string, LogRecord[]> {
  const result = new Map<string, LogRecord[]>();
  for (const record of records) {
    const packageName = extractUnresolvedPackage(record.line);
    if (!packageName || internalMissingPackages.has(packageName)) continue;
    addMatch(result, packageName, record);
  }
  return result;
}

function extractUnresolvedPackage(line: string): string | undefined {
  const patterns = [
    /(?:failed|unable) to resolve (?:bundle|package)\s+["']?(@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?)/i,
    /cannot find (?:package|module)\s+["'](@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?)["']/i,
    /bundle\s+["']?(@?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?)["']?.{0,80}(?:not found|unresolved|cannot be resolved)/i
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(line)?.[1];
    if (value) return value;
  }
  return undefined;
}

function missingModulePath(line: string): string | undefined {
  const raw = /cannot find (?:module|package)\s+["']([^"']+)["']/i.exec(line)?.[1];
  if (!raw) return undefined;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch {}
  return decoded.replace(/^file:\/\//i, "").replace(/\\/g, "/");
}

// 路径是否落在某个包根目录之内。纯前缀比较，大小写不敏感（Windows）。
function packageOwningPath(normalized: string, roots: Record<string, string>): string | undefined {
  const target = normalized.toLowerCase();
  let best: string | undefined;
  let bestLength = 0;
  for (const [name, root] of Object.entries(roots)) {
    const prefix = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() + "/";
    if (target.startsWith(prefix) && prefix.length > bestLength) {
      best = name;
      bestLength = prefix.length;
    }
  }
  return best;
}

function packageFromInternalMissingPath(line: string, roots: Record<string, string> = {}): string | undefined {
  const normalized = missingModulePath(line);
  if (!normalized) return undefined;
  const marker = "/node_modules/";
  const index = normalized.toLowerCase().lastIndexOf(marker);
  if (index < 0) {
    // link: 装的本地插件真实路径不经过 node_modules，只能靠包根目录反查。
    return packageOwningPath(normalized, roots);
  }
  const segments = normalized.slice(index + marker.length).split("/").filter(Boolean);
  const packageParts = segments[0]?.startsWith("@") ? 2 : 1;
  if (segments.length <= packageParts || !segments[0]) return undefined;
  return packageParts === 2 && segments[1] ? `${segments[0]}/${segments[1]}` : segments[0];
}

function isEntryCollision(line: string): boolean {
  const entry = /\bentry(?:\s+id)?\b/i;
  const collision = /\b(?:duplicate|already\s+(?:registered|exists)|overrid(?:e|den|ing))\b/i;
  return entry.test(line) && collision.test(line);
}

function extractEntryId(line: string): string | undefined {
  return /\bentry(?:\s+id)?\s*[:=]?\s*["']?([@A-Za-z0-9._~/-]+)/i.exec(line)?.[1];
}

function addMatch(target: Map<string, LogRecord[]>, key: string, record: LogRecord): void {
  const matches = target.get(key) ?? [];
  matches.push(record);
  target.set(key, matches);
}

function formatEvidence(records: LogRecord[], limit = 3): string {
  return records.slice(0, limit).map(({ file, line }) => `${file}: ${line}`).join("\n");
}

function uniqueFiles(records: Array<{ file: string }>): string[] {
  return [...new Set(records.map(({ file }) => file))];
}
