import path from "node:path";
import semver from "semver";
import { readJson } from "../io.js";
import { resolveInstalledPackage } from "../profile.js";
import { quoteArg } from "../report.js";
import type { Finding, PackageJson, ProfileSnapshot } from "../types.js";

const BUILT_IN_BUNDLES = new Set(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);

export async function auditProfile(profile: ProfileSnapshot, profileName = "web"): Promise<Finding[]> {
  const findings: Finding[] = [];
  const bundleSet = new Set(profile.bundles);
  for (const bundle of profile.bundles) {
    const dependencyMissing = !BUILT_IN_BUNDLES.has(bundle) && !profile.dependencies[bundle];
    const packageMissing = !profile.resolvedPackages[bundle];
    const remediation = dependencyMissing && packageMissing
      ? `dsh plugin --profile ${quoteArg(profileName)} remove ${quoteArg(bundle)}`
      : undefined;
    if (dependencyMissing) findings.push({
      id: "BUNDLES_DEPS_DRIFT", level: "BLOCK", category: "profile",
      title: `bundles 含有 dependencies 中不存在的包：${bundle}`,
      detail: "profile 声明会尝试加载该 bundle，但包管理器状态不再对应。",
      evidence: profile.profilePackageFile,
      ...(remediation ? { remediation } : {})
    });
    if (packageMissing) findings.push({
      id: "BUNDLES_DEPS_DRIFT", level: "BLOCK", category: "profile",
      title: `bundle 当前不可解析：${bundle}`, detail: "安装根和 profile node_modules 都找不到 package.json。",
      evidence: profile.profilePackageFile
    });
  }
  for (const name of Object.keys(profile.dependencies)) {
    const root = profile.resolvedPackages[name];
    if (!root) continue;
    const pkg = await readJson<PackageJson>(path.join(root, "package.json"));
    if (pkg.dsh?.bundle && !bundleSet.has(name)) findings.push({
      id: "BUNDLES_DEPS_DRIFT", level: "BLOCK", category: "profile",
      title: `DSH bundle 已安装但未列入 bundles：${name}`, detail: "依赖存在，但不会进入服务图。",
      evidence: profile.profilePackageFile
    });
    for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (pkg.peerDependenciesMeta?.[peer]?.optional) continue;
      const peerRoot = profile.resolvedPackages[peer] ?? await resolveInstalledPackage(peer, profile.profileDir, profile.installRoot);
      const installed = profile.installedVersions[peer] ?? (peerRoot ? (await readJson<PackageJson>(path.join(peerRoot, "package.json"))).version : undefined);
      if (!peerRoot) findings.push({
        id: "UNMET_PEER", level: "WARN", category: "profile",
        title: `${name} 的 peer 当前不可解析：${peer}`, detail: `required=${range}`,
        evidence: path.join(root, "package.json")
      });
      else if (installed && semver.valid(installed) && semver.validRange(range) && !semver.satisfies(installed, range, { includePrerelease: true })) findings.push({
        id: "UNMET_PEER", level: "WARN", category: "profile",
        title: `${name} 的 peer 版本不匹配：${peer}`, detail: `installed=${installed}; required=${range}`,
        evidence: path.join(root, "package.json")
      });
    }
  }
  return findings;
}
