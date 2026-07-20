import {
  graphFromRepositorySnapshot,
  type GraphEdge,
  type GraphReport,
} from "./graph.js";
import { DIAGNOSTIC_IDS } from "../diagnostic-ids.js";
import { classifyRepositorySkillEntrypointPath } from "../discovery.js";
import {
  zeroContextLensSummary,
  type ContextLensSummary,
} from "../context-lens.js";
import { scanFromRepositorySnapshot } from "../scanner.js";
import {
  summarizeSecurityPosture,
  type SecurityPostureSummary,
} from "../security-posture.js";
import {
  zeroSecurityPolicyInventorySummary,
  type SecurityPolicyInventorySummary,
} from "../security-policy-inventory.js";
import type { ConfigOverrides } from "../config.js";
import {
  collectRepositorySnapshot,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import type { Diagnostic, Finding } from "../types.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import type { AgentSkillsValidationSummary } from "../agent-skills.js";

export type ReadinessFormat = "json" | "markdown";

const QUALITY = DEFAULT_QUALITY_PROFILE;
const MARKDOWN_FINDINGS_LIMIT =
  QUALITY.presentation.markdownReadinessFindingCap;
const WORKFLOW_CLARITY_FINDING_IDS = new Set<string>([
  DIAGNOSTIC_IDS.QUAL_MISSING_DESCRIPTION,
  DIAGNOSTIC_IDS.QUAL_SHORT_DESCRIPTION,
  DIAGNOSTIC_IDS.QUAL_MISSING_NEGATIVE_ROUTING,
  DIAGNOSTIC_IDS.QUAL_MISSING_ROUTING_CLARITY,
  DIAGNOSTIC_IDS.QUAL_MISSING_EXAMPLES,
  DIAGNOSTIC_IDS.QUAL_MISSING_PREFLIGHT,
  DIAGNOSTIC_IDS.QUAL_MISSING_VERIFICATION,
  DIAGNOSTIC_IDS.QUAL_LOW_HEADING_DENSITY,
]);
const WORKFLOW_REQUIRED_INPUTS_FINDING_IDS = new Set<string>([
  DIAGNOSTIC_IDS.QUAL_MISSING_REQUIRED_INPUTS,
]);
const WORKFLOW_COMPLETION_CRITERIA_FINDING_IDS = new Set<string>([
  DIAGNOSTIC_IDS.QUAL_MISSING_COMPLETION_CRITERIA,
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
    contextLens: ContextLensSummary;
    securityPosture: SecurityPostureSummary;
    securityPolicyInventory: SecurityPolicyInventorySummary;
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
  return readinessFromRepositorySnapshot(
    await collectRepositorySnapshot(targetPath, overrides),
  );
}

/** Derive graph and scan inputs from the same repository evidence boundary. */
export function readinessFromRepositorySnapshot(
  snapshot: RepositorySnapshot,
): ReadinessReport {
  const graphReport = graphFromRepositorySnapshot(snapshot);
  const scanResult = scanFromRepositorySnapshot(snapshot, {
    includeSkillDiscoveryDiagnostics: false,
  });
  return buildReadinessReport(
    graphReport,
    scanResult.findings,
    scanResult.diagnostics,
    scanResult.contextLens,
    scanResult.securityPolicyInventory,
    scanResult.agentSkills,
  );
}

export function buildReadinessReport(
  graphReport: GraphReport,
  findings: Finding[] = [],
  diagnostics: Diagnostic[] = graphReport.diagnostics ?? [],
  contextLens: ContextLensSummary = zeroContextLensSummary(),
  securityPolicyInventory: SecurityPolicyInventorySummary = zeroSecurityPolicyInventorySummary(),
  agentSkills?: AgentSkillsValidationSummary,
): ReadinessReport {
  const diagnosticCounts = countDiagnostics(diagnostics);
  const totalAssets = graphReport.nodes.length;
  const ownedAssets = graphReport.nodes.filter((node) =>
    hasOwner(node.ownership.effectiveOwner ?? undefined),
  ).length;
  const unownedAssets = totalAssets - ownedAssets;
  const ownershipCoveragePercent = percentage(ownedAssets, totalAssets);
  const unresolvedEdges = graphReport.edges.filter((edge) => !edge.resolved);
  const unresolvedBlockingEdges = unresolvedEdges.filter(
    (edge) => edge.kind !== "optional",
  );
  const resolvedEdges = graphReport.edges.length - unresolvedEdges.length;
  const graphResolutionPercent = percentage(
    resolvedEdges,
    graphReport.edges.length,
  );
  const lifecycleAssets = graphReport.nodes.filter(
    (node) => node.status === "deprecated" || node.status === "archived",
  );

  /**
   * Workflow checks are static entrypoint-readiness checks.
   * Keep required context strict, optional context advisory, and avoid runtime
   * context selection or prompt/package assembly in this report.
   */
  const checks: ReadinessCheck[] = [
    diagnosticsCheck(diagnosticCounts.error, diagnostics),
    agentSkillsSpecificationCheck(agentSkills),
    blockingSecurityCheck(findings),
    ownershipCheck(unownedAssets, totalAssets, graphReport.nodes),
    graphEdgesCheck(unresolvedBlockingEdges),
    workflowContextClosureCheck(graphReport),
    workflowOptionalContextCheck(graphReport),
    workflowClarityCheck(findings),
    workflowRequiredInputsCheck(findings),
    workflowCompletionCriteriaCheck(findings),
    contextLensGovernanceCheck(contextLens, diagnostics),
    lifecycleCheck(lifecycleAssets),
    freshnessCheck(findings),
    minimumInventoryCheck(totalAssets),
    findingCheck(
      "workflow.skills_focused",
      "Focused skill workflows",
      findings,
      [
        DIAGNOSTIC_IDS.QUAL_SKILL_MIXED_RESPONSIBILITY,
        DIAGNOSTIC_IDS.QUAL_SKILL_PROGRESSIVE_DISCLOSURE,
      ],
      "warn",
      "Skill entrypoints are focused, discoverable workflows that use progressive disclosure appropriately.",
    ),
    findingCheck(
      "layout.disallowed_skill_assets",
      "Skill-local support policy",
      findings,
      [DIAGNOSTIC_IDS.LAYOUT_DISALLOWED_SKILL_ASSET],
      "fail",
      "Valid Skill-local support is allowed; reusable knowledge is promoted only when deterministic evidence supports it.",
    ),
    findingCheck(
      "layout.context_root",
      "Canonical context root",
      findings,
      [
        DIAGNOSTIC_IDS.LAYOUT_CONTEXT_LEGACY_ROOT,
        DIAGNOSTIC_IDS.LAYOUT_CONTEXT_REFERENCE_NON_CANONICAL,
      ],
      "warn",
      "Context assets and declared context paths use canonical roots.",
    ),
    findingCheck(
      "layout.helper_root",
      "Canonical helper root",
      findings,
      [DIAGNOSTIC_IDS.LAYOUT_HELPER_NON_TOOLS],
      "fail",
      "Shared helpers use tools/** and Skill-specific scripts may remain local.",
    ),
    findingCheck(
      "paths.helper_commands",
      "Helper command paths",
      findings,
      [
        DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_NON_TOOLS,
        DIAGNOSTIC_IDS.PATH_HELPER_COMMAND_UNRESOLVED,
      ],
      "fail",
      "Markdown helper commands resolve to tools/** or valid Skill-local scripts.",
    ),
    findingCheck(
      "docs.layout_consistency",
      "Layout documentation consistency",
      findings,
      [DIAGNOSTIC_IDS.DOCS_LAYOUT_INCONSISTENT],
      "warn",
      "Repository docs describe canonical Skill roots, valid local support, governed Context Assets, and shared helpers consistently.",
    ),
  ];

  const ownershipPenalty =
    totalAssets === 0
      ? 0
      : Math.round(
          (unownedAssets / totalAssets) *
            QUALITY.readiness.ownershipMaximumPenalty,
        );
  const layoutPenalty = layoutReadinessPenalty(checks);
  const hasWorkflowClarityWarning = checks.some(
    (check) => check.id === "workflow.clarity" && check.status === "warn",
  );
  const hasWorkflowOptionalContextWarning = checks.some(
    (check) =>
      check.id === "workflow.optional_context" && check.status === "warn",
  );
  const hasWorkflowRequiredInputsWarning = checks.some(
    (check) =>
      check.id === "workflow.required_inputs" && check.status === "warn",
  );
  const hasWorkflowCompletionCriteriaWarning = checks.some(
    (check) =>
      check.id === "workflow.completion_criteria" && check.status === "warn",
  );
  const workflowClarityPenalty = hasWorkflowClarityWarning
    ? QUALITY.readiness.workflowClarityPenalty
    : 0;
  const workflowOptionalContextPenalty = hasWorkflowOptionalContextWarning
    ? QUALITY.readiness.workflowOptionalContextPenalty
    : 0;
  const workflowRequiredInputsPenalty = hasWorkflowRequiredInputsWarning
    ? QUALITY.readiness.workflowRequiredInputsPenalty
    : 0;
  const workflowCompletionCriteriaPenalty = hasWorkflowCompletionCriteriaWarning
    ? QUALITY.readiness.workflowCompletionCriteriaPenalty
    : 0;
  const score = Math.max(
    0,
    100 -
      (diagnosticCounts.error > 0
        ? QUALITY.readiness.blockingDiagnosticPenalty
        : 0) -
      (unresolvedBlockingEdges.length > 0
        ? QUALITY.readiness.unresolvedRequiredGraphPenalty
        : 0) -
      ownershipPenalty -
      (totalAssets === 0 ? QUALITY.readiness.emptyInventoryPenalty : 0) -
      layoutPenalty -
      workflowClarityPenalty -
      workflowOptionalContextPenalty -
      workflowRequiredInputsPenalty -
      workflowCompletionCriteriaPenalty,
  );
  const hasFailingCheck = checks.some((check) => check.status === "fail");
  const level = readinessLevel(score, hasFailingCheck);
  const workflow = workflowSummary(graphReport, checks);
  const securityPosture = summarizeSecurityPosture(findings);

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
      contextLens,
      securityPosture,
      securityPolicyInventory,
    },
    checks,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...(findings.length > 0 ? { findings } : {}),
  };
}

