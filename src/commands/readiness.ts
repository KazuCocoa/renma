import { graph, type GraphEdge, type GraphReport } from "./graph.js";
import { scan } from "../scanner.js";
import type { ConfigOverrides } from "../config.js";
import type { Diagnostic, Finding } from "../types.js";

export type ReadinessFormat = "json" | "markdown";

const MARKDOWN_FINDINGS_LIMIT = 50;
const WORKFLOW_CLARITY_FINDING_IDS = new Set([
  "QUAL-MISSING-DESCRIPTION",
  "QUAL-SHORT-DESCRIPTION",
  "QUAL-MISSING-NEGATIVE-ROUTING",
  "QUAL-MISSING-ROUTING-CLARITY",
  "QUAL-MISSING-EXAMPLES",
  "QUAL-MISSING-PREFLIGHT",
  "QUAL-MISSING-VERIFICATION",
  "QUAL-LOW-HEADING-DENSITY",
]);
const WORKFLOW_REQUIRED_INPUTS_FINDING_IDS = new Set([
  "QUAL-MISSING-REQUIRED-INPUTS",
]);
const WORKFLOW_COMPLETION_CRITERIA_FINDING_IDS = new Set([
  "QUAL-MISSING-COMPLETION-CRITERIA",
]);
export type ReadinessLevel = "ready" | "needs_attention" | "not_ready";
export type ReadinessCheckStatus = "pass" | "warn" | "fail";
export type ReadinessCheckSeverity = "info" | "warning" | "error";

export interface WorkflowReadinessSummary {
  skillEntrypoints: number;
  checks: number;
  pass: number;
  warn: number;
  fail: number;
  readinessPercent: number;
}

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
    workflow: WorkflowReadinessSummary;
  };
  checks: ReadinessCheck[];
  diagnostics?: Diagnostic[];
  findings?: Finding[];
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
  return report.level === "ready" ? 0 : 1;
}

export async function readiness(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<ReadinessReport> {
  const [graphReport, scanResult] = await Promise.all([
    graph(targetPath, overrides),
    scan(targetPath, overrides),
  ]);
  return buildReadinessReport(
    graphReport,
    scanResult.findings,
    scanResult.diagnostics,
  );
}

export function buildReadinessReport(
  graphReport: GraphReport,
  findings: Finding[] = [],
  diagnostics: Diagnostic[] = graphReport.diagnostics ?? [],
): ReadinessReport {
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
    workflowContextClosureCheck(graphReport),
    workflowClarityCheck(findings),
    workflowRequiredInputsCheck(findings),
    workflowCompletionCriteriaCheck(findings),
    lifecycleCheck(lifecycleAssets),
    minimumInventoryCheck(totalAssets),
    findingCheck(
      "layout.skills_thin",
      "Thin skill entrypoints",
      findings,
      ["LAYOUT-SKILL-NOT-THIN", "LAYOUT-SKILL-EXECUTABLE-COMMAND"],
      "warn",
      "All skill entrypoints are thin routers.",
    ),
    findingCheck(
      "layout.disallowed_skill_assets",
      "Disallowed skill-local assets",
      findings,
      ["LAYOUT-DISALLOWED-SKILL-ASSET"],
      "fail",
      "No canonical references, profiles, examples, or scripts live under skills/**.",
    ),
    findingCheck(
      "layout.context_root",
      "Canonical context root",
      findings,
      ["LAYOUT-CONTEXT-LEGACY-ROOT", "LAYOUT-CONTEXT-REFERENCE-NON_CANONICAL"],
      "warn",
      "Context assets and declared context paths use canonical roots.",
    ),
    findingCheck(
      "layout.helper_root",
      "Canonical helper root",
      findings,
      ["LAYOUT-HELPER-NON_TOOLS"],
      "fail",
      "Helper assets live under tools/**.",
    ),
    findingCheck(
      "paths.helper_commands",
      "Helper command paths",
      findings,
      [
        "PATH-HELPER-COMMAND-SKILL-SCRIPTS",
        "PATH-HELPER-COMMAND-NON_TOOLS",
        "PATH-HELPER-COMMAND-UNRESOLVED",
      ],
      "fail",
      "Markdown helper commands resolve to tools/**.",
    ),
    findingCheck(
      "docs.layout_consistency",
      "Layout documentation consistency",
      findings,
      ["DOCS-LAYOUT-INCONSISTENT"],
      "warn",
      "Repository docs describe the strict three-root layout.",
    ),
  ];

  const ownershipPenalty =
    totalAssets === 0 ? 0 : Math.round((unownedAssets / totalAssets) * 20);
  const layoutPenalty = layoutReadinessPenalty(checks);
  const hasWorkflowClarityWarning = checks.some(
    (check) => check.id === "workflow.clarity" && check.status === "warn",
  );
  const hasWorkflowRequiredInputsWarning = checks.some(
    (check) =>
      check.id === "workflow.required_inputs" && check.status === "warn",
  );
  const hasWorkflowCompletionCriteriaWarning = checks.some(
    (check) =>
      check.id === "workflow.completion_criteria" && check.status === "warn",
  );
  const workflowClarityPenalty = hasWorkflowClarityWarning ? 15 : 0;
  const workflowRequiredInputsPenalty = hasWorkflowRequiredInputsWarning
    ? 10
    : 0;
  const workflowCompletionCriteriaPenalty = hasWorkflowCompletionCriteriaWarning
    ? 15
    : 0;
  const score = Math.max(
    0,
    100 -
      (diagnosticCounts.error > 0 ? 40 : 0) -
      (unresolvedEdges.length > 0 ? 30 : 0) -
      ownershipPenalty -
      (totalAssets === 0 ? 10 : 0) -
      (lifecycleAssets.length > 0 ? 5 : 0) -
      layoutPenalty -
      workflowClarityPenalty -
      workflowRequiredInputsPenalty -
      workflowCompletionCriteriaPenalty,
  );
  const hasFailingCheck = checks.some((check) => check.status === "fail");
  const level = readinessLevel(score, hasFailingCheck);
  const workflow = workflowSummary(graphReport, checks);

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
      workflow,
    },
    checks,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(findings.length > 0 ? { findings } : {}),
  };
}

