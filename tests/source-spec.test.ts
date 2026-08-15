import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceSpec } from "../src/source-spec.js";

test("parses npm, scoped npm, GitHub and local sources", () => {
  assert.deepEqual(parseSourceSpec("dsh-web-search-pro"), {
    kind: "npm",
    raw: "dsh-web-search-pro",
    packageName: "dsh-web-search-pro",
    selector: "latest"
  });
  assert.deepEqual(parseSourceSpec("@scope/pkg@1.2.3"), {
    kind: "npm",
    raw: "@scope/pkg@1.2.3",
    packageName: "@scope/pkg",
    selector: "1.2.3"
  });
  assert.deepEqual(parseSourceSpec("github:owner/repo#main"), {
    kind: "github",
    raw: "github:owner/repo#main",
    owner: "owner",
    repo: "repo",
    ref: "main"
  });
  assert.equal(parseSourceSpec(".\\plugin with space").kind, "local");
  assert.equal(parseSourceSpec("E:\\plugin workspace\\sample-plugin").kind, "local");
});

test("rejects malformed GitHub specs", () => {
  assert.throws(() => parseSourceSpec("github:owner"), /GitHub 来源格式错误/);
});
