import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { makeTempDir, removeTempDir, writeJson, writeText } from "./helpers.js";

test("CLI check emits JSON and uses BLOCK exit code", async () => {
  const root = await makeTempDir();
  const output: string[] = [];
  const errors: string[] = [];
  try {
    const profile = path.join(root, "profile");
    const install = path.join(root, "install");
    const candidate = path.join(root, "candidate with spaces");
    await fs.mkdir(install, { recursive: true });
    await writeJson(path.join(profile, "package.json"), { dependencies: {}, dsh: { profile: { bundles: [] } } });
    await writeJson(path.join(candidate, "package.json"), { name: "broken", main: "./lib/missing.js", dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeText(path.join(candidate, "cordis.patch.yml"), "[]\n");
    const code = await runCli(["check", candidate, "--profile-dir", profile, "--dsh-root", install, "--json"], {
      stdout: (text) => output.push(text), stderr: (text) => errors.push(text)
    });
    assert.equal(code, 1);
    assert.equal(errors.length, 0);
    const report = JSON.parse(output.join("\n")) as { findings: Array<{ id: string }> };
    assert.ok(report.findings.some((item) => item.id === "ENTRY_MISSING_IN_ARTIFACT"));
  } finally { await removeTempDir(root); }
});

test("CLI strict turns WARN into exit code 1 and diff remains read-only", async () => {
  const root = await makeTempDir();
  try {
    const profile = path.join(root, "profile");
    const install = path.join(root, "install");
    const candidate = path.join(root, "candidate");
    await fs.mkdir(install, { recursive: true });
    await writeJson(path.join(profile, "package.json"), { dependencies: {}, dsh: { profile: { bundles: [] } } });
    await writeJson(path.join(candidate, "package.json"), { name: "warn-only", scripts: { preinstall: "node x.js" }, dsh: { bundle: { patch: "./cordis.patch.yml" } } });
    await writeText(path.join(candidate, "cordis.patch.yml"), "[]\n");
    const common = [candidate, "--profile-dir", profile, "--dsh-root", install];
    assert.equal(await runCli(["check", ...common, "--strict"], { stdout() {}, stderr() {} }), 1);
    assert.equal(await runCli(["diff", ...common, "--json"], { stdout() {}, stderr() {} }), 0);
  } finally { await removeTempDir(root); }
});

test("CLI usage errors return 2", async () => {
  const errors: string[] = [];
  assert.equal(await runCli(["unknown"], { stdout() {}, stderr: (text) => errors.push(text) }), 2);
  assert.match(errors[0] ?? "", /未知命令/);
  assert.equal(await runCli(["audit", "--profile", ".."], { stdout() {}, stderr: (text) => errors.push(text) }), 2);
  assert.match(errors.at(-1) ?? "", /profile 名/);
});
