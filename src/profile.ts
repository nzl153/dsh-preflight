import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "./fs-safe.js";
import { readJson } from "./io.js";
import { snapshotPackage } from "./package-snapshot.js";
import type { PackageJson, ProfileSnapshot } from "./types.js";
import { readPatchEntries } from "./yaml.js";

interface ProfilePackage extends PackageJson {
  dsh?: { profile?: { bundles?: string[] }; [key: string]: unknown };
}

export async function snapshotProfile(profileDir: string, installRoot: string): Promise<ProfileSnapshot> {
  const realProfile = await fs.realpath(path.resolve(profileDir));
  const realInstall = await fs.realpath(path.resolve(installRoot));
  const profilePackageFile = path.join(realProfile, "package.json");
  const pkg = await readJson<ProfilePackage>(profilePackageFile);
  const dependencies = pkg.dependencies ?? {};
  const bundles = pkg.dsh?.profile?.bundles ?? [];
  const resolvedPackages: Record<string, string> = {};
  const installedVersions: Record<string, string> = {};
  const names = new Set([...Object.keys(dependencies), ...bundles]);
  for (const name of names) {
    const resolved = await resolveInstalledPackage(name, realProfile, realInstall);
    if (!resolved) continue;
    resolvedPackages[name] = resolved;
    try {
      const installed = await readJson<PackageJson>(path.join(resolved, "package.json"));
      if (installed.version) installedVersions[name] = installed.version;
    } catch {}
  }
  const bundlePackages = [];
  const seen = new Set<string>();
  for (const name of bundles) {
    const root = resolvedPackages[name] ?? await resolveInstalledPackage(name, realProfile, realInstall);
    if (!root) continue;
    const real = await fs.realpath(root);
    const key = real.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bundlePackages.push(await snapshotPackage(real));
  }
  const patchFile = path.join(realProfile, "cordis.patch.yml");
  const profileOverrides = await exists(patchFile) ? await readPatchEntries(patchFile) : [];
  return {
    profileDir: realProfile,
    installRoot: realInstall,
    profilePackageFile,
    dependencies,
    bundles,
    bundlePackages,
    profileOverrides,
    installedVersions,
    resolvedPackages
  };
}

export async function resolveInstalledPackage(name: string, profileDir: string, installRoot: string): Promise<string | undefined> {
  for (const anchor of [path.join(installRoot, "node_modules"), path.join(profileDir, "node_modules")]) {
    const candidate = path.join(anchor, ...name.split("/"));
    if (await exists(path.join(candidate, "package.json"))) return fs.realpath(candidate);
  }
  return undefined;
}
