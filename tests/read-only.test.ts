import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeProfile } from "../src/analyze.js";
import { explainRuntime } from "../src/explain.js";
import { makeTempDir, removeTempDir, writeJson, writeText } from "./helpers.js";

test("explain and audit leave profile content and mtime unchanged", async () => {
  const root = await makeTempDir();
  try {
    const profileDir = path.join(root, "profile");
    const installRoot = path.join(root, "install");
    await fs.mkdir(installRoot, { recursive: true });
    await writeJson(path.join(profileDir, "package.json"), {
      dependencies: {}, dsh: { profile: { bundles: ["stale-plugin"] } }
    });
    await writeText(path.join(profileDir, "cordis.patch.yml"), "- id: api-gateway\n  config: {}\n");
    const logFile = path.join(installRoot, "dsh.err.log");
    await writeText(logFile, "Error: listen EADDRINUSE :::3080\n");
    const before = await snapshotTree(profileDir);
    const options = { profileDir, installRoot, profileName: "web" };
    await explainRuntime(options);
    await analyzeProfile(options);
    assert.deepEqual(await snapshotTree(profileDir), before);
  } finally { await removeTempDir(root); }
});

async function snapshotTree(root: string): Promise<Array<{ path: string; hash: string; mtimeMs: number }>> {
  const result: Array<{ path: string; hash: string; mtimeMs: number }> = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const [content, stat] = await Promise.all([fs.readFile(full), fs.stat(full)]);
        result.push({ path: path.relative(root, full), hash: createHash("sha256").update(content).digest("hex"), mtimeMs: stat.mtimeMs });
      }
    }
  }
  await visit(root);
  return result;
}
