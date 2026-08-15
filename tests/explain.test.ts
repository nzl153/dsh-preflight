import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { explainRuntime } from "../src/explain.js";
import { makeTempDir, removeTempDir, writeJson, writeText } from "./helpers.js";

test("explains EADDRINUSE as the root of misleading plugin failures", async () => {
  const fixture = await makeFixture();
  try {
    const logFile = path.join(fixture.root, "port.log");
    await fs.writeFile(logFile, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("Error: listen EADDRINUSE: address already in use :::3080\n", "utf8")
    ]));
    const report = await explainRuntime({ ...fixture.options, logFile });
    const finding = report.findings.find((item) => item.id === "PORT_ALREADY_IN_USE");
    assert.equal(finding?.level, "BLOCK");
    assert.match(finding?.detail ?? "", /看起来像所有插件都坏了/);
    assert.equal(finding?.remediation, "Get-NetTCPConnection -LocalPort 3080 -State Listen");
    assert.doesNotMatch(finding?.remediation ?? "", /taskkill|Stop-Process/i);
  } finally { await removeTempDir(fixture.root); }
});

test("identifies an unresolved bundle as interrupted-removal residue", async () => {
  const fixture = await makeFixture(["stale-plugin"]);
  try {
    const logFile = path.join(fixture.root, "bundle.log");
    await writeText(logFile, "[error] Failed to resolve bundle stale-plugin: Cannot find module 'stale-plugin'\n");
    const report = await explainRuntime({ ...fixture.options, logFile });
    const finding = report.findings.find((item) => item.id === "BUNDLE_UNRESOLVED_AT_BOOT");
    assert.match(finding?.detail ?? "", /卸载.*残骸/);
    assert.match(finding?.detail ?? "", /stale-plugin/);
    assert.match(finding?.remediation ?? "", /dsh-preflight audit/);
  } finally { await removeTempDir(fixture.root); }
});

test("keeps a missing entry outside node_modules as a BLOCK, not an unknown", async () => {
  const fixture = await makeFixture();
  try {
    const logFile = path.join(fixture.root, "local.log");
    await writeText(logFile,
      "[WARN] dsh: background error (fail-soft): Error [ERR_MODULE_NOT_FOUND]: " +
      "Cannot find module 'D:\\work\\local-plugin\\lib\\helper.js' " +
      "imported from D:\\work\\local-plugin\\lib\\index.mjs\n");
    const report = await explainRuntime({ ...fixture.options, logFile });
    const finding = report.findings.find((item) => item.id === "MODULE_ENTRY_MISSING");
    assert.equal(finding?.level, "BLOCK");
    assert.match(finding?.title ?? "", /local-plugin\/lib\/helper\.js/);
    assert.equal(report.findings.some((item) => item.id === "UNRECOGNIZED_ERROR"), false);
  } finally { await removeTempDir(fixture.root); }
});

test("reports missing logs as INFO", async () => {
  const fixture = await makeFixture();
  try {
    const report = await explainRuntime({ ...fixture.options, logFile: path.join(fixture.root, "missing.log") });
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]?.level, "INFO");
    assert.match(report.findings[0]?.detail ?? "", /没有可分析的日志/);
  } finally { await removeTempDir(fixture.root); }
});

test("keeps unrecognized error lines without guessing", async () => {
  const fixture = await makeFixture();
  try {
    const logFile = path.join(fixture.root, "unknown.log");
    await writeText(logFile, [
      "FATAL frobnicator exploded at startup",
      "Error: opaque failure code ZX-42",
      "    at fictional-stack:1:2"
    ].join("\n"));
    const report = await explainRuntime({ ...fixture.options, logFile });
    const finding = report.findings.find((item) => item.id === "UNRECOGNIZED_ERROR");
    assert.equal(finding?.level, "UNKNOWN");
    assert.match(finding?.evidence ?? "", /frobnicator exploded/);
    assert.doesNotMatch(finding?.detail ?? "", /因为|可能是|大概|推测/);
  } finally { await removeTempDir(fixture.root); }
});

test("reads only the final 2 MiB of a large log", async () => {
  const fixture = await makeFixture();
  try {
    const logFile = path.join(fixture.root, "large.log");
    await fs.writeFile(logFile, Buffer.concat([
      Buffer.from("Error: listen EADDRINUSE :::3080\n"),
      Buffer.alloc(2 * 1024 * 1024 + 128, 0x78),
      Buffer.from("\nError: opaque tail failure\n")
    ]));
    const report = await explainRuntime({ ...fixture.options, logFile });
    assert.equal(report.findings.some((item) => item.id === "PORT_ALREADY_IN_USE"), false);
    assert.ok(report.findings.some((item) => item.id === "UNRECOGNIZED_ERROR"));
  } finally { await removeTempDir(fixture.root); }
});

test("recognizes duplicate entry ids and missing package-internal module entries", async () => {
  const fixture = await makeFixture();
  try {
    const logFile = path.join(fixture.root, "boot.log");
    await writeText(logFile, [
      "Error: entry id browser already registered",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\fictional\\profile\\node_modules\\broken-plugin\\lib\\index.js' imported from C:\\fictional\\profile\\boot.mjs"
    ].join("\n"));
    const report = await explainRuntime({ ...fixture.options, logFile });
    assert.ok(report.findings.some((item) => item.id === "ENTRY_ID_COLLISION_AT_BOOT"));
    const missing = report.findings.find((item) => item.id === "MODULE_ENTRY_MISSING");
    assert.match(missing?.detail ?? "", /broken-plugin/);
    assert.match(missing?.remediation ?? "", /dsh-preflight check broken-plugin/);
  } finally { await removeTempDir(fixture.root); }
});

async function makeFixture(bundles: string[] = []): Promise<{
  root: string;
  options: { profileDir: string; installRoot: string; profileName: string };
}> {
  const root = await makeTempDir();
  const profileDir = path.join(root, "profile");
  const installRoot = path.join(root, "install");
  await fs.mkdir(installRoot, { recursive: true });
  await writeJson(path.join(profileDir, "package.json"), {
    dependencies: {},
    dsh: { profile: { bundles } }
  });
  return { root, options: { profileDir, installRoot, profileName: "web" } };
}
