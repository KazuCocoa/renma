import {
  executeDiff,
  type DiffCollectionInstrumentation,
  type DiffReport,
  type DiffReportWithoutSkillDiscovery,
  type DiffFormat,
} from "./diff.js";
import {
  summarizeSecurityPosture,
  type SecurityPostureSummary,
} from "../security-posture.js";
import {
  buildSecurityDiffSummary,
  type SecurityDiffSummary,
} from "../security-diff.js";
import {
  zeroSecurityPolicyInventorySummary,
  type SecurityPolicyInventorySummary,
} from "../security-policy-inventory.js";
import type { ConfigOverrides } from "../config.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import type {
  SkillDiscoveryCycleDiff,
  SkillDiscoveryDiff,
  SkillDiscoveryDiffSkill,
  SkillDiscoveryRouteChange,
  SkillDiscoveryRouteDiffState,
} from "../skill-discovery-diff.js";
import {
  evaluateSkillDiscoveryCiPolicy,
  type SkillDiscoveryCiPolicyConfiguration,
  type SkillDiscoveryCiPolicyEvaluation,
  type SkillDiscoveryCiPolicyMatch,
} from "../skill-discovery-ci-policy.js";

export type CiReportFormat = DiffFormat;
export type CiReportStatus = "pass" | "warn" | "fail";
export type CiCompatibleDiffReport = DiffReportWithoutSkillDiscovery;

export interface CiReport {
  root: string;
  from: DiffReport["from"];
  to: DiffReport["to"];
  status: CiReportStatus;
  summary: DiffReport["summary"];
  skillDiscovery: SkillDiscoveryDiff;
  skillDiscoveryPolicy: SkillDiscoveryCiPolicyEvaluation;
  securityPosture: {
    added: SecurityPostureSummary;
    resolved: SecurityPostureSummary;
  };
  notes: string[];
  diff: CiCompatibleDiffReport;
}

export type CiReportFormatInput =
  | CiReport
  | Omit<CiReport, "skillDiscoveryPolicy">
  | Omit<CiReport, "skillDiscovery" | "skillDiscoveryPolicy">;

interface CiReportOptions {
  fromRef: string;
  toRef: string;
  overrides?: ConfigOverrides;
  instrumentation?: DiffCollectionInstrumentation;
}

const MAX_LIST_ITEMS = DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

interface ReportFinding {
  id: string;
  severity: string;
  riskClass?: string | undefined;
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
  const execution = await executeDiff(targetPath, options);
  return buildCiReportFromDiff(
    execution.report,
    execution.skillDiscoveryCiPolicy,
  );
}

export function buildCiReportFromDiff(
  report: DiffReport,
  configuredPolicy: SkillDiscoveryCiPolicyConfiguration = {
    from: "off",
    to: "off",
  },
): CiReport {
  const { discovery, ...ciCompatibleDiff } = report;
  const existingStatus = determineCiReportStatus(ciCompatibleDiff);
  const skillDiscoveryPolicy = evaluateSkillDiscoveryCiPolicy(
    discovery,
    configuredPolicy,
  );
  const status = composeCiReportStatus(
    existingStatus,
    skillDiscoveryPolicy.outcome,
  );
  const securityPosture = {
    added: summarizeSecurityPosture(ciCompatibleDiff.findings.added),
    resolved: summarizeSecurityPosture(ciCompatibleDiff.findings.removed),
  };

  return {
    root: ciCompatibleDiff.root,
    from: ciCompatibleDiff.from,
    to: ciCompatibleDiff.to,
    status,
    summary: ciCompatibleDiff.summary,
    skillDiscovery: discovery,
    skillDiscoveryPolicy,
    securityPosture,
    notes: reviewNotes(
      ciCompatibleDiff,
      status,
      securityPosture.added,
      skillDiscoveryPolicy,
    ),
    diff: ciCompatibleDiff,
  };
}

export function formatCiReport(
  report: CiReportFormatInput,
  format: CiReportFormat,
): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  return formatCiReportMarkdown(report);
}

