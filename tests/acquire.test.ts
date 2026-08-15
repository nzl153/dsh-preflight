import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { acquireCandidate } from "../src/acquire.js";
import { checkInstallability } from "../src/checks/installability.js";
import { snapshotPackage } from "../src/package-snapshot.js";
import { snapshotProfile } from "../src/profile.js";
import { parseSourceSpec } from "../src/source-spec.js";
import { makeTarGz, makeTempDir, removeTempDir, writeJson } from "./helpers.js";

test("acquires npm tarball, verifies integrity and cleans temporary files", async () => {
  const tempRoot = await makeTempDir();
  const archive = makeTarGz([{ name: "package/package.json", content: '{"name":"demo"}' }]);
  const integrity = "sha512-" + createHash("sha512").update(archive).digest("base64");
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/demo")) return new Response(JSON.stringify({
      "dist-tags": { latest: "1.2.3" },
      versions: { "1.2.3": { version: "1.2.3", dist: { tarball: "https://unit.test/demo.tgz", integrity } } }
    }));
    return new Response(new Uint8Array(archive));
  };
  try {
    const artifact = await acquireCandidate(parseSourceSpec("demo"), { fetch: fetcher, tempRoot });
    assert.equal(artifact.resolvedVersion, "1.2.3");
    assert.equal(JSON.parse(await fs.readFile(path.join(artifact.rootDir, "package.json"), "utf8")).name, "demo");
    const ownedRoot = path.dirname(path.dirname(artifact.rootDir));
    await artifact.dispose();
    await assert.rejects(fs.access(ownedRoot));
  } finally {
    await removeTempDir(tempRoot);
  }
});

test("rejects integrity mismatch and leaves no acquired directory", async () => {
  const tempRoot = await makeTempDir();
  const archive = makeTarGz([{ name: "package/package.json", content: "{}" }]);
  const fetcher: typeof fetch = async (input) => String(input).endsWith("/demo")
    ? new Response(JSON.stringify({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { dist: { tarball: "https://unit.test/a", integrity: "sha512-bad" } } } }))
    : new Response(new Uint8Array(archive));
  try {
    await assert.rejects(() => acquireCandidate(parseSourceSpec("demo"), { fetch: fetcher, tempRoot }), /integrity/);
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally {
    await removeTempDir(tempRoot);
  }
});

test("checks entry targets against the downloaded npm artifact", async () => {
  const tempRoot = await makeTempDir();
  const archive = makeTarGz([
    { name: "package/package.json", content: JSON.stringify({ name: "broken-tarball", main: "./lib/missing.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } }) },
    { name: "package/cordis.patch.yml", content: "[]\n" }
  ]);
  const fetcher: typeof fetch = async (input) => String(input).endsWith("/broken-tarball")
    ? new Response(JSON.stringify({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { dist: { tarball: "https://unit.test/broken.tgz" } } } }))
    : new Response(new Uint8Array(archive));
  try {
    const install = path.join(tempRoot, "install");
    const profileDir = path.join(tempRoot, "profile");
    await fs.mkdir(install, { recursive: true });
    await writeJson(path.join(profileDir, "package.json"), { dependencies: {}, dsh: { profile: { bundles: [] } } });
    const artifact = await acquireCandidate(parseSourceSpec("broken-tarball"), { fetch: fetcher, tempRoot });
    try {
      const snapshot = await snapshotPackage(artifact.rootDir);
      assert.equal(snapshot.entryTargets.find((item) => item.field === "main")?.exists, false);
      const findings = await checkInstallability(snapshot, await snapshotProfile(profileDir, install));
      assert.ok(findings.some((item) => item.id === "ENTRY_MISSING_IN_ARTIFACT" && item.level === "BLOCK"));
    } finally { await artifact.dispose(); }
    assert.equal((await fs.readdir(tempRoot)).some((name) => name.startsWith("dsh-preflight-")), false);
  } finally { await removeTempDir(tempRoot); }
});

test("reads local directory through realpath without copying", async () => {
  const dir = await makeTempDir("dsh local with spaces-");
  try {
    await writeJson(path.join(dir, "package.json"), { name: "local-demo" });
    const artifact = await acquireCandidate(parseSourceSpec(dir));
    assert.equal(artifact.temporary, false);
    assert.equal(artifact.rootDir, await fs.realpath(dir));
  } finally {
    await removeTempDir(dir);
  }
});

test("acquires GitHub codeload archive and cleans it", async () => {
  const tempRoot = await makeTempDir();
  const archive = makeTarGz([{ name: "repo-main/package.json", content: '{"name":"from-github"}' }]);
  let requested = "";
  const fetcher: typeof fetch = async (input) => {
    requested = String(input);
    return new Response(new Uint8Array(archive));
  };
  try {
    const artifact = await acquireCandidate(parseSourceSpec("github:owner/repo#main"), {
      fetch: fetcher, githubCodeload: "https://unit.test", tempRoot
    });
    assert.match(requested, /owner\/repo\/tar\.gz\/main$/);
    assert.equal(artifact.source.kind, "github");
    await artifact.dispose();
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally { await removeTempDir(tempRoot); }
});

test("enforces compressed download limit", async () => {
  const tempRoot = await makeTempDir();
  const fetcher: typeof fetch = async () => new Response(new Uint8Array(1024));
  try {
    await assert.rejects(() => acquireCandidate(parseSourceSpec("github:o/r#main"), {
      fetch: fetcher, githubCodeload: "https://unit.test", tempRoot, maxDownloadBytes: 16
    }), /下载体积超过限制/);
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally { await removeTempDir(tempRoot); }
});
