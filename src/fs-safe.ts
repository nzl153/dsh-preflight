import fs from "node:fs/promises";
import path from "node:path";

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function realpathDirectory(dir: string): Promise<string> {
  const resolved = await fs.realpath(path.resolve(dir));
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error("不是目录：" + dir);
  return resolved;
}

/** 删除临时树，但绝不递归进入符号链接或 junction。 */
export async function removeTreeSafe(target: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    await fs.rm(target, { force: true });
    return;
  }
  for (const entry of await fs.readdir(target)) {
    await removeTreeSafe(path.join(target, entry));
  }
  await fs.rmdir(target);
}