function agentSkillsSpecificationCheck(
  summary: AgentSkillsValidationSummary | undefined,
): ReadinessCheck {
  const invalid = summary?.results.filter((result) => !result.valid) ?? [];
  if (invalid.length === 0) {
    return {
      id: "specification.agent_skills",
      title: "Agent Skills specification",
      status: "pass",
      severity: "info",
      summary: summary
        ? `${summary.validSkillCount}/${summary.totalSkillCount} Skill entrypoints pass Agent Skills validation.`
        : "No Agent Skills validation failures were provided.",
    };
  }
  return {
    id: "specification.agent_skills",
    title: "Agent Skills specification",
    status: "fail",
    severity: "error",
    summary: `${invalid.length} Skill entrypoint${invalid.length === 1 ? "" : "s"} fail Agent Skills validation.`,
    evidence: invalid.map((result) => ({
      path: result.path,
      message: `${result.errorCount} specification error${result.errorCount === 1 ? "" : "s"}.`,
    })),
  };
}

function blockingSecurityCheck(findings: Finding[]): ReadinessCheck {
  const blocking = findings.filter(
    (finding) =>
      finding.category === "safety" &&
      (finding.severity === "high" || finding.severity === "critical"),
  );
  if (blocking.length === 0) {
    return {
      id: "security.blocking",
      title: "Blocking security findings",
      status: "pass",
      severity: "info",
      summary: "No high or critical security findings were reported.",
    };
  }
  return {
    id: "security.blocking",
    title: "Blocking security findings",
    status: "fail",
    severity: "error",
    summary: `${blocking.length} high or critical security finding${blocking.length === 1 ? "" : "s"} require review.`,
    evidence: blocking.map((finding) => ({
      id: finding.id,
      path: finding.evidence.path,
      message: finding.remediation,
    })),
  };
}

