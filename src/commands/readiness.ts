import { graph, type GraphEdge, type GraphReport } from "./graph.js";
import type { ConfigOverrides } from "../config.js";
import type { Diagnostic } from "../types.js";

export type ReadinessFormat = "json" | "markdown";
export type ReadinessLevel = "ready" | "needs_attention" | "not_ready";
export type ReadinessCheckStatus = "pass" | "warn" | "fail";
export type ReadinessCheckSeverity = "info" | "warning" | "error";

export interface ReadinessReport {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  score: number;
  level: ReadinessLevel;
  summary: {
    totalAssets: number;
    ownedAssets: number;
    unownedAssets: number;
    ownershipCoveragePercent: number;
    nodeCount: number;
    edgeCount: number;
    resolvedEdges: number;
    unresolvedEdges: number;
    graphResolutionPercent: number;
    diagnosticCounts: {
      error: number;
      warning: number;
      info: number;
    };
  };
  checks: ReadinessCheck[];
  diagnostics?: Diagnostic[];
}

export interface ReadinessCheck {
  id: string;
  title: string;
  status: ReadinessCheckStatus;
  severity: ReadinessCheckSeverity;
  summary: string;
  evidence?: Array<{
    id?: string;
    path?: string;
    message?: string;
  }>;
}

export async function runReadinessCommand(
  targetPath: string,
  options: { format: ReadinessFormat; overrides?: ConfigOverrides },
): Promise<number> {
  const report = await readiness(targetPath, options.overrides ?? {});
  process.stdout.write(formatReadiness(report, options.format));
  return 0;
}

