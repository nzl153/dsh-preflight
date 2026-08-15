import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { auditProfile } from "../src/checks/audit.js";
import { checkConflicts } from "../src/checks/conflicts.js";
import { checkInstallability } from "../src/checks/installability.js";
import { checkSource } from "../src/checks/source.js";
import { snapshotPackage } from "../src/package-snapshot.js";
import { snapshotProfile } from "../src/profile.js";
import { readPatchEntries } from "../src/yaml.js";
import { makeTempDir, removeTempDir, writeJson, writeText } from "./helpers.js";

test("parses !!js without executing it", async () => {
  const dir = await makeTempDir();
  const patch = path.join(dir, "cordis.patch.yml");
  try {
    await writeText(patch, "- insert:\n    - id: demo\n      name: demo\n      config:\n        callback: !!js function () { throw new Error('must not run') }\n");
    const entries = await readPatchEntries(patch);
    assert.equal(typeof entries[0]?.config?.callback, "string");
  } finally { await removeTempDir(dir); }
});

test("detects id collision, profile-last config replacement and unresolved entry", async () => {
  const root = await makeTempDir();
  try {
    const install = path.join(root, "install");
    const profileDir = path.join(root, "profile with spaces");
    const existing = path.join(install, "node_modules", "existing");
    const candidateDir = path.join(root, "candidate");
    await writeJson(path.join(existing, "package.json"), { name: "existing", version: "1.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeText(path.join(existing, "cordis.patch.yml"), "- insert:\n    - id: browser\n      name: existing\n");
    await writeJson(path.join(profileDir, "package.json"), { dependencies: { existing: "1.0.0" }, dsh: { profile: { bundles: ["existing"] } } });
    await writeText(path.join(profileDir, "cordis.patch.yml"), "- id: browser\n  config:\n    userOnly: true\n- id: api-gateway\n  config:\n    allowImagePlaceholder: true\n");
    await writeJson(path.join(candidateDir, "package.json"), { name: "candidate", version: "1.0.0", main: "./lib/index.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeText(path.join(candidateDir, "lib", "index.js"), "export default 1\n");
    await writeText(path.join(candidateDir, "cordis.patch.yml"), "- insert:\n    - id: browser\n      name: absent-peer\n      config:\n        required: true\n    - id: api-gateway\n      name: candidate\n      config:\n        listenHost: 127.0.0.1\n");
    const profile = await snapshotProfile(profileDir, install);
    const candidate = await snapshotPackage(candidateDir);
    const findings = [...checkConflicts(candidate, profile), ...await checkInstallability(candidate, profile)];
    assert.ok(findings.some((item) => item.id === "ENTRY_ID_COLLISION" && item.level === "BLOCK"));
    assert.ok(findings.some((item) => item.id === "CONFIG_OVERRIDE_SILENT" && item.title.includes("整段")));
    assert.ok(findings.some((item) => item.id === "CONFIG_OVERRIDE_SILENT" && item.title.includes("api-gateway") && item.detail.includes("listenHost") && item.detail.includes("allowImagePlaceholder")));
    assert.ok(findings.some((item) => item.id === "UNRESOLVABLE_AFTER_INSTALL" && item.level === "BLOCK"));
  } finally { await removeTempDir(root); }
});

test("recursively checks exports targets in the actual artifact", async () => {
  const dir = await makeTempDir();
  try {
    await writeJson(path.join(dir, "package.json"), {
      name: "nested", dsh: { bundle: { patch: "./cordis.patch.yml" } },
      exports: { ".": { import: "./lib/index.js", require: "./lib/index.cjs" } }
    });
    await writeText(path.join(dir, "cordis.patch.yml"), "[]\n");
    await writeText(path.join(dir, "lib", "index.js"), "export {}\n");
    const snapshot = await snapshotPackage(dir);
    assert.equal(snapshot.entryTargets.find((item) => item.target.endsWith("index.cjs"))?.exists, false);
  } finally { await removeTempDir(dir); }
});

test("audit blocks bundles/dependencies drift", async () => {
  const root = await makeTempDir();
  try {
    const install = path.join(root, "install");
    const profileDir = path.join(root, "profile");
    await fs.mkdir(install, { recursive: true });
    await writeJson(path.join(profileDir, "package.json"), { dependencies: {}, dsh: { profile: { bundles: ["stale-a", "stale-b", "stale-c"] } } });
    const profile = await snapshotProfile(profileDir, install);
    const findings = await auditProfile(profile);
    assert.ok(findings.some((item) => item.id === "BUNDLES_DEPS_DRIFT" && item.level === "BLOCK"));
    for (const name of ["stale-a", "stale-b", "stale-c"]) assert.ok(findings.some((item) => item.title.includes(name)));
  } finally { await removeTempDir(root); }
});

test("reports unpinned GitHub source, install scripts and sensitive API as facts", async () => {
  const root = await makeTempDir();
  try {
    const install = path.join(root, "install");
    const profileDir = path.join(root, "profile");
    const candidateDir = path.join(root, "candidate");
    await fs.mkdir(install, { recursive: true });
    await writeJson(path.join(profileDir, "package.json"), { dependencies: {}, dsh: { profile: { bundles: [] } } });
    await writeJson(path.join(candidateDir, "package.json"), {
      name: "git-demo", scripts: { prepare: "pnpm build", postinstall: "node setup.js" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } }
    });
    await writeText(path.join(candidateDir, "cordis.patch.yml"), "[]\n");
    await writeText(path.join(candidateDir, "src", "index.ts"), "import { exec } from 'node:child_process';\nfetch('https://example.test/api')\n");
    const candidate = await snapshotPackage(candidateDir);
    const profile = await snapshotProfile(profileDir, install);
    const findings = await checkSource(candidate, profile, { kind: "github", raw: "github:owner/repo#main", owner: "owner", repo: "repo", ref: "main" });
    assert.ok(findings.some((item) => item.id === "UNPINNED_SOURCE" && item.level === "WARN"));
    assert.ok(findings.some((item) => item.id === "BUILD_APPROVAL_REQUIRED" && item.remediation?.includes("allowBuilds")));
    assert.ok(findings.some((item) => item.id === "INSTALL_SCRIPT_PRESENT"));
    assert.ok(findings.some((item) => item.id === "SENSITIVE_API_SURFACE"));
  } finally { await removeTempDir(root); }
});
