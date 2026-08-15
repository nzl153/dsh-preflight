import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "./fs-safe.js";
import { readJson } from "./io.js";
import type { EntryTarget, PackageJson, PackageSnapshot, PatchEntry } from "./types.js";
import { readPatchEntries } from "./yaml.js";

export async function snapshotPackage(rootDir: string): Promise<PackageSnapshot> {
  const packageFile = path.join(rootDir, "package.json");
  const packageJson = await readJson<PackageJson>(packageFile);
  const packageName = packageJson.name ?? path.basename(rootDir);
  const patchRelative = packageJson.dsh?.bundle?.patch;
  let patchFile: string | undefined;
  let entries: PatchEntry[] = [];
  if (patchRelative) {
    const candidatePatch = path.resolve(rootDir, patchRelative);
    if (inside(rootDir, candidatePatch) && await exists(candidatePatch)) {
      const realPatch = await fs.realpath(candidatePatch);
      if (inside(rootDir, realPatch)) {
        patchFile = realPatch;
        entries = await readPatchEntries(patchFile);
      }
    }
  }
  const entryTargets = await inspectEntryTargets(rootDir, packageJson);
  return {
    rootDir,
    packageFile,
    packageJson,
    packageName,
    ...(packageJson.version ? { version: packageJson.version } : {}),
    ...(patchFile ? { patchFile } : {}),
    entries,
    entryTargets
  };
}

async function inspectEntryTargets(rootDir: string, pkg: PackageJson): Promise<EntryTarget[]> {
  const values: Array<{ field: string; target: string }> = [];
  if (pkg.main) values.push({ field: "main", target: pkg.main });
  if (pkg.module) values.push({ field: "module", target: pkg.module });
  if (typeof pkg.bin === "string") values.push({ field: "bin", target: pkg.bin });
  else if (pkg.bin) for (const [name, target] of Object.entries(pkg.bin)) values.push({ field: `bin.${name}`, target });
  collectExports(pkg.exports, "exports", values);
  const unique = new Map(values.map((value) => [value.field + "\0" + value.target, value]));
  const result: EntryTarget[] = [];
  for (const value of unique.values()) {
    if (value.target.includes("*")) continue;
    const target = path.resolve(rootDir, value.target);
    result.push({ ...value, exists: inside(rootDir, target) && await fileResolvable(rootDir, target) });
  }
  return result;
}

function collectExports(value: unknown, field: string, target: Array<{ field: string; target: string }>): void {
  if (typeof value === "string") {
    target.push({ field, target: value });
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) collectExports(child, `${field}.${key}`, target);
}

async function fileResolvable(rootDir: string, target: string): Promise<boolean> {
  for (const candidate of [target, target + ".js", target + ".mjs", target + ".cjs", path.join(target, "index.js")]) {
    try {
      if ((await fs.stat(candidate)).isFile() && inside(rootDir, await fs.realpath(candidate))) return true;
    } catch {}
  }
  return false;
}

function inside(rootDir: string, target: string): boolean {
  const relation = path.relative(path.resolve(rootDir), path.resolve(target));
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}