export function formatReadinessJson(report: ReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatReadinessMarkdown(report: ReadinessReport): string {
  const workflowReadiness =
    `skill entrypoints: ${report.summary.workflow.skillEntrypoints} / ` +
    `${report.summary.workflow.pass} pass / ` +
    `${report.summary.workflow.warn} warn / ` +
    `${report.summary.workflow.fail} fail / ` +
    `${report.summary.workflow.checks} checks ` +
    `(${report.summary.workflow.readinessPercent}%)`;
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
    `| Workflow readiness | ${workflowReadiness} |`,
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

  if (report.findings?.length) {
    lines.push("", "## Findings", "");
    const displayedFindings = report.findings.slice(0, MARKDOWN_FINDINGS_LIMIT);
    for (const finding of displayedFindings) {
      lines.push(`- ${formatMarkdownFinding(finding)}`);
      lines.push(`  - Remediation: ${finding.remediation}`);
      if (finding.llmHint) lines.push(`  - LLM hint: ${finding.llmHint}`);
    }
    const omittedCount = report.findings.length - displayedFindings.length;
    if (omittedCount > 0) {
      lines.push(
        `... ${omittedCount} more findings omitted from markdown output. Use --json for the full report.`,
      );
    }
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

function formatMarkdownFinding(finding: Finding): string {
  const { path, startLine, endLine } = finding.evidence;
  const location =
    startLine === endLine
      ? `${path}:${startLine}`
      : `${path}:${startLine}-${endLine}`;
  return `${finding.id} [${finding.severity}/${finding.category}] ${location}`;
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

function workflowContextClosureCheck(graphReport: GraphReport): ReadinessCheck {
  const skills = graphReport.nodes.filter((node) => node.kind === "skill");
  if (skills.length === 0) {
    return {
      id: "workflow.context_closure",
      title: "Workflow context closure",
      status: "pass",
      severity: "info",
      summary: "No skill workflow entrypoints were cataloged.",
    };
  }

  const nodesById = new Map(graphReport.nodes.map((node) => [node.id, node]));
  const nodesByPath = new Map(
    graphReport.nodes.map((node) => [
      normalizeGraphPath(node.sourcePath),
      node,
    ]),
  );
  const requiredEdges = graphReport.edges.filter(
    (edge) =>
      edge.kind === "requires" && nodesById.get(edge.from)?.kind === "skill",
  );
  const problems = requiredEdges.flatMap((edge) => {
    const target = edge.resolved
      ? resolveRequiredContextTarget(edge, nodesById, nodesByPath)
      : undefined;
    if (target === undefined) {
      return [
        {
          id: edge.from,
          path: edge.sourcePath,
          message: `Required context reference "${edge.to}" does not resolve.`,
        },
      ];
    }
    if (target.status === "deprecated" || target.status === "archived") {
      return [
        {
          id: edge.from,
          path: edge.sourcePath,
          message: `Required context "${edge.to}" resolves to ${target.status} asset ${target.sourcePath}.`,
        },
      ];
    }
    return [];
  });

  if (problems.length === 0) {
    return {
      id: "workflow.context_closure",
      title: "Workflow context closure",
      status: "pass",
      severity: "info",
      summary:
        "All skill required context references resolve to usable assets.",
    };
  }

  return {
    id: "workflow.context_closure",
    title: "Workflow context closure",
    status: "fail",
    severity: "error",
    summary: `${problems.length} required workflow context reference${
      problems.length === 1 ? "" : "s"
    } did not close.`,
    evidence: problems,
  };
}

function resolveRequiredContextTarget(
  edge: GraphEdge,
  nodesById: Map<string, GraphReport["nodes"][number]>,
  nodesByPath: Map<string, GraphReport["nodes"][number]>,
): GraphReport["nodes"][number] | undefined {
  if (edge.targetId !== undefined) {
    const byTargetId = nodesById.get(edge.targetId);
    if (byTargetId !== undefined) return byTargetId;
  }
  if (edge.targetPath !== undefined) {
    const byTargetPath = nodesByPath.get(normalizeGraphPath(edge.targetPath));
    if (byTargetPath !== undefined) return byTargetPath;
  }
  return nodesById.get(edge.to) ?? nodesByPath.get(normalizeGraphPath(edge.to));
}

function workflowClarityCheck(findings: Finding[]): ReadinessCheck {
  const matched = findings.filter(
    (finding) =>
      WORKFLOW_CLARITY_FINDING_IDS.has(finding.id) &&
      isSkillEntrypointPath(finding.evidence.path),
  );
  if (matched.length === 0) {
    return {
      id: "workflow.clarity",
      title: "Workflow clarity",
      status: "pass",
      severity: "info",
      summary: "All skill workflow entrypoints include static routing clarity.",
    };
  }

  return {
    id: "workflow.clarity",
    title: "Workflow clarity",
    status: "warn",
    severity: "warning",
    summary: `${matched.length} workflow clarity finding${
      matched.length === 1 ? "" : "s"
    } matched skill entrypoints.`,
    evidence: matched.map((finding) => ({
      id: finding.id,
      path: finding.evidence.path,
      message: finding.remediation,
    })),
  };
}

function workflowRequiredInputsCheck(findings: Finding[]): ReadinessCheck {
  const matched = findings.filter(
    (finding) =>
      WORKFLOW_REQUIRED_INPUTS_FINDING_IDS.has(finding.id) &&
      isSkillEntrypointPath(finding.evidence.path),
  );
  if (matched.length === 0) {
    return {
      id: "workflow.required_inputs",
      title: "Workflow required inputs",
      status: "pass",
      severity: "info",
      summary:
        "All skill workflow entrypoints document required inputs or prerequisites.",
    };
  }

  return {
    id: "workflow.required_inputs",
    title: "Workflow required inputs",
    status: "warn",
    severity: "warning",
    summary: `${matched.length} workflow required-input finding${
      matched.length === 1 ? "" : "s"
    } matched skill entrypoints.`,
    evidence: matched.map((finding) => ({
      id: finding.id,
      path: finding.evidence.path,
      message: finding.remediation,
    })),
  };
}

function workflowCompletionCriteriaCheck(findings: Finding[]): ReadinessCheck {
  const matched = findings.filter(
    (finding) =>
      WORKFLOW_COMPLETION_CRITERIA_FINDING_IDS.has(finding.id) &&
      isSkillEntrypointPath(finding.evidence.path),
  );
  if (matched.length === 0) {
    return {
      id: "workflow.completion_criteria",
      title: "Workflow completion criteria",
      status: "pass",
      severity: "info",
      summary: "All skill workflow entrypoints document completion criteria.",
    };
  }

  return {
    id: "workflow.completion_criteria",
    title: "Workflow completion criteria",
    status: "warn",
    severity: "warning",
    summary: `${matched.length} workflow completion-criteria finding${
      matched.length === 1 ? "" : "s"
    } matched skill entrypoints.`,
    evidence: matched.map((finding) => ({
      id: finding.id,
      path: finding.evidence.path,
      message: finding.remediation,
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

function findingCheck(
  id: string,
  title: string,
  findings: Finding[],
  findingIds: string[],
  failingStatus: "warn" | "fail",
  passSummary: string,
): ReadinessCheck {
  const matched = findings.filter((finding) => findingIds.includes(finding.id));
  if (matched.length === 0) {
    return {
      id,
      title,
      status: "pass",
      severity: "info",
      summary: passSummary,
    };
  }

  return {
    id,
    title,
    status: failingStatus,
    severity: failingStatus === "fail" ? "error" : "warning",
    summary: `${matched.length} strict layout finding${
      matched.length === 1 ? "" : "s"
    } matched this check.`,
    evidence: matched.map((finding) => ({
      id: finding.id,
      path: finding.evidence.path,
      message: finding.remediation,
    })),
  };
}

function layoutReadinessPenalty(checks: ReadinessCheck[]): number {
  return checks.reduce((penalty, check) => {
    if (!check.id.startsWith("layout.") && check.id !== "paths.helper_commands")
      return penalty;
    if (check.status === "fail") return penalty + 15;
    if (check.status === "warn") return penalty + 5;
    return penalty;
  }, 0);
}

function workflowSummary(
  graphReport: GraphReport,
  checks: ReadinessCheck[],
): WorkflowReadinessSummary {
  const workflowChecks = checks.filter((check) =>
    check.id.startsWith("workflow."),
  );
  const pass = workflowChecks.filter((check) => check.status === "pass").length;
  const warn = workflowChecks.filter((check) => check.status === "warn").length;
  const fail = workflowChecks.filter((check) => check.status === "fail").length;

  return {
    skillEntrypoints: graphReport.nodes.filter((node) => node.kind === "skill")
      .length,
    checks: workflowChecks.length,
    pass,
    warn,
    fail,
    readinessPercent: percentage(pass, workflowChecks.length),
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

function isSkillEntrypointPath(path: string): boolean {
  return /^skills\/[^/]+\/SKILL\.md$/.test(normalizeGraphPath(path));
}

function normalizeGraphPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ");
}