export function determineCiReportStatus(
  report: CiCompatibleDiffReport,
): CiReportStatus {
  if (
    hasNewHighOrCriticalFinding(report) ||
    hasNewUnresolvedRequiredEdge(report) ||
    hasBlockingContextLensDiagnostics(report)
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

export function composeCiReportStatus(
  existingStatus: CiReportStatus,
  discoveryPolicyOutcome: SkillDiscoveryCiPolicyEvaluation["outcome"],
): CiReportStatus {
  if (existingStatus === "fail") return "fail";
  if (existingStatus === "warn" || discoveryPolicyOutcome === "warn")
    return "warn";
  return "pass";
}

function hasNewHighOrCriticalFinding(report: CiCompatibleDiffReport): boolean {
  return report.findings.added.some(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  );
}

function hasNewUnresolvedRequiredEdge(report: CiCompatibleDiffReport): boolean {
  return report.graph.newUnresolvedEdges.some(isRequiredEdge);
}

function hasBlockingContextLensDiagnostics(
  report: CiCompatibleDiffReport,
): boolean {
  return (report.to.contextLens?.diagnosticCounts.error ?? 0) > 0;
}

function newUnresolvedRequiredEdgeCount(
  report: CiCompatibleDiffReport,
): number {
  return report.graph.newUnresolvedEdges.filter(isRequiredEdge).length;
}

function isRequiredEdge(edge: { kind: string }): boolean {
  return edge.kind === "required" || edge.kind === "requires";
}

function reviewNotes(
  report: CiCompatibleDiffReport,
  status: CiReportStatus,
  addedSecurityPosture: SecurityPostureSummary,
  skillDiscoveryPolicy: SkillDiscoveryCiPolicyEvaluation,
): string[] {
  const notes: string[] = [];

  if (hasNewUnresolvedRequiredEdge(report)) {
    notes.push("Review new unresolved required edges before merge.");
  }
  if (hasNewHighOrCriticalFinding(report)) {
    notes.push("Review new high or critical findings before merge.");
  }
  if (hasBlockingContextLensDiagnostics(report)) {
    notes.push("Review blocking Context Lens diagnostics before merge.");
  }
  if (addedSecurityPosture.riskClasses.violation > 0) {
    notes.push("Review new security violations before merge.");
  }
  if (addedSecurityPosture.riskClasses.suspicious > 0) {
    notes.push("Review new suspicious security findings before merge.");
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
  if (skillDiscoveryPolicy.outcome === "warn") {
    const suffix = skillDiscoveryPolicy.matchCount === 1 ? "change" : "changes";
    notes.push(
      `Skill Discovery CI review policy matched ${skillDiscoveryPolicy.matchCount} ${suffix}.`,
    );
  }
  if (status === "pass" && notes.length === 0) {
    notes.push("No CI report regressions detected.");
  }

  return notes;
}

function formatCiReportMarkdown(report: CiReportFormatInput): string {
  const skillDiscoveryLines =
    "skillDiscovery" in report
      ? [
          "",
          ...formatSkillDiscoverySection(
            report.skillDiscovery,
            "skillDiscoveryPolicy" in report
              ? report.skillDiscoveryPolicy
              : undefined,
          ),
        ]
      : [];
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
    ...skillDiscoveryLines,
    "",
    "## Security Posture",
    "",
    ...formatSecurityPostureSection(report.securityPosture),
    "",
    "## Security Changes",
    "",
    ...formatSecurityChangesSection(report.diff.security),
    "",
    "## Security Policy Inventory",
    "",
    ...formatSecurityPolicyInventorySection(report.to.securityPolicyInventory),
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

function formatSkillDiscoverySection(
  discovery: SkillDiscoveryDiff,
  policy?: SkillDiscoveryCiPolicyEvaluation,
): string[] {
  const lines = [
    "## Skill Discovery Changes",
    "",
    `- Schema: ${discovery.schemaVersion}`,
  ];
  lines.push(
    ...(policy
      ? formatSkillDiscoveryPolicySummary(policy)
      : ["- CI policy effect: none (observation only)"]),
  );

  if (!hasSkillDiscoveryChanges(discovery)) {
    lines.push("- No Skill Discovery topology changes.");
  } else {
    lines.push(
      `- Adoption: ${discovery.adoption.from} -> ${discovery.adoption.to}`,
      `- Coverage: ${discovery.coverage.from} -> ${discovery.coverage.to}`,
      `- Published entrypoints: +${discovery.publishedEntrypoints.added.length} / -${discovery.publishedEntrypoints.removed.length}`,
      `- Reachability: +${discovery.reachability.newlyReachable.length} reachable / +${discovery.reachability.newlyNotReached.length} not-reached`,
      `- Unrouted Skills: +${discovery.unroutedSkills.newlyUnrouted.length} / -${discovery.unroutedSkills.resolvedUnrouted.length}`,
      `- Routes: +${discovery.routes.added.length} / -${discovery.routes.removed.length} / ${discovery.routes.changed.length} changed`,
      `- Cyclic components: +${discovery.cycles.added.length} / -${discovery.cycles.resolved.length}`,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Added published entrypoints",
      discovery.publishedEntrypoints.added,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Removed published entrypoints",
      discovery.publishedEntrypoints.removed,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Newly reachable Skills",
      discovery.reachability.newlyReachable,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Newly not-reached Skills",
      discovery.reachability.newlyNotReached,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Newly unrouted Skills",
      discovery.unroutedSkills.newlyUnrouted,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Resolved unrouted Skills",
      discovery.unroutedSkills.resolvedUnrouted,
      formatDiscoverySkill,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Added routes",
      discovery.routes.added,
      formatDiscoveryRoute,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Removed routes",
      discovery.routes.removed,
      formatDiscoveryRoute,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Changed routes",
      discovery.routes.changed,
      formatDiscoveryRouteChange,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Added cyclic components",
      discovery.cycles.added,
      formatDiscoveryCycle,
    );
    appendSkillDiscoveryDetails(
      lines,
      "Resolved cyclic components",
      discovery.cycles.resolved,
      formatDiscoveryCycle,
    );
  }

  if (policy?.outcome === "warn") {
    appendSkillDiscoveryDetails(
      lines,
      "CI review policy matches",
      policy.matches,
      formatSkillDiscoveryPolicyMatch,
    );
  }
  return lines;
}

function formatSkillDiscoveryPolicySummary(
  policy: SkillDiscoveryCiPolicyEvaluation,
): string[] {
  const { from, to, effective } = policy.configured;
  const configured =
    from === to
      ? [`- CI review policy: ${from}`]
      : [
          `- CI review policy: ${from} -> ${to}`,
          `- Effective CI review policy: ${effective}`,
        ];
  if (effective === "off") {
    return [...configured, "- Policy outcome: PASS — policy disabled"];
  }
  if (policy.outcome === "pass") {
    return [
      ...configured,
      "- Policy outcome: PASS — no configured review conditions matched",
    ];
  }
  return [
    ...configured,
    "- Policy outcome: WARN — review requested; exit behavior unchanged",
  ];
}

function formatSkillDiscoveryPolicyMatch(
  match: SkillDiscoveryCiPolicyMatch,
): string {
  if (match.skill) {
    return `${match.id}: ${match.skill.id} (\`${match.skill.path}\`)`;
  }
  if (match.route) {
    return `${match.id}: \`${match.route.sourcePath}\` -> \`${match.route.normalizedTarget}\``;
  }
  if (match.fromState !== undefined && match.toState !== undefined) {
    return `${match.id}: ${match.fromState} -> ${match.toState}`;
  }
  return `${match.id}: ${match.summary}`;
}

function hasSkillDiscoveryChanges(discovery: SkillDiscoveryDiff): boolean {
  return (
    discovery.adoption.changed ||
    discovery.coverage.changed ||
    Object.values(discovery.summary).some((value) => value !== 0) ||
    discovery.publishedEntrypoints.added.length > 0 ||
    discovery.publishedEntrypoints.removed.length > 0 ||
    discovery.reachability.newlyReachable.length > 0 ||
    discovery.reachability.newlyNotReached.length > 0 ||
    discovery.unroutedSkills.newlyUnrouted.length > 0 ||
    discovery.unroutedSkills.resolvedUnrouted.length > 0 ||
    discovery.routes.added.length > 0 ||
    discovery.routes.removed.length > 0 ||
    discovery.routes.changed.length > 0 ||
    discovery.cycles.added.length > 0 ||
    discovery.cycles.resolved.length > 0
  );
}

function appendSkillDiscoveryDetails<T>(
  lines: string[],
  heading: string,
  items: readonly T[],
  render: (item: T) => string,
): void {
  if (items.length === 0) return;
  lines.push("", `### ${heading}`, "");
  lines.push(
    ...items.slice(0, MAX_LIST_ITEMS).map((item) => `- ${render(item)}`),
    ...formatOverflow(items.length),
  );
}

function formatDiscoverySkill(skill: SkillDiscoveryDiffSkill): string {
  return `${skill.id} (\`${skill.path}\`)`;
}

function formatDiscoveryRoute(route: SkillDiscoveryRouteDiffState): string {
  const declarationLabel =
    route.declarationCount === 1 ? "declaration" : "declarations";
  return `\`${route.sourcePath}\` -> \`${route.normalizedTarget}\` (${route.resolution}, ${route.usable ? "usable" : "unusable"}, ${route.declarationCount} ${declarationLabel})`;
}

function formatDiscoveryRouteChange(change: SkillDiscoveryRouteChange): string {
  return `\`${change.identity.sourcePath}\` -> \`${change.identity.normalizedTarget}\`: ${change.changedFields.join(", ")}`;
}

function formatDiscoveryCycle(cycle: SkillDiscoveryCycleDiff): string {
  return `${cycle.skillIds.join(", ")}${cycle.selfLoop ? " (self-loop)" : ""}`;
}

function formatSecurityChangesSection(
  security: CiReport["diff"]["security"] | undefined,
): string[] {
  const { posture, policyInventory } = security ?? emptySecurityDiff();
  return [
    `- Added security findings: ${posture.added.totalSecurityFindings}`,
    `- Resolved security findings: ${posture.resolved.totalSecurityFindings}`,
    `- Added violations: ${posture.added.riskClasses.violation}`,
    `- Added suspicious: ${posture.added.riskClasses.suspicious}`,
    `- Added advisory: ${posture.added.riskClasses.advisory}`,
    `- Policy assets: ${formatDelta(policyInventory.totalPolicyAssets)}`,
    `- Assets with local policy metadata: ${formatDelta(policyInventory.assetsWithLocalPolicyMetadata)}`,
    `- Assets with inherited policy: ${formatDelta(policyInventory.assetsWithInheritedPolicy)}`,
    `- Assets with effective policy: ${formatDelta(policyInventory.assetsWithEffectivePolicy)}`,
    `- Assets without effective policy: ${formatDelta(policyInventory.assetsWithoutEffectivePolicy)}`,
    `- Effective policy from local metadata: ${formatDelta(policyInventory.policySources.local)}`,
    `- Effective policy from security profiles: ${formatDelta(policyInventory.policySources.security_profile)}`,
    `- Effective policy from repository config: ${formatDelta(policyInventory.policySources.repository_config)}`,
    `- Effective policy from owning Skills: ${formatDelta(policyInventory.policySources.owning_skill)}`,
    `- Missing security profiles: ${formatDelta(policyInventory.securityProfiles.missing)}`,
  ];
}

function emptySecurityDiff(): SecurityDiffSummary {
  return buildSecurityDiffSummary({
    addedFindings: [],
    removedFindings: [],
  });
}

function formatSecurityPostureSection(report: CiReport["securityPosture"]) {
  const { added, resolved } = report;
  if (
    added.totalSecurityFindings === 0 &&
    resolved.totalSecurityFindings === 0
  ) {
    return ["- No added or resolved security findings."];
  }

  return [
    `- Added security findings: ${added.totalSecurityFindings}`,
    `- Added violations: ${added.riskClasses.violation}`,
    `- Added suspicious: ${added.riskClasses.suspicious}`,
    `- Added advisory: ${added.riskClasses.advisory}`,
    `- Added high/critical security findings: ${added.highOrCritical}`,
    `- Resolved security findings: ${resolved.totalSecurityFindings}`,
    `- Resolved violations: ${resolved.riskClasses.violation}`,
    `- Resolved suspicious: ${resolved.riskClasses.suspicious}`,
    `- Resolved advisory: ${resolved.riskClasses.advisory}`,
  ];
}

function formatSecurityPolicyInventorySection(
  inventory: SecurityPolicyInventorySummary | undefined,
): string[] {
  const target = inventory ?? zeroSecurityPolicyInventorySummary();
  return [
    `- Target assets with local policy metadata: ${target.assetsWithLocalPolicyMetadata}`,
    `- Target assets with inherited policy: ${target.assetsWithInheritedPolicy}`,
    `- Target assets with effective policy: ${target.assetsWithEffectivePolicy}`,
    `- Target assets without effective policy: ${target.assetsWithoutEffectivePolicy}`,
    `- Target effective policy from local metadata: ${target.policySources.local}`,
    `- Target effective policy from security profiles: ${target.policySources.security_profile}`,
    `- Target effective policy from repository config: ${target.policySources.repository_config}`,
    `- Target effective policy from owning Skills: ${target.policySources.owning_skill}`,
    `- Target referenced security profiles: ${target.securityProfiles.referenced}`,
    `- Target missing security profiles: ${target.securityProfiles.missing}`,
    `- Target approved network destinations: ${target.approvedNetworkDestinationCount}`,
    `- Target approved upload destinations: ${target.approvedUploadDestinationCount}`,
  ];
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
  const risk = finding.riskClass ? ` [${finding.riskClass}]` : "";
  return `- ${finding.severity.toUpperCase()}${risk} \`${finding.id}\` \`${location}\` — ${finding.title}`;
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
      return "FAIL — blocking repository-governance regression detected";
  }
}
