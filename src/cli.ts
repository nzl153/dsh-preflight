#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { analyzeCandidate, analyzeProfile, diffCandidate } from "./analyze.js";
import { renderDiff } from "./diff.js";
import { explainRuntime } from "./explain.js";
import { renderReport, reportExitCode } from "./report.js";
import { parseSourceSpec } from "./source-spec.js";

export interface CliRuntime {
  env?: NodeJS.ProcessEnv;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export async function runCli(args: string[], runtime: CliRuntime = {}): Promise<number> {
  const out = runtime.stdout ?? ((text) => process.stdout.write(text + "\n"));
  const err = runtime.stderr ?? ((text) => process.stderr.write(text + "\n"));
  try {
    const parsed = parseArgs(args, runtime.env ?? process.env);
    if (parsed.help) {
      out(HELP);
      return 0;
    }
    const options = {
      profileDir: parsed.profileDir,
      installRoot: parsed.installRoot,
      profileName: parsed.profileName,
      acquire: { registry: parsed.registry }
    };
    if (parsed.command === "audit") {
      const report = await analyzeProfile(options);
      out(parsed.json ? JSON.stringify(report, null, 2) : renderReport(report));
      return reportExitCode(report, parsed.strict);
    }
    if (parsed.command === "explain") {
      const report = await explainRuntime({
        profileDir: parsed.profileDir,
        installRoot: parsed.installRoot,
        profileName: parsed.profileName,
        ...(parsed.logFile ? { logFile: parsed.logFile } : {})
      });
      out(parsed.json ? JSON.stringify(report, null, 2) : renderReport(report));
      return reportExitCode(report, parsed.strict);
    }
    if (!parsed.source) throw new Error(`${parsed.command} 缺少 <plugin>。`);
    const source = parseSourceSpec(parsed.source);
    if (parsed.command === "diff") {
      const diff = await diffCandidate(source, options);
      out(parsed.json ? JSON.stringify(diff, null, 2) : renderDiff(diff));
      return 0;
    }
    const report = await analyzeCandidate(source, options);
    out(parsed.json ? JSON.stringify(report, null, 2) : renderReport(report));
    return reportExitCode(report, parsed.strict);
  } catch (error) {
    err(`dsh-preflight: ${(error as Error).message}`);
    return 2;
  }
}

interface ParsedArgs {
  command: "check" | "audit" | "diff" | "explain";
  source?: string;
  logFile?: string;
  profileName: string;
  profileDir: string;
  installRoot: string;
  registry: string;
  json: boolean;
  strict: boolean;
  help: boolean;
}

function parseArgs(args: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  if (!args.length || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    return defaults(env, "check", true);
  }
  const command = args[0];
  if (command !== "check" && command !== "audit" && command !== "diff" && command !== "explain") throw new Error("未知命令：" + command);
  const result = defaults(env, command, false);
  let explicitProfileDir: string | undefined;
  let explicitDshHome: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token) throw new Error("参数不能为空。");
    if (token === "--json") result.json = true;
    else if (token === "--strict") result.strict = true;
    else if (token === "--help" || token === "-h") result.help = true;
    else if (token === "--profile") result.profileName = requireValue(args, ++index, token);
    else if (token === "--profile-dir") explicitProfileDir = path.resolve(requireValue(args, ++index, token));
    else if (token === "--log") result.logFile = path.resolve(requireValue(args, ++index, token));
    else if (token === "--dsh-root") result.installRoot = path.resolve(requireValue(args, ++index, token));
    else if (token === "--dsh-home") {
      explicitDshHome = path.resolve(requireValue(args, ++index, token));
    } else if (token === "--registry") result.registry = requireValue(args, ++index, token);
    else if (token?.startsWith("--")) throw new Error("未知参数：" + token);
    else if (!result.source) result.source = token;
    else throw new Error("多余参数：" + token);
  }
  const dshHome = explicitDshHome ?? resolveDshHome(env);
  if (!/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/.test(result.profileName)) {
    throw new Error("profile 名只能包含字母、数字、点、下划线和短横线；路径请使用 --profile-dir。");
  }
  if (result.logFile && result.command !== "explain") throw new Error("--log 只能用于 explain 命令。");
  result.profileDir = explicitProfileDir ?? path.join(dshHome, "profiles", result.profileName);
  return result;
}

// .dsh 根目录跟随当前用户，不能写死某台机器上的路径。
function resolveDshHome(env: NodeJS.ProcessEnv): string {
  return env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(os.homedir(), ".dsh");
}

function defaults(env: NodeJS.ProcessEnv, command: ParsedArgs["command"], help: boolean): ParsedArgs {
  const profileName = "web";
  const dshHome = resolveDshHome(env);
  return {
    command, profileName, profileDir: path.join(dshHome, "profiles", profileName),
    installRoot: env.DSH_ROOT ? path.resolve(env.DSH_ROOT) : "E:\\dsh", registry: "https://registry.npmjs.org", json: false, strict: false, help
  };
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} 缺少参数值。`);
  return value;
}

const HELP = `dsh-preflight - DSH 插件安装前冲突预演（不安装、不执行候选代码）

用法:
  dsh-preflight check <plugin> [options]
  dsh-preflight diff <plugin> [options]
  dsh-preflight audit [options]
  dsh-preflight explain [options]

options:
  --profile <name>       profile 名，默认 web
  --profile-dir <path>   直接指定 profile 目录
  --dsh-root <path>      DSH 安装根，默认 E:\\dsh
  --dsh-home <path>      DSH_HOME
  --registry <url>       npm registry
  --log <path>           explain 只分析指定日志
  --json                 输出 JSON
  --strict               WARN 也返回退出码 1`;

// argv[1] 可能是符号链接（npm link / pnpm store），而 Node 加载 ESM 前会
// realpath，import.meta.url 拿到的是真实路径。不解引用就永远不相等，
// 表现为命令静默退出、退出码 0。两边都 realpath 再比。
function isMainModule(entry: string | undefined): boolean {
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isMainModule(process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
