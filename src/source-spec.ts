import path from "node:path";
import type { SourceSpec } from "./types.js";

export function parseSourceSpec(rawInput: string): SourceSpec {
  const raw = rawInput.trim();
  if (!raw) throw new Error("候选来源不能为空。");

  if (raw.startsWith("github:")) {
    const match = /^github:([^/]+)\/([^#]+)#(.+)$/.exec(raw);
    if (!match?.[1] || !match[2] || !match[3]) {
      throw new Error(
        "GitHub 来源格式错误：" + raw + "。请使用 github:owner/repo#ref。"
      );
    }
    return {
      kind: "github",
      raw,
      owner: match[1],
      repo: match[2].replace(/\.git$/i, ""),
      ref: match[3]
    };
  }

  if (looksLikeLocalPath(raw)) {
    const localPath = raw.startsWith("file:") || raw.startsWith("link:")
      ? raw.slice(raw.indexOf(":") + 1)
      : raw;
    return { kind: "local", raw, path: path.resolve(localPath) };
  }

  if (raw.startsWith("@")) {
    const slash = raw.indexOf("/");
    if (slash <= 1) throw new Error("npm scope 包名格式错误：" + raw);
    const selectorAt = raw.indexOf("@", slash);
    const packageName = selectorAt >= 0 ? raw.slice(0, selectorAt) : raw;
    const selector = selectorAt >= 0 ? raw.slice(selectorAt + 1) : "latest";
    validateNpmName(packageName, raw);
    if (!selector) throw new Error("npm 版本选择器不能为空：" + raw);
    return { kind: "npm", raw, packageName, selector };
  }

  const selectorAt = raw.lastIndexOf("@");
  const packageName = selectorAt > 0 ? raw.slice(0, selectorAt) : raw;
  const selector = selectorAt > 0 ? raw.slice(selectorAt + 1) : "latest";
  validateNpmName(packageName, raw);
  if (!selector) throw new Error("npm 版本选择器不能为空：" + raw);
  return { kind: "npm", raw, packageName, selector };
}

function looksLikeLocalPath(value: string): boolean {
  return (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("file:") ||
    value.startsWith("link:") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function validateNpmName(packageName: string, raw: string): void {
  const validScoped = /^@[a-z0-9._~-]+\/[a-z0-9._~-]+$/i.test(packageName);
  const validPlain = /^[a-z0-9._~-]+$/i.test(packageName);
  if (!validScoped && !validPlain) {
    throw new Error("npm 包名格式错误：" + raw);
  }
}
