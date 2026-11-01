import { compareUtf16CodeUnits } from "../canonical-json.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import { formatVersionedJsonDocument } from "../report.js";
import {
  READINESS_JSON_SCHEMA_VERSION,
  type ReadinessReport,
} from "../readiness-report.js";
import type { ContextLensSummary } from "../context-lens.js";
import type { SecurityPostureSummary } from "../security-posture.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { Finding } from "../types/diagnostics.js";

const MARKDOWN_FINDINGS_LIMIT =
  DEFAULT_QUALITY_PROFILE.presentation.markdownReadinessFindingCap;
const DISCOVERY_EVIDENCE_LIMIT =
  DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

export function formatReadinessJson(report: ReadinessReport): string {
  return formatVersionedJsonDocument(READINESS_JSON_SCHEMA_VERSION, report);
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

type ReadinessDisplayStatus =
  "Ready" | "Ready with advisories" | "Needs attention" | "Not ready";

function hasReadinessAdvisories(report: ReadinessReport): boolean {
  return (
    report.checks.some((check) => check.status === "warn") ||
    report.diagnostics?.some(
      (diagnostic) => diagnostic.severity === "warning",
    ) === true ||
    (report.findings?.length ?? 0) > 0
  );
}

function readinessDisplayStatus(
  report: ReadinessReport,
): ReadinessDisplayStatus {
  if (report.level === "needs_attention") return "Needs attention";
  if (report.level === "not_ready") return "Not ready";
  return hasReadinessAdvisories(report) ? "Ready with advisories" : "Ready";
}

export function formatReadinessMarkdown(report: ReadinessReport): string {
  const failingCheckCount = report.checks.filter(
    (check) => check.status === "fail",
  ).length;
  const warningCheckCount = report.checks.filter(
    (check) => check.status === "warn",
  ).length;
  const findingCount = report.findings?.length ?? 0;
  const lines = [
    "# Agent Readiness",
    "",
    `- Root: ${report.root}`,
    ...(report.configPath ? [`- Config: ${report.configPath}`] : []),
    `- Status: ${readinessDisplayStatus(report)}`,
    `- Level: ${report.level}`,
    `- Score: ${report.score}`,
    `- Failing checks: ${failingCheckCount}`,
    `- Warning checks: ${warningCheckCount}`,
    `- Findings: ${findingCount}${
      report.level === "ready" && findingCount > 0
        ? " (non-blocking for Readiness)"
        : ""
    }`,
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
    "## Skill Discovery",
    "",
    ...formatSkillDiscoveryReadinessMarkdown(report),
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
    const readyFindings = report.level === "ready";
    lines.push(
      "",
      readyFindings ? "## Non-blocking Findings" : "## Findings",
      "",
    );
    if (readyFindings) {
      lines.push(
        "These findings remain actionable, but they do not currently make this repository Not Ready.",
        "",
      );
    }
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

function formatSkillDiscoveryReadinessMarkdown(
  report: ReadinessReport,
): string[] {
  const discovery = report.summary.skillDiscovery;
  const lines = [
    `- Adoption: ${discovery.adoptionState}`,
    `- Published entrypoints: ${discovery.publishedEntrypointCount}`,
    `- Discovery-eligible Skills: ${discovery.routeEligibleSkillCount}`,
    `- Reachable Skills: ${discovery.reachableSkillCount}`,
    `- Not reached: ${discovery.notReachedSkillCount}`,
    `- Unrouted Skills: ${discovery.unroutedSkillCount}`,
    `- Usable routes: ${discovery.usableRouteCount}`,
    `- Unusable routes: ${discovery.unusableRouteCount}`,
    `- Unresolved routes: ${discovery.unresolvedRouteCount}`,
    `- Route cycles requiring review: ${discovery.cycleComponentCount}`,
  ];
  const affected = report.checks
    .filter(
      (check) =>
        check.id.startsWith("discovery.") &&
        check.status !== "pass" &&
        check.evidence &&
        check.evidence.length > 0,
    )
    .flatMap((check) =>
      check.evidence!.map((evidence) => ({
        checkId: check.id,
        id: evidence.id,
        path: evidence.path,
      })),
    );
  const compact = new Map<string, (typeof affected)[number]>();
  for (const item of affected) {
    const key = `${item.checkId}\0${item.id ?? ""}\0${item.path ?? ""}`;
    if (!compact.has(key)) compact.set(key, item);
  }
  if (compact.size > 0) {
    lines.push("", "### Discovery check evidence", "");
    for (const item of [...compact.values()].slice(
      0,
      DISCOVERY_EVIDENCE_LIMIT,
    )) {
      const identity = item.id ?? "(affected evidence)";
      lines.push(
        `- ${item.checkId}: ${identity}${item.path ? ` — ${item.path}` : ""}`,
      );
    }
  }
  lines.push(
    "",
    "Run `renma skill-index` for the complete Discovery report.",
    "Run `renma graph --view discovery` for route topology and source evidence.",
  );
  return lines;
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
    ...(inventory.externalUploadGovernance
      ? [
          `| Upload denied | ${inventory.externalUploadGovernance.denied} |`,
          `| Upload allowed; approval required | ${inventory.externalUploadGovernance.allowedApprovalRequired} |`,
          `| Upload allowed; approval not required | ${inventory.externalUploadGovernance.allowedNoApprovalRequired} |`,
          `| Upload allowed; approval requirement unspecified | ${inventory.externalUploadGovernance.allowedApprovalUnspecified} |`,
          `| Upload permission unspecified | ${inventory.externalUploadGovernance.unspecified} |`,
        ]
      : [
          `| Upload allowed | ${inventory.externalUploadAllowed.true} |`,
          `| Upload denied | ${inventory.externalUploadAllowed.false} |`,
          `| Upload unspecified | ${inventory.externalUploadAllowed.unspecified} |`,
        ]),
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
    for (const id of [...repeatedBuckets.keys()].sort(compareUtf16CodeUnits)) {
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

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}
