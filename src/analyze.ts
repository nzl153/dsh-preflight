import type { AcquireOptions } from "./acquire.js";
import { acquireCandidate } from "./acquire.js";
import { auditProfile } from "./checks/audit.js";
import { checkConflicts } from "./checks/conflicts.js";
import { checkInstallability } from "./checks/installability.js";
import { checkSource } from "./checks/source.js";
import { buildDiff, type CandidateDiff } from "./diff.js";
import { snapshotPackage } from "./package-snapshot.js";
import { snapshotProfile } from "./profile.js";
import { createReport, makeInstallCommand, type Report } from "./report.js";
import type { SourceSpec } from "./types.js";

export interface AnalysisOptions {
  profileDir: string;
  installRoot: string;
  profileName: string;
  acquire?: AcquireOptions;
}

export async function analyzeCandidate(source: SourceSpec, options: AnalysisOptions): Promise<Report> {
  const artifact = await acquireCandidate(source, options.acquire);
  try {
    const [candidate, profile] = await Promise.all([
      snapshotPackage(artifact.rootDir),
      snapshotProfile(options.profileDir, options.installRoot)
    ]);
    const findings = [
      ...checkConflicts(candidate, profile),
      ...await checkInstallability(candidate, profile),
      ...await checkSource(candidate, profile, source)
    ];
    return createReport("check", candidate.packageName, findings, makeInstallCommand(options.profileName, artifact.installSpec));
  } finally {
    await artifact.dispose();
  }
}

export async function analyzeProfile(options: AnalysisOptions): Promise<Report> {
  const profile = await snapshotProfile(options.profileDir, options.installRoot);
  return createReport("audit", options.profileName, await auditProfile(profile));
}

export async function diffCandidate(source: SourceSpec, options: AnalysisOptions): Promise<CandidateDiff> {
  const artifact = await acquireCandidate(source, options.acquire);
  try {
    const [candidate, profile] = await Promise.all([
      snapshotPackage(artifact.rootDir),
      snapshotProfile(options.profileDir, options.installRoot)
    ]);
    return buildDiff(candidate, profile);
  } finally {
    await artifact.dispose();
  }
}