export function formatReadinessJson(report: ReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function workflowReadinessSummaryLine(report: ReadinessReport): string {
  const workflow = report.summary.workflow;
  return `- Workflow readiness: ${workflow.readinessPercent}% (${workflow.pass}/${workflow.checks} workflow checks passing)`;
}

function graphResolutionSummaryLine(report: ReadinessReport): string {
  return `- Graph resolution: ${report.summary.graphResolutionPercent}% (${report.summary.resolvedEdges}/${report.summary.edgeCount} edges resolved)`;
}

function ownershipSummaryLine(report: ReadinessReport): string {
  return `- Ownership coverage: ${report.summary.ownershipCoveragePercent}% (${report.summary.ownedAssets}/${report.summary.totalAssets} assets owned)`;
}

function contextLensSummaryLine(report: ReadinessReport): string {
  const lens = report.summary.contextLens;
  return `- Context Lens: ${lens.detected ? "detected" : "not detected"} (${lens.validLensCount}/${lens.totalLensCount} valid, ${lens.diagnosticCounts.error} errors, ${lens.diagnosticCounts.warning} warnings)`;
}

export function formatReadinessMarkdown(report: ReadinessReport): string {
  const lines = [
    "# Agent Readiness",
    "",
    `- Root: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- Level: ${report.level}`,
    `- Score: ${report.score}`,
    workflowReadinessSummaryLine(report),
    graphResolutionSummaryLine(report),
    ownershipSummaryLine(report),
    contextLensSummaryLine(report),
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
    "## Context Lens",
    "",
    ...formatContextLensMarkdown(report.summary.contextLens),
    "",
    "## Security Posture",
    "",
    ...formatSecurityPostureMarkdown(report.summary.securityPosture),
    "",
    "## Security Policy Inventory",
    "",
    ...formatSecurityPolicyInventoryMarkdown(
      report.summary.securityPolicyInventory,
    ),
    "",
    "## Workflow Readiness",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Skill entrypoints | ${report.summary.workflow.skillEntrypoints} |`,
    `| Workflow checks | ${report.summary.workflow.checks} |`,
    `| Passed workflow checks | ${report.summary.workflow.pass} |`,
    `| Warning workflow checks | ${report.summary.workflow.warn} |`,
    `| Failing workflow checks | ${report.summary.workflow.fail} |`,
    `| Workflow readiness | ${report.summary.workflow.readinessPercent}% |`,
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
    const displayedFindings = selectMarkdownFindings(report.findings);
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

function formatContextLensMarkdown(contextLens: ContextLensSummary): string[] {
  return [
    "| Metric | Value |",
    "| --- | ---: |",
    `| Enabled | ${contextLens.enabled ? "yes" : "no"} |`,
    `| Detected | ${contextLens.detected ? "yes" : "no"} |`,
    `| Total lenses | ${contextLens.totalLensCount} |`,
    `| Valid lenses | ${contextLens.validLensCount} |`,
    `| Invalid lenses | ${contextLens.invalidLensCount} |`,
    `| Diagnostic errors | ${contextLens.diagnosticCounts.error} |`,
    `| Diagnostic warnings | ${contextLens.diagnosticCounts.warning} |`,
    `| Diagnostic info | ${contextLens.diagnosticCounts.info} |`,
    `| Representative diagnostic | ${contextLens.representativeDiagnosticCode ?? "(none)"} |`,
    "",
    `- Definition paths: ${list(contextLens.definitionPaths)}`,
    `- Target references: ${list(contextLens.targetReferences)}`,
  ];
}

function formatSecurityPostureMarkdown(
  securityPosture: SecurityPostureSummary,
): string[] {
  const lines = [
    "| Metric | Value |",
    "| --- | ---: |",
    `| Security findings | ${securityPosture.totalSecurityFindings} |`,
    `| Violations | ${securityPosture.riskClasses.violation} |`,
    `| Suspicious | ${securityPosture.riskClasses.suspicious} |`,
    `| Advisory | ${securityPosture.riskClasses.advisory} |`,
    `| Unclassified security findings | ${securityPosture.riskClasses.unclassified} |`,
    `| High/critical security findings | ${securityPosture.highOrCritical} |`,
  ];

  if (securityPosture.topFindingIds.length > 0) {
    lines.push(
      "",
      "### Top security findings",
      "",
      ...securityPosture.topFindingIds.map(
        (finding) =>
          `- ${finding.id}: ${finding.count} [${finding.riskClass ?? "unclassified"}, ${finding.maxSeverity}]`,
      ),
    );
  }

  return lines;
}

function formatSecurityPolicyInventoryMarkdown(
  inventory: SecurityPolicyInventorySummary,
): string[] {
  const lines = [
    "| Metric | Value |",
    "| --- | ---: |",
    `| Policy assets | ${inventory.totalPolicyAssets} |`,
    `| Assets with local policy metadata | ${inventory.assetsWithLocalPolicyMetadata} |`,
    `| Assets with inherited policy | ${inventory.assetsWithInheritedPolicy} |`,
    `| Assets with effective policy | ${inventory.assetsWithEffectivePolicy} |`,
    `| Assets without effective policy | ${inventory.assetsWithoutEffectivePolicy} |`,
    `| Effective policy from local metadata | ${inventory.policySources.local} |`,
    `| Effective policy from security profiles | ${inventory.policySources.security_profile} |`,
    `| Effective policy from repository config | ${inventory.policySources.repository_config} |`,
    `| Effective policy from owning Skills | ${inventory.policySources.owning_skill} |`,
    `| Network allowed | ${inventory.networkAllowed.true} |`,
    `| Network denied | ${inventory.networkAllowed.false} |`,
    `| Network unspecified | ${inventory.networkAllowed.unspecified} |`,
    `| Upload allowed | ${inventory.externalUploadAllowed.true} |`,
    `| Upload denied | ${inventory.externalUploadAllowed.false} |`,
    `| Upload unspecified | ${inventory.externalUploadAllowed.unspecified} |`,
    `| Secrets allowed | ${inventory.secretsAllowed.true} |`,
    `| Secrets denied | ${inventory.secretsAllowed.false} |`,
    `| Secrets unspecified | ${inventory.secretsAllowed.unspecified} |`,
    `| Human approval required | ${inventory.humanApprovalRequired.true} |`,
    `| Approved network destinations | ${inventory.approvedNetworkDestinationCount} |`,
    `| Approved upload destinations | ${inventory.approvedUploadDestinationCount} |`,
    `| Forbidden inputs | ${inventory.forbiddenInputCount} |`,
    `| Referenced security profiles | ${inventory.securityProfiles.referenced} |`,
    `| Missing security profiles | ${inventory.securityProfiles.missing} |`,
    `| Cyclic security profiles | ${inventory.securityProfiles.cyclic} |`,
  ];

  if (inventory.topApprovedNetworkDestinations.length > 0) {
    lines.push(
      "",
      "### Top approved network destinations",
      "",
      ...inventory.topApprovedNetworkDestinations.map(
        (item) => `- ${item.destination}: ${item.count}`,
      ),
    );
  }

  if (inventory.topApprovedUploadDestinations.length > 0) {
    lines.push(
      "",
      "### Top approved upload destinations",
      "",
      ...inventory.topApprovedUploadDestinations.map(
        (item) => `- ${item.destination}: ${item.count}`,
      ),
    );
  }

  if (inventory.topForbiddenInputs.length > 0) {
    lines.push(
      "",
      "### Top forbidden inputs",
      "",
      ...inventory.topForbiddenInputs.map(
        (item) => `- ${item.input}: ${item.count}`,
      ),
    );
  }

  return lines;
}

export function formatReadiness(
  report: ReadinessReport,
  format: ReadinessFormat,
): string {
  return format === "json"
    ? formatReadinessJson(report)
    : formatReadinessMarkdown(report);
}

function selectMarkdownFindings(findings: Finding[]): Finding[] {
  if (findings.length <= MARKDOWN_FINDINGS_LIMIT) return findings;

  const selected: Finding[] = [];
  const selectedKeys = new Set<string>();
  const repeatedBuckets = new Map<string, Finding[]>();

  for (const finding of findings) {
    if (!finding.id.startsWith("MAINT-REPEATED-")) continue;
    const bucket = repeatedBuckets.get(finding.id) ?? [];
    bucket.push(finding);
    repeatedBuckets.set(finding.id, bucket);
  }

  while (
    selected.length < MARKDOWN_FINDINGS_LIMIT &&
    [...repeatedBuckets.values()].some((bucket) => bucket.length > 0)
  ) {
    for (const id of [...repeatedBuckets.keys()].sort()) {
      const bucket = repeatedBuckets.get(id);
      const finding = bucket?.shift();
      if (!finding) continue;

      selected.push(finding);
      selectedKeys.add(findingKey(finding));
      if (selected.length >= MARKDOWN_FINDINGS_LIMIT) break;
    }
  }

  for (const finding of findings) {
    if (selected.length >= MARKDOWN_FINDINGS_LIMIT) break;
    const key = findingKey(finding);
    if (selectedKeys.has(key)) continue;

    selected.push(finding);
    selectedKeys.add(key);
  }

  return selected;
}

function findingKey(finding: Finding): string {
  return `${finding.id}:${finding.evidence.path}:${finding.evidence.startLine}:${finding.evidence.endLine}`;
}

function formatMarkdownFinding(finding: Finding): string {
  const { path, startLine, endLine } = finding.evidence;
  const location =
    startLine === endLine
      ? `${path}:${startLine}`
      : `${path}:${startLine}-${endLine}`;
  const risk = finding.riskClass ? ` [${finding.riskClass}]` : "";
  return `${finding.id} [${finding.severity}/${finding.category}]${risk} ${location}`;
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
          : "All cataloged assets have an effective owner.",
    };
  }

  return {
    id: "ownership.coverage",
    title: "Ownership coverage",
    status: "warn",
    severity: "warning",
    summary: `${unownedAssets} of ${totalAssets} cataloged assets do not have an effective owner.`,
    evidence: nodes
      .filter((node) => !hasOwner(node.ownership.effectiveOwner ?? undefined))
      .map((node) => ({
        id: node.id,
        path: node.sourcePath,
        message: "Missing effective owner.",
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
      ? resolveWorkflowContextTarget(edge, nodesById, nodesByPath)
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

function workflowOptionalContextCheck(
  graphReport: GraphReport,
): ReadinessCheck {
  const nodesById = new Map(graphReport.nodes.map((node) => [node.id, node]));
  const optionalEdges = graphReport.edges.filter(
    (edge) =>
      edge.kind === "optional" && nodesById.get(edge.from)?.kind === "skill",
  );

  if (optionalEdges.length === 0) {
    return {
      id: "workflow.optional_context",
      title: "Workflow optional context",
      status: "pass",
      severity: "info",
      summary: "No optional workflow context references were declared.",
    };
  }

  const nodesByPath = new Map(
    graphReport.nodes.map((node) => [
      normalizeGraphPath(node.sourcePath),
      node,
    ]),
  );
  const problems = optionalEdges.flatMap((edge) => {
    const target = edge.resolved
      ? resolveWorkflowContextTarget(edge, nodesById, nodesByPath)
      : undefined;
    if (target === undefined) {
      return [
        {
          id: edge.from,
          path: edge.sourcePath,
          message: `Optional context reference "${edge.to}" does not resolve.`,
        },
      ];
    }
    if (target.status === "deprecated" || target.status === "archived") {
      return [
        {
          id: edge.from,
          path: edge.sourcePath,
          message: `Optional context "${edge.to}" resolves to ${target.status} asset ${target.sourcePath}.`,
        },
      ];
    }
    return [];
  });

  if (problems.length === 0) {
    return {
      id: "workflow.optional_context",
      title: "Workflow optional context",
      status: "pass",
      severity: "info",
      summary: "All declared optional workflow context references are usable.",
    };
  }

  return {
    id: "workflow.optional_context",
    title: "Workflow optional context",
    status: "warn",
    severity: "warning",
    summary: `${problems.length} optional workflow context reference(s) need attention.`,
    evidence: problems,
  };
}

function resolveWorkflowContextTarget(
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

function contextLensGovernanceCheck(
  contextLens: ContextLensSummary,
  diagnostics: Diagnostic[],
): ReadinessCheck {
  const lensDiagnostics = diagnostics.filter((diagnostic) =>
    diagnostic.code?.startsWith("CONTEXT-LENS-"),
  );
  const evidence = lensDiagnostics.map((diagnostic) => ({
    ...(diagnostic.code ? { id: diagnostic.code } : {}),
    ...(diagnostic.path ? { path: diagnostic.path } : {}),
    message: diagnostic.message,
  }));

  if (contextLens.diagnosticCounts.error > 0) {
    return {
      id: "context_lens.governance",
      title: "Context Lens governance",
      status: "fail",
      severity: "error",
      summary: `${contextLens.invalidLensCount} of ${contextLens.totalLensCount} context lens definition${
        contextLens.totalLensCount === 1 ? "" : "s"
      } have blocking diagnostics.`,
      evidence,
    };
  }

  if (contextLens.diagnosticCounts.warning > 0) {
    return {
      id: "context_lens.governance",
      title: "Context Lens governance",
      status: "warn",
      severity: "warning",
      summary: `${contextLens.diagnosticCounts.warning} context lens warning${
        contextLens.diagnosticCounts.warning === 1 ? "" : "s"
      } reported.`,
      evidence,
    };
  }

  if (!contextLens.detected) {
    return {
      id: "context_lens.governance",
      title: "Context Lens governance",
      status: "pass",
      severity: "info",
      summary: "No context lens definitions were detected.",
    };
  }

  return {
    id: "context_lens.governance",
    title: "Context Lens governance",
    status: "pass",
    severity: "info",
    summary: `${contextLens.validLensCount} context lens definition${
      contextLens.validLensCount === 1 ? "" : "s"
    } passed deterministic governance checks.`,
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
    status: "pass",
    severity: "info",
    summary: `${nodes.length} intentionally retained deprecated or archived asset${
      nodes.length === 1 ? "" : "s"
    } cataloged; inactive assets do not reduce Readiness merely by existing.`,
    evidence: nodes.map((node) => ({
      id: node.id,
      path: node.sourcePath,
      message: `Asset status is ${node.status}.`,
    })),
  };
}

function freshnessCheck(findings: Finding[]): ReadinessCheck {
  const freshnessFindingIds: string[] = [
    DIAGNOSTIC_IDS.MAINT_ASSET_EXPIRED,
    DIAGNOSTIC_IDS.MAINT_ASSET_REVIEW_OVERDUE,
    DIAGNOSTIC_IDS.META_INVALID_LAST_REVIEWED_AT,
    DIAGNOSTIC_IDS.META_INVALID_EXPIRES_AT,
    DIAGNOSTIC_IDS.META_INVALID_REVIEW_CYCLE,
  ];
  const matched = findings.filter((finding) =>
    freshnessFindingIds.includes(finding.id),
  );

  if (matched.length === 0) {
    return {
      id: "assets.freshness",
      title: "Asset freshness",
      status: "pass",
      severity: "info",
      summary: "No expired, overdue, or invalid freshness metadata was found.",
    };
  }

  return {
    id: "assets.freshness",
    title: "Asset freshness",
    status: "warn",
    severity: "warning",
    summary: `${matched.length} freshness finding${
      matched.length === 1 ? "" : "s"
    } matched cataloged assets.`,
    evidence: matched.map((finding) => ({
      id: finding.id,
      path: finding.evidence.path,
      message: finding.remediation,
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
    if (check.status === "fail")
      return penalty + QUALITY.readiness.layoutFailurePenalty;
    if (check.status === "warn")
      return penalty + QUALITY.readiness.layoutWarningPenalty;
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
  if (score >= QUALITY.readiness.readyMinimumScore && !hasFailingCheck)
    return "ready";
  if (score < QUALITY.readiness.needsAttentionMinimumScore || hasFailingCheck)
    return "not_ready";
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
  return (
    classifyRepositorySkillEntrypointPath(normalizeGraphPath(path))?.kind ===
    "canonical"
  );
}

function normalizeGraphPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}
