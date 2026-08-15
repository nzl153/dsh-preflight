import type { PackageSnapshot, ProfileSnapshot } from "./types.js";

export interface CandidateDiff {
  bundle: string;
  entries: Array<{ id: string; name?: string; configKeys: string[]; collides: boolean }>;
  profileConfigTouches: Array<{ id: string; profileKeys: string[] }>;
  peerDependencies: Record<string, string>;
  lifecycleScripts: Record<string, string>;
  artifactEntries: Array<{ field: string; target: string; exists: boolean }>;
}

export function buildDiff(candidate: PackageSnapshot, profile: ProfileSnapshot): CandidateDiff {
  const currentIds = new Set(profile.bundlePackages.flatMap((bundle) => bundle.entries.map((entry) => entry.id)));
  const profileConfigs = new Map(profile.profileOverrides.filter((entry) => entry.config).map((entry) => [entry.id, Object.keys(entry.config ?? {})]));
  return {
    bundle: candidate.packageName,
    entries: candidate.entries.map((entry) => ({
      id: entry.id,
      ...(entry.name ? { name: entry.name } : {}),
      configKeys: Object.keys(entry.config ?? {}),
      collides: currentIds.has(entry.id)
    })),
    profileConfigTouches: candidate.entries.filter((entry) => profileConfigs.has(entry.id)).map((entry) => ({ id: entry.id, profileKeys: profileConfigs.get(entry.id) ?? [] })),
    peerDependencies: candidate.packageJson.peerDependencies ?? {},
    lifecycleScripts: Object.fromEntries(Object.entries(candidate.packageJson.scripts ?? {}).filter(([name]) => ["preinstall", "install", "postinstall", "prepare"].includes(name))),
    artifactEntries: candidate.entryTargets
  };
}

export function renderDiff(diff: CandidateDiff): string {
  const lines = [`候选 bundle: ${diff.bundle}`];
  lines.push("entries:");
  if (!diff.entries.length) lines.push("  (无)");
  for (const entry of diff.entries) lines.push(`  - ${entry.id} -> ${entry.name ?? "(无 name)"}; config=[${entry.configKeys.join(", ")}]; ${entry.collides ? "当前 id 已存在" : "新增 id"}`);
  lines.push("profile config 交集:");
  if (!diff.profileConfigTouches.length) lines.push("  (无)");
  for (const item of diff.profileConfigTouches) lines.push(`  - ${item.id}: [${item.profileKeys.join(", ")}]`);
  lines.push("peerDependencies: " + (Object.keys(diff.peerDependencies).length ? JSON.stringify(diff.peerDependencies) : "(无)"));
  lines.push("lifecycle scripts: " + (Object.keys(diff.lifecycleScripts).length ? JSON.stringify(diff.lifecycleScripts) : "(无)"));
  lines.push("artifact entries:");
  if (!diff.artifactEntries.length) lines.push("  (无)");
  for (const item of diff.artifactEntries) lines.push(`  - ${item.field}: ${item.target} [${item.exists ? "存在" : "缺失"}]`);
  return lines.join("\n");
}
