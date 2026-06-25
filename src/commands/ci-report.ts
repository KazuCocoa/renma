import { diff, type DiffReport, type DiffFormat } from "./diff.js";
import type { ConfigOverrides } from "../config.js";

export type CiReportFormat = DiffFormat;
export type CiReportStatus = "pass" | "warn" | "fail";

export interface CiReport {
  root: string;
  from: DiffReport["from"];
  to: DiffReport["to"];
  status: CiReportStatus;
  summary: DiffReport["summary"];
  notes: string[];
  diff: DiffReport;
}

interface CiReportOptions {
  fromRef: string;
  toRef: string;
  overrides?: ConfigOverrides;
}

const MAX_LIST_ITEMS = 10;

interface ReportFinding {
  id: string;
  severity: string;
  title: string;
  evidence?:
    | {
        path?: string | undefined;
        startLine?: number | undefined;
      }
    | undefined;
}

export async function runCiReportCommand(
  targetPath: string,
  options: CiReportOptions & { format: CiReportFormat },
): Promise<number> {
  const report = await ciReport(targetPath, options);
  process.stdout.write(formatCiReport(report, options.format));
  return report.status === "fail" ? 1 : 0;
}

export async function ciReport(
  targetPath: string,
  options: CiReportOptions,
): Promise<CiReport> {
  const report = await diff(targetPath, options);
  const status = determineCiReportStatus(report);
  return {
    root: report.root,
    from: report.from,
    to: report.to,
    status,
    summary: report.summary,
    notes: reviewNotes(report, status),
    diff: report,
  };
}

export function formatCiReport(
  report: CiReport,
  format: CiReportFormat,
): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  return formatCiReportMarkdown(report);
}

export function determineCiReportStatus(report: DiffReport): CiReportStatus {
  if (
    hasNewHighOrCriticalFinding(report) ||
    hasNewUnresolvedRequiredEdge(report)
  ) {
    return "fail";
  }

  if (
    report.summary.readinessScoreDelta < 0 ||
    report.summary.ownershipCoverageDelta < 0 ||
    report.summary.graphResolutionDelta < 0 ||
    report.summary.findingsDelta > 0
  ) {
    return "warn";
  }

  return "pass";
}

function hasNewHighOrCriticalFinding(report: DiffReport): boolean {
  return report.findings.added.some(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  );
}

function hasNewUnresolvedRequiredEdge(report: DiffReport): boolean {
  return report.graph.newUnresolvedEdges.some(isRequiredEdge);
}

function newUnresolvedRequiredEdgeCount(report: DiffReport): number {
  return report.graph.newUnresolvedEdges.filter(isRequiredEdge).length;
}

function isRequiredEdge(edge: { kind: string }): boolean {
  return edge.kind === "required" || edge.kind === "requires";
}

function reviewNotes(report: DiffReport, status: CiReportStatus): string[] {
  const notes: string[] = [];

  if (hasNewUnresolvedRequiredEdge(report)) {
    notes.push("Review new unresolved required edges before merge.");
  }
  if (hasNewHighOrCriticalFinding(report)) {
    notes.push("Review new high or critical findings before merge.");
  }
  if (report.summary.readinessScoreDelta < 0) {
    notes.push("Readiness score decreased.");
  }
  if (report.summary.ownershipCoverageDelta > 0) {
    notes.push("Ownership coverage improved.");
  }
  if (report.summary.findingsDelta < 0) {
    notes.push("Scan findings decreased.");
  }
  if (status === "pass" && notes.length === 0) {
    notes.push("No CI report regressions detected.");
  }

  return notes;
}

function formatCiReportMarkdown(report: CiReport): string {
  const lines = [
    "# Renma CI Report",
    "",
    "## Summary",
    "",
    `- Status: ${formatStatus(report.status)}`,
    `- Range: \`${report.from.ref}\` -> \`${report.to.ref}\``,
    `- Readiness: ${report.from.readinessLevel} ${report.from.readinessScore} -> ${report.to.readinessLevel} ${report.to.readinessScore} (${formatDelta(report.summary.readinessScoreDelta)})`,
    `- Total assets: ${report.from.totalAssets} -> ${report.to.totalAssets} (${formatDelta(report.summary.totalAssetsDelta)})`,
    `- Ownership coverage: ${formatDelta(report.summary.ownershipCoverageDelta)}`,
    `- Graph resolution: ${formatDelta(report.summary.graphResolutionDelta)}`,
    `- Findings: ${formatDelta(report.summary.findingsDelta)}`,
    `- High/critical findings: ${formatDelta(report.summary.highOrCriticalFindingsDelta)}`,
    "",
    "## Status",
    "",
    formatStatus(report.status),
    "",
    "## Readiness",
    "",
    `- Target readiness: ${report.to.readinessLevel} (${report.to.readinessScore})`,
    `- Scanned files: ${report.to.scannedFileCount}`,
    `- Check changes: ${report.diff.readiness.checkChanges.length}`,
    "",
    "## Semantic Diff",
    "",
    `- Added assets: ${report.diff.catalog.addedAssets.length}`,
    `- Removed assets: ${report.diff.catalog.removedAssets.length}`,
    `- Changed assets: ${report.diff.catalog.changedAssets.length}`,
    `- New unresolved required edges: ${newUnresolvedRequiredEdgeCount(report.diff)}`,
    `- Resolved edges: ${report.diff.graph.resolvedEdges.length}`,
    `- Added findings: ${report.diff.findings.added.length}`,
    `- Resolved findings: ${report.diff.findings.removed.length}`,
    "",
    "## Scan Findings",
    "",
    ...formatFindingSection("Added", report.diff.findings.added),
    ...formatFindingSection("Resolved", report.diff.findings.removed),
    "",
    "## Finding Count Changes",
    "",
    ...formatCountChanges(report.diff.findings.countById),
    "",
    "## Review Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return String(value);
  return "+0";
}

function formatFindingSection(
  label: string,
  findings: ReportFinding[],
): string[] {
  if (findings.length === 0) return [`### ${label}`, "", "- None"];

  return [
    `### ${label}`,
    "",
    ...findings.slice(0, MAX_LIST_ITEMS).map(formatFinding),
    ...formatOverflow(findings.length),
  ];
}

function formatFinding(finding: ReportFinding): string {
  const location = formatFindingLocation(finding);
  return `- ${finding.severity.toUpperCase()} \`${finding.id}\` \`${location}\` — ${finding.title}`;
}

function formatFindingLocation(finding: ReportFinding): string {
  if (!finding.evidence?.path) return "unknown";
  if (finding.evidence.startLine === undefined) return finding.evidence.path;
  return `${finding.evidence.path}:L${finding.evidence.startLine}`;
}

function formatCountChanges(
  changes: Array<{ id: string; from: number; to: number; delta: number }>,
): string[] {
  if (changes.length === 0) return ["- None"];
  return [
    ...changes
      .slice(0, MAX_LIST_ITEMS)
      .map(
        (change) =>
          `- ${change.id}: ${change.from} -> ${change.to} (${formatDelta(change.delta)})`,
      ),
    ...formatOverflow(changes.length),
  ];
}

function formatOverflow(length: number): string[] {
  if (length <= MAX_LIST_ITEMS) return [];
  return [
    `- ${length - MAX_LIST_ITEMS} more not shown; see JSON for the full list.`,
  ];
}

function formatStatus(status: CiReportStatus): string {
  switch (status) {
    case "pass":
      return "PASS — no blocking CI review issues detected";
    case "warn":
      return "WARN — review recommended before merge";
    case "fail":
      return "FAIL — blocking CI review issue detected";
  }
}
