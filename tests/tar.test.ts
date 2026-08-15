import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractTarGz } from "../src/tar.js";
import { makeTarGz, makeTempDir, removeTempDir } from "./helpers.js";

test("extracts regular files under a common archive root", async () => {
  const temp = await makeTempDir("dsh-preflight tar with spaces-");
  try {
    const archive = makeTarGz([
      { name: "package/package.json", content: "{\"name\":\"demo\"}\n" },
      { name: "package/lib/index.js", content: "export {};\n" }
    ]);
    const result = await extractTarGz(archive, temp);
    assert.equal(await fs.readFile(path.join(result.rootDir, "package.json"), "utf8"), "{\"name\":\"demo\"}\n");
    assert.equal(await fs.readFile(path.join(result.rootDir, "lib", "index.js"), "utf8"), "export {};\n");
    assert.equal(result.skippedLinks.length, 0);
  } finally {
    await removeTempDir(temp);
  }
});

test("supports Unicode PAX paths and GNU long names", async () => {
  const destination = await makeTempDir();
  const paxPath = "package/目录/index.js";
  const longPath = "package/" + "nested/".repeat(16) + "entry.js";
  try {
    const archive = makeTarGz([
      { name: "package/package.json", content: "{}" },
      { name: "PaxHeader", type: "pax", content: makePaxRecord("path", paxPath) },
      { name: "placeholder", content: "pax" },
      { name: "LongLink", type: "longname", content: longPath + "\0" },
      { name: "placeholder2", content: "long" }
    ]);
    const result = await extractTarGz(archive, destination);
    assert.equal(await fs.readFile(path.join(destination, ...paxPath.split("/")), "utf8"), "pax");
    assert.equal(await fs.readFile(path.join(destination, ...longPath.split("/")), "utf8"), "long");
    assert.equal(result.extractedFiles.includes(paxPath), true);
  } finally { await removeTempDir(destination); }
});

test("rejects traversal and absolute archive paths", async () => {
  const temp = await makeTempDir();
  try {
    await assert.rejects(
      extractTarGz(makeTarGz([{ name: "package/../../outside.txt", content: "bad" }]), temp),
      /不安全的归档路径/
    );
    await assert.rejects(
      extractTarGz(makeTarGz([{ name: "C:/outside.txt", content: "bad" }]), temp),
      /不安全的归档路径/
    );
  } finally {
    await removeTempDir(temp);
  }
});

test("rejects Windows device names and alternate data streams", async () => {
  for (const unsafe of ["package/CON.txt", "package/file.txt:payload"]) {
    const destination = await makeTempDir();
    try {
      const archive = makeTarGz([{ name: unsafe, content: "x" }, { name: "package/package.json", content: "{}" }]);
      await assert.rejects(() => extractTarGz(archive, destination), /Windows 归档路径/);
    } finally { await removeTempDir(destination); }
  }
});

test("does not create symlinks from archives", async () => {
  const temp = await makeTempDir();
  try {
    const archive = makeTarGz([
      { name: "repo/package.json", content: "{\"name\":\"demo\"}" },
      { name: "repo/link", type: "symlink", linkName: "C:/real" }
    ]);
    const result = await extractTarGz(archive, temp);
    assert.deepEqual(result.skippedLinks, ["repo/link"]);
    await assert.rejects(fs.lstat(path.join(result.rootDir, "link")), /ENOENT/);
  } finally {
    await removeTempDir(temp);
  }
});

test("enforces uncompressed size and file-count limits", async () => {
  const temp = await makeTempDir();
  try {
    const archive = makeTarGz([
      { name: "package/a.txt", content: "12345" },
      { name: "package/b.txt", content: "67890" }
    ]);
    await assert.rejects(
      extractTarGz(archive, temp, { maxUnpackedBytes: 8, maxFiles: 10, maxFileBytes: 8 }),
      /解压体积超过限制/
    );
    await assert.rejects(
      extractTarGz(archive, temp, { maxUnpackedBytes: 100, maxFiles: 1, maxFileBytes: 100 }),
      /文件数量超过限制/
    );
  } finally {
    await removeTempDir(temp);
  }
});

function makePaxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const record = `${length} ${body}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return record;
    length = actual;
  }
}
