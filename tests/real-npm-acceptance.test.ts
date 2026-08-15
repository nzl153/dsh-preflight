import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeCandidate } from "../src/analyze.js";
import { parseSourceSpec } from "../src/source-spec.js";
import { makeTempDir, removeTempDir, writeJson, writeText } from "./helpers.js";

test("real npm dsh-web-search-pro hits browser collision and absent peer", { skip: process.env.DSH_PREFLIGHT_REAL_NPM !== "1", timeout: 60_000 }, async () => {
  const root = await makeTempDir("dsh-preflight-real-");
  try {
    const install = path.join(root, "install");
    const profile = path.join(root, "profile");
    const browser = path.join(profile, "node_modules", "dsh-browser");
    const downloads = path.join(root, "downloads");
    await fs.mkdir(install, { recursive: true });
    await fs.mkdir(downloads, { recursive: true });
    await writeJson(path.join(profile, "package.json"), {
      dependencies: { "dsh-browser": "1.0.0" },
      dsh: { profile: { bundles: ["dsh-browser"] } }
    });
    await writeJson(path.join(browser, "package.json"), { name: "dsh-browser", version: "1.0.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeText(path.join(browser, "cordis.patch.yml"), "- insert:\n    - id: browser\n      name: dsh-browser\n");
    const before = await hashTree(profile);
    const report = await analyzeCandidate(parseSourceSpec("dsh-web-search-pro"), {
      profileDir: profile, installRoot: install, profileName: "web",
      acquire: { registry: "https://registry.npmjs.org", tempRoot: downloads }
    });
    assert.ok(report.findings.some((item) => item.id === "ENTRY_ID_COLLISION" && item.level === "BLOCK"));
    assert.ok(report.findings.some((item) => item.id === "UNRESOLVABLE_AFTER_INSTALL" && item.level === "BLOCK" && item.title.includes("@anweat/dsh-browser")));
    assert.equal(await hashTree(profile), before);
    assert.deepEqual(await fs.readdir(downloads), []);
  } finally { await removeTempDir(root); }
});

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      hash.update(path.relative(root, full).replace(/\\/g, "/"));
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) hash.update(await fs.readFile(full));
    }
  }
  await visit(root);
  return hash.digest("hex");
}
