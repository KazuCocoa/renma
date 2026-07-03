import type { ScanResult } from "./types.js";

/** Format a scan result as stable pretty-printed JSON. */
export function formatJson(result: ScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** Format a scan result as human-readable terminal text. */
export function formatText(result: ScanResult): string {
  const lines = [
    `Renma scan`,
    `Root: ${result.root}`,
    `Config: ${result.configPath ?? "(defaults)"}`,
    `Files scanned: ${result.scannedFileCount}`,
    `Diagnostics: ${result.diagnostics.length}`,
    `Exit threshold: ${result.exitThreshold}`,
    `Findings: ${result.findings.length}`,
  ];

  if (result.findings.length === 0) {
    lines.push("No findings.");
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `diagnostic ${diagnostic.severity}: ${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`,
    );
  }

  for (const finding of result.findings) {
    lines.push("");
    const risk = finding.riskClass ? ` [${finding.riskClass}]` : "";
    lines.push(
      `${finding.severity.toUpperCase()}${risk} ${finding.id}: ${finding.title}`,
    );
    lines.push(`  ${finding.evidence.path}:${finding.evidence.startLine}`);
    if (finding.evidence.snippet)
      lines.push(`  evidence: ${finding.evidence.snippet}`);
    lines.push(`  why: ${finding.whyItMatters}`);
    lines.push(`  fix: ${finding.remediation}`);
    if (finding.constraints && finding.constraints.length > 0)
      lines.push(`  constraints: ${finding.constraints.join("; ")}`);
    if (finding.verificationSteps && finding.verificationSteps.length > 0)
      lines.push(`  verify: ${finding.verificationSteps.join("; ")}`);
    if (finding.llmHint) lines.push(`  llm: ${finding.llmHint}`);
  }

  return `${lines.join("\n")}\n`;
}
