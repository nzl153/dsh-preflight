import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { readJson } from "../io.js";
import { resolveInstalledPackage } from "../profile.js";
import type { Finding, PackageSnapshot, ProfileSnapshot, SourceSpec } from "../types.js";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const MAX_SCAN_FILES = 2_000;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export async function checkSource(candidate: PackageSnapshot, profile: ProfileSnapshot, source: SourceSpec): Promise<Finding[]> {
  const findings: Finding[] = [];
  const scripts = candidate.packageJson.scripts ?? {};
  const installScripts = ["preinstall", "install", "postinstall"].filter((name) => scripts[name]);
  if (installScripts.length) findings.push({
    id: "INSTALL_SCRIPT_PRESENT", level: "WARN", category: "source",
    title: "候选包含安装生命周期脚本", detail: installScripts.map((name) => `${name}: ${scripts[name]}`).join("; "),
    evidence: candidate.packageFile, consequence: "包管理器安装时可能执行这些命令。",
    remediation: "安装前人工审查脚本；本工具不会执行它们。"
  });
  if (source.kind === "github" && (scripts.prepare || scripts.postinstall)) findings.push({
    id: "BUILD_APPROVAL_REQUIRED", level: "INFO", category: "source",
    title: "Git 来源可能触发构建", detail: [scripts.prepare ? `prepare: ${scripts.prepare}` : "", scripts.postinstall ? `postinstall: ${scripts.postinstall}` : ""].filter(Boolean).join("; "),
    evidence: candidate.packageFile,
    remediation: `人工审查后，在 pnpm-workspace.yaml 的 allowBuilds 中显式加入 ${candidate.packageName}: true。`
  });
  if (source.kind === "github" && !/^[0-9a-f]{40}$/i.test(source.ref)) findings.push({
    id: "UNPINNED_SOURCE", level: "WARN", category: "source",
    title: "GitHub 来源未固定到 commit SHA", detail: `ref=${source.ref}`,
    evidence: source.raw, remediation: "使用 github:owner/repo#<40位commit SHA>。"
  });
  for (const [name, range] of Object.entries(candidate.packageJson.peerDependencies ?? {})) {
    if (!name.startsWith("@deepseek-ai/")) continue;
    const installedRoot = profile.resolvedPackages[name] ?? await resolveInstalledPackage(name, profile.profileDir, profile.installRoot);
    const installed = profile.installedVersions[name] ?? (installedRoot ? (await readJson<{ version?: string }>(path.join(installedRoot, "package.json"))).version : undefined);
    if (installed && semver.valid(installed) && semver.validRange(range) && !semver.satisfies(installed, range, { includePrerelease: true })) findings.push({
      id: "VERSION_RANGE_MISMATCH", level: "WARN", category: "installability",
      title: `本机版本不满足 peer range：${name}`, detail: `installed=${installed}; required=${range}`,
      evidence: candidate.packageFile
    });
  }
  const surfaces = await scanSensitiveSurface(candidate.rootDir);
  if (surfaces.length) findings.push({
    id: "SENSITIVE_API_SURFACE", level: "INFO", category: "source",
    title: "源码触及敏感 API surface", detail: surfaces.slice(0, 20).join("; "),
    evidence: `${surfaces.length} 处静态文本匹配；不代表恶意或安全。`
  });
  return findings;
}

async function scanSensitiveSurface(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  await walk(rootDir, files);
  const matches: string[] = [];
  let bytes = 0;
  const pattern = /(?:node:)?child_process|\b(?:writeFile|appendFile|createWriteStream|unlink|rm|rename|mkdir)\s*\(|https?:\/\/[^\s'"`)]+/;
  for (const file of files.slice(0, MAX_SCAN_FILES)) {
    const stat = await fs.stat(file);
    if (bytes + stat.size > MAX_SCAN_BYTES) break;
    bytes += stat.size;
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const hit = lines[index]?.match(pattern);
      if (hit) matches.push(`${path.relative(rootDir, file)}:${index + 1} ${hit[0]}`);
    }
  }
  return matches;
}

async function walk(dir: string, files: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (files.length >= MAX_SCAN_FILES) return;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(full, files);
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
}