export async function readiness(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<ReadinessReport> {
  const graphReport = await graph(targetPath, overrides);
  return buildReadinessReport(graphReport);
}

export function buildReadinessReport(
  graphReport: GraphReport,
): ReadinessReport {
  const diagnostics = graphReport.diagnostics ?? [];
  const diagnosticCounts = countDiagnostics(diagnostics);
  const totalAssets = graphReport.nodes.length;
  const ownedAssets = graphReport.nodes.filter((node) =>
    hasOwner(node.owner),
  ).length;
  const unownedAssets = totalAssets - ownedAssets;
  const ownershipCoveragePercent = percentage(ownedAssets, totalAssets);
  const unresolvedEdges = graphReport.edges.filter((edge) => !edge.resolved);
  const resolvedEdges = graphReport.edges.length - unresolvedEdges.length;
  const graphResolutionPercent = percentage(
    resolvedEdges,
    graphReport.edges.length,
  );
  const lifecycleAssets = graphReport.nodes.filter(
    (node) => node.status === "deprecated" || node.status === "archived",
  );

  const checks: ReadinessCheck[] = [
    diagnosticsCheck(diagnosticCounts.error, diagnostics),
    ownershipCheck(unownedAssets, totalAssets, graphReport.nodes),
    graphEdgesCheck(unresolvedEdges),
    lifecycleCheck(lifecycleAssets),
    minimumInventoryCheck(totalAssets),
  ];

  const ownershipPenalty =
    totalAssets === 0 ? 0 : Math.round((unownedAssets / totalAssets) * 20);
  const score = Math.max(
    0,
    100 -
      (diagnosticCounts.error > 0 ? 40 : 0) -
      (unresolvedEdges.length > 0 ? 30 : 0) -
      ownershipPenalty -
      (totalAssets === 0 ? 10 : 0) -
      (lifecycleAssets.length > 0 ? 5 : 0),
  );
  const hasFailingCheck = checks.some((check) => check.status === "fail");
  const level = readinessLevel(score, hasFailingCheck);

  return {
    root: graphReport.root,
    ...(graphReport.configPath ? { configPath: graphReport.configPath } : {}),
    scannedFileCount: graphReport.scannedFileCount,
    score,
    level,
    summary: {
      totalAssets,
      ownedAssets,
      unownedAssets,
      ownershipCoveragePercent,
      nodeCount: graphReport.nodeCount,
      edgeCount: graphReport.edgeCount,
      resolvedEdges,
      unresolvedEdges: unresolvedEdges.length,
      graphResolutionPercent,
      diagnosticCounts,
    },
    checks,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function formatReadinessJson(report: ReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatReadinessMarkdown(report: ReadinessReport): string {
  const lines = [
    "# Agent Readiness",
    "",
    `- Root: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- Level: ${report.level}`,
    `- Score: ${report.score}`,
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Total assets | ${report.summary.totalAssets} |`,
    `| Owned assets | ${report.summary.ownedAssets} |`,
    `| Unowned assets | ${report.summary.unownedAssets} |`,
    `| Ownership coverage | ${report.summary.ownershipCoveragePercent}% |`,
    `| Graph nodes | ${report.summary.nodeCount} |`,
    `| Graph edges | ${report.summary.edgeCount} |`,
    `| Resolved edges | ${report.summary.resolvedEdges} |`,
    `| Unresolved edges | ${report.summary.unresolvedEdges} |`,
    `| Graph resolution | ${report.summary.graphResolutionPercent}% |`,
    `| Diagnostic errors | ${report.summary.diagnosticCounts.error} |`,
    `| Diagnostic warnings | ${report.summary.diagnosticCounts.warning} |`,
    `| Diagnostic info | ${report.summary.diagnosticCounts.info} |`,
    "",
    "| Check | Status | Severity | Summary |",
    "| --- | --- | --- | --- |",
    ...report.checks.map(
      (check) =>
        `| ${check.id} | ${check.status} | ${check.severity} | ${escapeTableCell(
          check.summary,
        )} |`,
    ),
  ];

  if (report.diagnostics && report.diagnostics.length > 0) {
    lines.push("", "## Diagnostics", "");
    lines.push(
      ...report.diagnostics.map((diagnostic) => {
        const path = diagnostic.path ? `${diagnostic.path}: ` : "";
        return `- ${diagnostic.severity}: ${path}${diagnostic.message}`;
      }),
    );
  }

  return `${lines.join("\n")}\n`;
}

export function formatReadiness(
  report: ReadinessReport,
  format: ReadinessFormat,
): string {
  return format === "json"
    ? formatReadinessJson(report)
    : formatReadinessMarkdown(report);
}

function diagnosticsCheck(
  errorCount: number,
  diagnostics: Diagnostic[],
): ReadinessCheck {
  if (errorCount === 0) {
    return {
      id: "diagnostics.errors",
      title: "Diagnostic errors",
      status: "pass",
      severity: "info",
      summary: "No error diagnostics were reported.",
    };
  }

  return {
    id: "diagnostics.errors",
    title: "Diagnostic errors",
    status: "fail",
    severity: "error",
    summary: `${errorCount} error diagnostic${errorCount === 1 ? "" : "s"} reported.`,
    evidence: diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => ({
        ...(diagnostic.path ? { path: diagnostic.path } : {}),
        message: diagnostic.message,
      })),
  };
}

function ownershipCheck(
  unownedAssets: number,
  totalAssets: number,
  nodes: GraphReport["nodes"],
): ReadinessCheck {
  if (unownedAssets === 0) {
    return {
      id: "ownership.coverage",
      title: "Ownership coverage",
      status: "pass",
      severity: "info",
      summary:
        totalAssets === 0
          ? "No assets were cataloged."
          : "All cataloged assets declare an owner.",
    };
  }

  return {
    id: "ownership.coverage",
    title: "Ownership coverage",
    status: "warn",
    severity: "warning",
    summary: `${unownedAssets} of ${totalAssets} cataloged assets do not declare an owner.`,
    evidence: nodes
      .filter((node) => !hasOwner(node.owner))
      .map((node) => ({
        id: node.id,
        path: node.sourcePath,
        message: "Missing owner metadata.",
      })),
  };
}

function graphEdgesCheck(unresolvedEdges: GraphEdge[]): ReadinessCheck {
  if (unresolvedEdges.length === 0) {
    return {
      id: "graph.unresolved_edges",
      title: "Unresolved graph edges",
      status: "pass",
      severity: "info",
      summary: "All declared graph edges resolve.",
    };
  }

  return {
    id: "graph.unresolved_edges",
    title: "Unresolved graph edges",
    status: "fail",
    severity: "error",
    summary: `${unresolvedEdges.length} declared graph edge${
      unresolvedEdges.length === 1 ? "" : "s"
    } could not be resolved.`,
    evidence: unresolvedEdges.map((edge) => ({
      id: edge.from,
      path: edge.sourcePath,
      message: `${edge.kind} reference "${edge.to}" does not resolve.`,
    })),
  };
}

function lifecycleCheck(nodes: GraphReport["nodes"]): ReadinessCheck {
  if (nodes.length === 0) {
    return {
      id: "assets.lifecycle",
      title: "Asset lifecycle",
      status: "pass",
      severity: "info",
      summary: "No deprecated or archived assets were cataloged.",
    };
  }

  return {
    id: "assets.lifecycle",
    title: "Asset lifecycle",
    status: "warn",
    severity: "warning",
    summary: `${nodes.length} deprecated or archived asset${
      nodes.length === 1 ? "" : "s"
    } cataloged.`,
    evidence: nodes.map((node) => ({
      id: node.id,
      path: node.sourcePath,
      message: `Asset status is ${node.status}.`,
    })),
  };
}

function minimumInventoryCheck(totalAssets: number): ReadinessCheck {
  if (totalAssets > 0) {
    return {
      id: "assets.minimum_inventory",
      title: "Minimum inventory",
      status: "pass",
      severity: "info",
      summary: `${totalAssets} cataloged asset${totalAssets === 1 ? "" : "s"} found.`,
    };
  }

  return {
    id: "assets.minimum_inventory",
    title: "Minimum inventory",
    status: "fail",
    severity: "error",
    summary: "No cataloged assets were found.",
  };
}

function countDiagnostics(diagnostics: Diagnostic[]): {
  error: number;
  warning: number;
  info: number;
} {
  return diagnostics.reduce(
    (counts, diagnostic) => ({
      ...counts,
      [diagnostic.severity]: counts[diagnostic.severity] + 1,
    }),
    { error: 0, warning: 0, info: 0 },
  );
}

function readinessLevel(
  score: number,
  hasFailingCheck: boolean,
): ReadinessLevel {
  if (score >= 90 && !hasFailingCheck) return "ready";
  if (score < 60 || hasFailingCheck) return "not_ready";
  return "needs_attention";
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 100;
  return Math.round((numerator / denominator) * 100);
}

function hasOwner(owner: string | undefined): boolean {
  return owner !== undefined && owner.trim().length > 0;
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ");
}
