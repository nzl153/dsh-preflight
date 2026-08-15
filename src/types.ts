export type FindingLevel = "BLOCK" | "WARN" | "INFO" | "UNKNOWN";

export type FindingCategory = "conflict" | "installability" | "source" | "profile" | "runtime";

export interface Finding {
  id: string;
  level: FindingLevel;
  category: FindingCategory;
  title: string;
  detail: string;
  evidence: string;
  consequence?: string;
  remediation?: string;
  relatedFiles?: string[];
}

export type SourceSpec =
  | {
      kind: "npm";
      raw: string;
      packageName: string;
      selector: string;
    }
  | {
      kind: "github";
      raw: string;
      owner: string;
      repo: string;
      ref: string;
    }
  | {
      kind: "local";
      raw: string;
      path: string;
    };

export interface TarLimits {
  maxUnpackedBytes: number;
  maxFileBytes: number;
  maxFiles: number;
}

export interface TarExtractionResult {
  rootDir: string;
  extractedFiles: string[];
  skippedLinks: string[];
  unpackedBytes: number;
}

export interface CandidateArtifact {
  source: SourceSpec;
  rootDir: string;
  installSpec: string;
  resolvedVersion?: string;
  temporary: boolean;
  dispose(): Promise<void>;
}

export interface PatchEntry {
  id: string;
  name?: string;
  config?: Record<string, unknown>;
  sourceFile: string;
  line: number;
}

export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  bundledDependencies?: string[];
  bundleDependencies?: string[];
  dsh?: {
    bundle?: { patch?: string; services?: string[] };
    services?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface EntryTarget {
  field: string;
  target: string;
  exists: boolean;
}

export interface PackageSnapshot {
  rootDir: string;
  packageFile: string;
  packageJson: PackageJson;
  packageName: string;
  version?: string;
  patchFile?: string;
  entries: PatchEntry[];
  entryTargets: EntryTarget[];
}

export interface ProfileSnapshot {
  profileDir: string;
  installRoot: string;
  profilePackageFile: string;
  dependencies: Record<string, string>;
  bundles: string[];
  bundlePackages: PackageSnapshot[];
  profileOverrides: PatchEntry[];
  installedVersions: Record<string, string>;
  resolvedPackages: Record<string, string>;
}
