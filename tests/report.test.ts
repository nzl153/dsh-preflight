import assert from "node:assert/strict";
import test from "node:test";
import { createReport, renderReport } from "../src/report.js";
import type { Finding } from "../src/types.js";

test("audit prescription summary counts unique executable commands", () => {
  const command = "dsh plugin --profile web remove stale-plugin";
  const finding: Finding = {
    id: "BUNDLES_DEPS_DRIFT", level: "BLOCK", category: "profile",
    title: "drift", detail: "drift", evidence: "package.json", remediation: command
  };
  const output = renderReport(createReport("audit", "web", [finding, { ...finding, title: "same package" }]));
  assert.equal(output.match(/共 1 条可执行处方/g)?.length, 1);
  assert.equal(output.match(new RegExp(command, "g"))?.length, 1);
});
