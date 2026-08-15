import type { Finding } from "./types.js";

export interface Report {
  command: "check" | "audit";
  subject: string;
  verdict: "BLOCK" | "REVIEW" | "CLEAR";
  summary: { block: number; warn: number; info: number; unknown: number };
  findings: Finding[];
  installCommand?: string;
}

const LEVEL_WEIGHT: Record<Finding["level"], number> = { BLOCK: 0, WARN: 1, UNKNOWN: 2, INFO: 3 };

export function createReport(command: "check" | "audit", subject: string, findings: Finding[], installCommand?: string): Report {
  const sorted = [...findings].sort((a, b) => LEVEL_WEIGHT[a.level] - LEVEL_WEIGHT[b.level] || a.id.localeCompare(b.id));
  const summary = {
    block: sorted.filter((item) => item.level === "BLOCK").length,
    warn: sorted.filter((item) => item.level === "WARN").length,
    info: sorted.filter((item) => item.level === "INFO").length,
    unknown: sorted.filter((item) => item.level === "UNKNOWN").length
  };
  const verdict = summary.block > 0 ? "BLOCK" : summary.warn > 0 || summary.unknown > 0 ? "REVIEW" : "CLEAR";
  return { command, subject, verdict, summary, findings: sorted, ...(installCommand ? { installCommand } : {}) };
}

export function reportExitCode(report: Report, strict: boolean): number {
  if (report.summary.block > 0 || strict && report.summary.warn > 0) return 1;
  return 0;
}

export function renderReport(report: Report): string {
  const first = report.verdict === "BLOCK"
    ? `✗ 不建议${report.command === "check" ? "安装 " : "继续使用 "}${report.subject}`
    : report.verdict === "REVIEW"
      ? `! 未发现 BLOCK，但需要人工复核 ${report.subject}`
      : `✓ 未发现已实现规则中的 BLOCK：${report.subject}`;
  const lines = [first, "  这不是安全性证明；候选代码从未被执行。", ""];
  if (report.findings.length === 0) lines.push("  无 finding。", "");
  for (const finding of report.findings) {
    lines.push(`  [${finding.level}] ${finding.id} — ${finding.title}`);
    lines.push(`    ${finding.detail}`);
    lines.push(`    证据: ${finding.evidence}`);
    if (finding.consequence) lines.push(`    后果: ${finding.consequence}`);
    if (finding.remediation) lines.push(`    建议: ${finding.remediation}`);
    lines.push("");
  }
  if (report.installCommand) lines.push(`  装的话执行: ${report.installCommand}`);
  return lines.join("\n").trimEnd();
}

export function makeInstallCommand(profileName: string, installSpec: string): string {
  return `dsh plugin --profile ${quoteArg(profileName)} add ${quoteArg(installSpec)}`;
}

function quoteArg(value: string): string {
  if (!/[\s#&|<>^()]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
