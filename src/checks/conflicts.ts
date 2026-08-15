import type { Finding, PackageSnapshot, ProfileSnapshot } from "../types.js";

export function checkConflicts(candidate: PackageSnapshot, profile: ProfileSnapshot): Finding[] {
  return [
    ...entryIdCollisions(candidate, profile),
    ...configOverrides(candidate, profile),
    serviceProviderDuplicate(candidate, profile)
  ];
}

function entryIdCollisions(candidate: PackageSnapshot, profile: ProfileSnapshot): Finding[] {
  const existing = new Map<string, Array<{ pkg: string; file: string; line: number }>>();
  for (const bundle of profile.bundlePackages) {
    for (const entry of bundle.entries) {
      const list = existing.get(entry.id) ?? [];
      list.push({ pkg: bundle.packageName, file: entry.sourceFile, line: entry.line });
      existing.set(entry.id, list);
    }
  }
  const findings: Finding[] = [];
  for (const entry of candidate.entries) {
    const matches = existing.get(entry.id);
    if (!matches) continue;
    findings.push({
      id: "ENTRY_ID_COLLISION",
      level: "BLOCK",
      category: "conflict",
      title: `entry id 已存在：${entry.id}`,
      detail: `候选 ${candidate.packageName} 会插入已由 ${matches.map((item) => item.pkg).join("、")} 使用的 id。`,
      evidence: `${entry.sourceFile}:${entry.line}; ${matches.map((item) => `${item.file}:${item.line}`).join("; ")}`,
      consequence: "DSH 服务图中同 id 节点的组合结果不再可预测。",
      remediation: "修改候选 entry id，或先确认并移除发生冲突的 bundle。"
    });
  }
  return findings;
}

function configOverrides(candidate: PackageSnapshot, profile: ProfileSnapshot): Finding[] {
  const overrides = new Map(profile.profileOverrides.map((entry) => [entry.id, entry]));
  const findings: Finding[] = [];
  for (const entry of candidate.entries) {
    if (!entry.config) continue;
    const override = overrides.get(entry.id);
    if (!override?.config) continue;
    const candidateKeys = Object.keys(entry.config);
    const profileKeys = Object.keys(override.config);
    const overlap = candidateKeys.filter((key) => profileKeys.includes(key));
    findings.push({
      id: "CONFIG_OVERRIDE_SILENT",
      level: "WARN",
      category: "conflict",
      title: `profile 会整段覆盖候选 config：${entry.id}`,
      detail: `候选 key=[${candidateKeys.join(", ")}]; profile key=[${profileKeys.join(", ")}]; 同名 key=[${overlap.join(", ") || "无"}]。DSH 后置 profile 层替换整个 config，不做深合并。`,
      evidence: `${entry.sourceFile}:${entry.line}; ${override.sourceFile}:${override.line}`,
      consequence: "即使 key 不同，候选依赖的默认 config 也可能静默丢失。",
      remediation: "把候选必需字段合并进 profile 的同 id config。"
    });
  }
  return findings;
}

function serviceProviderDuplicate(candidate: PackageSnapshot, profile: ProfileSnapshot): Finding {
  const candidateServices = candidate.packageJson.dsh?.bundle?.services ?? candidate.packageJson.dsh?.services;
  const existing = profile.bundlePackages.flatMap((bundle) => {
    const services = bundle.packageJson.dsh?.bundle?.services ?? bundle.packageJson.dsh?.services ?? [];
    return services.map((service) => ({ service, packageName: bundle.packageName }));
  });
  if (!candidateServices?.length) {
    return {
      id: "SERVICE_PROVIDER_DUPLICATE",
      level: "UNKNOWN",
      category: "conflict",
      title: "无法静态确认候选提供的 service",
      detail: "候选 manifest 没有显式 service 声明；未从包名或 entry id 猜测。",
      evidence: candidate.packageFile
    };
  }
  const duplicates = existing.filter((item) => candidateServices.includes(item.service));
  return duplicates.length > 0 ? {
    id: "SERVICE_PROVIDER_DUPLICATE",
    level: "WARN",
    category: "conflict",
    title: "发现重复 service provider 声明",
    detail: duplicates.map((item) => `${item.service} (${item.packageName})`).join("、"),
    evidence: candidate.packageFile
  } : {
    id: "SERVICE_PROVIDER_DUPLICATE",
    level: "INFO",
    category: "conflict",
    title: "显式 service 声明未发现重复",
    detail: candidateServices.join("、"),
    evidence: candidate.packageFile
  };
}
