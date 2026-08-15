import path from "node:path";
import { exists } from "../fs-safe.js";
import { resolveInstalledPackage } from "../profile.js";
import type { Finding, PackageSnapshot, ProfileSnapshot } from "../types.js";

export async function checkInstallability(candidate: PackageSnapshot, profile: ProfileSnapshot): Promise<Finding[]> {
  const findings: Finding[] = [];
  const patch = candidate.packageJson.dsh?.bundle?.patch;
  if (!candidate.packageJson.dsh?.bundle || !patch || !candidate.patchFile || !(await exists(candidate.patchFile))) {
    findings.push({
      id: "MISSING_BUNDLE_MANIFEST",
      level: "BLOCK",
      category: "installability",
      title: "缺少可读取的 dsh.bundle.patch",
      detail: "候选无法作为 DSH bundle 静态组合。",
      evidence: candidate.packageFile,
      remediation: "在 package.json 声明 dsh.bundle.patch，并把 patch 文件包含进发布产物。"
    });
  }
  for (const target of candidate.entryTargets.filter((item) => !item.exists)) {
    findings.push({
      id: "ENTRY_MISSING_IN_ARTIFACT",
      level: "BLOCK",
      category: "installability",
      title: `发布产物缺少入口：${target.target}`,
      detail: `package.json 的 ${target.field} 指向归档中不存在的文件。`,
      evidence: candidate.packageFile,
      remediation: "修正入口路径，或把构建产物加入 npm/GitHub archive。"
    });
  }
  for (const entry of candidate.entries) {
    if (!entry.name) continue;
    const resolution = await resolveAfterInstall(entry.name, candidate, profile);
    if (resolution === "resolved") continue;
    findings.push({
      id: "UNRESOLVABLE_AFTER_INSTALL",
      level: resolution === "optional" ? "UNKNOWN" : "BLOCK",
      category: "installability",
      title: `安装后无法证明 entry.name 可解析：${entry.name}`,
      detail: resolution === "optional"
        ? "该包只在 optionalDependencies 中，安装时可能缺失。"
        : "候选自身、当前环境、普通 dependencies 和 bundled dependencies 都不能提供该包。",
      evidence: `${entry.sourceFile}:${entry.line}`,
      remediation: resolution === "optional" ? "确认目标机器会安装该 optional dependency。" : `把 ${entry.name} 放入 dependencies，或先安装其 peer provider。`
    });
  }
  return findings;
}

async function resolveAfterInstall(name: string, candidate: PackageSnapshot, profile: ProfileSnapshot): Promise<"resolved" | "optional" | "missing"> {
  if (name === candidate.packageName) return "resolved";
  if (profile.resolvedPackages[name]) return "resolved";
  if (await resolveInstalledPackage(name, profile.profileDir, profile.installRoot)) return "resolved";
  if (candidate.packageJson.dependencies?.[name]) return "resolved";
  const bundled = candidate.packageJson.bundledDependencies ?? candidate.packageJson.bundleDependencies ?? [];
  if (bundled.includes(name) && await exists(path.join(candidate.rootDir, "node_modules", ...name.split("/"), "package.json"))) return "resolved";
  if (candidate.packageJson.optionalDependencies?.[name]) return "optional";
  if (candidate.packageJson.peerDependenciesMeta?.[name]?.optional) return "optional";
  return "missing";
}
