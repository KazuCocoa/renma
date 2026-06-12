import type { ScanResult } from "./types.js";

export function formatJson(result: ScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatText(result: ScanResult): string {
  const lines = [
    `SkillForge scan`,
    `Root: ${result.root}`,
    `Config: ${result.configPath ?? "(defaults)"}`,
    `Files scanned: ${result.scannedFileCount}`,
    `Exit threshold: ${result.exitThreshold}`,
    `Findings: ${result.findings.length}`
  ];

  for (const diagnostic of result.diagnostics) {
    lines.push(`diagnostic ${diagnostic.severity}: ${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`);
  }

  for (const finding of result.findings) {
    lines.push("");
    lines.push(`${finding.severity.toUpperCase()} ${finding.id}: ${finding.title}`);
    lines.push(`  ${finding.evidence.path}:${finding.evidence.startLine}`);
    if (finding.evidence.snippet) lines.push(`  evidence: ${finding.evidence.snippet}`);
    lines.push(`  why: ${finding.whyItMatters}`);
    lines.push(`  fix: ${finding.remediation}`);
  }

  return `${lines.join("\n")}\n`;
}
