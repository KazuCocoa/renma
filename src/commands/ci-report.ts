import {
  executeDiff,
  formatSecurityChanges,
  type AssetChange,
  type AssetDelta,
  type DiffCollectionInstrumentation,
  type DiffEndpoint,
  type DiffReport,
  type DiffReportWithoutSkillDiscovery,
  type DiffFormat,
  type EdgeDelta,
} from "./diff.js";
import {
  summarizeSecurityPosture,
  type SecurityPostureSummary,
} from "../security-posture.js";
import {
  zeroSecurityPolicyInventorySummary,
  type SecurityPolicyInventorySummary,
} from "../security-policy-inventory.js";
import {
  buildExecutableSurfaceDiff,
  type ExecutableSurfaceDiff,
} from "../executable-surface-diff.js";
import { zeroExecutableSurfaceInventory } from "../executable-surface-inventory.js";
import type { ConfigOverrides } from "../config.js";
import { DEFAULT_QUALITY_PROFILE } from "../quality-profile.js";
import { formatJsonDocument } from "../report.js";
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
import {
  evaluateSecurityPolicyCiPolicy,
  type SecurityPolicyCiConfiguration,
  type SecurityPolicyCiEvaluation,
  type SecurityPolicyCiMatch,
} from "../security-policy-ci-policy.js";
import { formatMarkdownInlineCode } from "../renderers/markdown-inline-code.js";

export type CiReportFormat = DiffFormat;
export type CiReportStatus = "pass" | "warn" | "fail";
type CiCompatibleExecutableSurfaceDiff = Omit<
  ExecutableSurfaceDiff,
  | "newInvocationsWithMultipleEffectivePolicyFingerprints"
  | "addedDependencies"
  | "removedDependencies"
  | "dependencyResolutionChanges"
  | "newProblematicDependencies"
  | "newlyTransitivelyReachableSurfacePaths"
  | "surfacesLostStaticInvocationReachability"
  | "invocationDependencyDepthChanges"
> &
  Partial<
    Pick<
      ExecutableSurfaceDiff,
      | "newInvocationsWithMultipleEffectivePolicyFingerprints"
      | "addedDependencies"
      | "removedDependencies"
      | "dependencyResolutionChanges"
      | "newProblematicDependencies"
      | "newlyTransitivelyReachableSurfacePaths"
      | "surfacesLostStaticInvocationReachability"
      | "invocationDependencyDepthChanges"
    >
  >;
type CiFormatCompatibleDiffReport = Omit<
  DiffReportWithoutSkillDiscovery,
  "executableSurface"
> & {
  executableSurface: CiCompatibleExecutableSurfaceDiff;
};
export type CiCompatibleDiffReport = DiffReportWithoutSkillDiscovery;

export interface CiReport {
  root: string;
  from: DiffReport["from"];
  to: DiffReport["to"];
  status: CiReportStatus;
  summary: DiffReport["summary"];
  skillDiscovery: SkillDiscoveryDiff;
  skillDiscoveryPolicy: SkillDiscoveryCiPolicyEvaluation;
  securityPolicy: SecurityPolicyCiEvaluation;
  securityPosture: {
    added: SecurityPostureSummary;
    resolved: SecurityPostureSummary;
  };
  notes: string[];
  diff: CiCompatibleDiffReport;
}

export type CiReportFormatInput =
  | CiReport
  | (Omit<CiReport, "diff" | "skillDiscoveryPolicy" | "securityPolicy"> & {
      diff: CiFormatCompatibleDiffReport;
    })
  | (Omit<
      CiReport,
      "diff" | "skillDiscovery" | "skillDiscoveryPolicy" | "securityPolicy"
    > & {
      diff: CiFormatCompatibleDiffReport;
    });

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
    execution.securityPolicyCiPolicy,
  );
}

export function buildCiReportFromDiff(
  report: DiffReport,
  configuredPolicy: SkillDiscoveryCiPolicyConfiguration = {
    from: "off",
    to: "off",
  },
  configuredSecurityPolicy: SecurityPolicyCiConfiguration = {
    from: "fail",
    to: "fail",
  },
): CiReport {
  const { discovery, ...ciCompatibleDiff } = report;
  const existingStatus = determineCiReportStatus(ciCompatibleDiff);
  const skillDiscoveryPolicy = evaluateSkillDiscoveryCiPolicy(
    discovery,
    configuredPolicy,
  );
  const securityPolicy = evaluateSecurityPolicyCiPolicy(
    ciCompatibleDiff.security,
    configuredSecurityPolicy,
  );
  const status = composeCiReportStatus(
    existingStatus,
    skillDiscoveryPolicy.outcome,
    securityPolicy.outcome,
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
    securityPolicy,
    securityPosture,
    notes: reviewNotes(
      ciCompatibleDiff,
      status,
      securityPosture.added,
      skillDiscoveryPolicy,
      securityPolicy,
    ),
    diff: ciCompatibleDiff,
  };
}

export function formatCiReport(
  report: CiReportFormatInput,
  format: CiReportFormat,
): string {
  if (format === "json") return formatJsonDocument(report);
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
  securityPolicyOutcome: SecurityPolicyCiEvaluation["outcome"] = "pass",
): CiReportStatus {
  if (existingStatus === "fail" || securityPolicyOutcome === "fail")
    return "fail";
  if (
    existingStatus === "warn" ||
    discoveryPolicyOutcome === "warn" ||
    securityPolicyOutcome === "warn"
  )
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
  report: Pick<CiCompatibleDiffReport, "graph">,
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
  securityPolicy: SecurityPolicyCiEvaluation,
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
  if (report.summary.findingsDelta < 0 && securityPolicy.matchCount === 0) {
    notes.push("Scan findings decreased.");
  }
  if (securityPolicy.matchCount > 0) {
    const suffix =
      securityPolicy.matchCount === 1 ? "relaxation" : "relaxations";
    notes.push(
      `Security policy relaxation matched ${securityPolicy.matchCount} ${suffix}; explicit human security review is required.`,
    );
    if (report.summary.findingsDelta < 0) {
      notes.push(
        "Scan findings decreased alongside a declared security policy relaxation; this is not treated as verified remediation.",
      );
    }
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
  const executableSurface =
    report.diff.executableSurface ??
    buildExecutableSurfaceDiff(
      zeroExecutableSurfaceInventory(),
      zeroExecutableSurfaceInventory(),
    );
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
  const summaryLines = [
    `- Status: ${formatStatus(report.status)}`,
    `- Range: \`${report.from.ref}\` -> \`${report.to.ref}\``,
    `- Readiness: ${report.from.readinessLevel} ${report.from.readinessScore} -> ${report.to.readinessLevel} ${report.to.readinessScore} (${formatDelta(report.summary.readinessScoreDelta)})`,
    formatOwnershipSummary(
      report.from,
      report.to,
      report.summary.ownershipCoverageDelta,
    ),
  ];
  if (report.summary.totalAssetsDelta !== 0) {
    summaryLines.push(
      `- Total assets: ${report.from.totalAssets} -> ${report.to.totalAssets} (${formatDelta(report.summary.totalAssetsDelta)})`,
    );
  }
  if (report.summary.graphResolutionDelta !== 0) {
    summaryLines.push(
      `- Graph resolution: ${formatDelta(report.summary.graphResolutionDelta)}`,
    );
  }
  if (report.summary.findingsDelta !== 0) {
    summaryLines.push(
      `- Findings: ${formatDelta(report.summary.findingsDelta)}`,
    );
  }
  if (report.summary.highOrCriticalFindingsDelta !== 0) {
    summaryLines.push(
      `- High/critical findings: ${formatDelta(report.summary.highOrCriticalFindingsDelta)}`,
    );
  }
  const securityPolicy =
    "securityPolicy" in report ? report.securityPolicy : undefined;
  if (securityPolicy && securityPolicy.matchCount > 0) {
    const suffix =
      securityPolicy.matchCount === 1 ? "relaxation" : "relaxations";
    const effect =
      securityPolicy.configured.effective === "off"
        ? "GATE OFF"
        : securityPolicy.outcome.toUpperCase();
    summaryLines.push(
      `- Security policy relaxation: ${effect} — ${securityPolicy.matchCount} ${suffix}; explicit human security review required`,
    );
  }
  const securityPolicyLines =
    securityPolicy && securityPolicy.matchCount > 0
      ? ["", ...formatSecurityPolicyRelaxationSection(securityPolicy)]
      : [];

  const detailLines = [
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
    "## Asset Changes",
    "",
    ...formatAssetChanges(report.diff.catalog),
    "",
    "## Graph Changes",
    "",
    ...formatGraphChanges(report.diff.graph),
    "",
    "## Readiness Check Changes",
    "",
    ...formatReadinessCheckChanges(report.diff.readiness.checkChanges),
    ...skillDiscoveryLines,
    "",
    "## Executable Surface Changes",
    "",
    ...formatExecutableSurfaceChanges(executableSurface),
    "",
    "## Security Posture",
    "",
    ...formatSecurityPostureSection(report.securityPosture),
    "",
    "## Security Changes",
    "",
    ...formatSecurityChanges(report.diff.security),
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
  ];
  const lines = [
    "# Renma CI Report",
    "",
    "## Summary",
    "",
    ...summaryLines,
    ...formatChangeOverview(report, executableSurface),
    ...securityPolicyLines,
    "",
    "## Review Notes",
    "",
    ...formatReviewNotes(report),
    "",
    "<details>",
    "<summary>Full report details</summary>",
    "",
    ...detailLines,
    "",
    "</details>",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function formatChangeOverview(
  report: CiReportFormatInput,
  executableSurface: CiCompatibleExecutableSurfaceDiff,
): string[] {
  const repositoryChanges = formatChangeGroups([
    [
      "assets",
      report.diff.catalog.addedAssets.length,
      report.diff.catalog.removedAssets.length,
      report.diff.catalog.changedAssets.length,
    ],
    [
      "graph edges",
      report.diff.graph.addedEdges.length,
      report.diff.graph.removedEdges.length,
    ],
    ["graph unresolved", report.diff.graph.newUnresolvedEdges.length],
    ["graph resolved", report.diff.graph.resolvedEdges.length],
    ["readiness checks", 0, 0, report.diff.readiness.checkChanges.length],
    [
      "Skill Discovery",
      0,
      0,
      "skillDiscovery" in report
        ? skillDiscoveryChangeCount(report.skillDiscovery)
        : 0,
    ],
    [
      "Skill Discovery policy matches",
      "skillDiscoveryPolicy" in report
        ? report.skillDiscoveryPolicy.matchCount
        : 0,
    ],
  ]);
  const executableChanges = formatChangeGroups([
    [
      "surfaces",
      executableSurface.addedSurfacePaths.length,
      executableSurface.removedSurfacePaths.length,
      executableSurface.changedSurfaces.length,
    ],
    [
      "dependencies",
      executableSurface.addedDependencies?.length ?? 0,
      executableSurface.removedDependencies?.length ?? 0,
      executableSurface.dependencyResolutionChanges?.length ?? 0,
    ],
    [
      "invocation resolution",
      0,
      0,
      executableSurface.invocationResolutionChanges.length,
    ],
    [
      "governance",
      0,
      0,
      executableSurface.invocationGovernanceChanges.length +
        executableSurface.newInvocationsWithoutEffectivePolicyEvidence.length +
        (executableSurface.newInvocationsWithMultipleEffectivePolicyFingerprints
          ?.length ?? 0),
    ],
    [
      "invocation review evidence",
      executableSurface.newProblematicInvocations.length,
    ],
    [
      "dependency review evidence",
      executableSurface.newProblematicDependencies?.length ?? 0,
    ],
    [
      "reachability",
      0,
      0,
      (executableSurface.newlyTransitivelyReachableSurfacePaths?.length ?? 0) +
        (executableSurface.surfacesLostStaticInvocationReachability?.length ??
          0) +
        (executableSurface.invocationDependencyDepthChanges?.length ?? 0) +
        executableSurface.newlyReachableSkillLocalPaths.length +
        executableSurface.newlyUnreachableSkillLocalPaths.length,
    ],
  ]);
  if (executableChanges.length === 0) {
    executableChanges.push(
      ...formatChangeGroups([
        [
          "inventory metrics",
          0,
          0,
          countNonZeroNumbers(executableSurface.summary),
        ],
      ]),
    );
  }
  const findingAndPolicyChanges = formatChangeGroups([
    [
      "findings",
      report.diff.findings.added.length,
      report.diff.findings.removed.length,
    ],
    [
      "security policy metrics",
      0,
      0,
      countNonZeroNumbers(report.diff.security?.policyInventory),
    ],
    [
      "security policy boundaries",
      0,
      0,
      report.diff.security?.policyChanges?.length ?? 0,
    ],
    [
      "security policy relaxations",
      "securityPolicy" in report ? report.securityPolicy.matchCount : 0,
    ],
  ]);

  return [
    formatChangeOverviewLine("Changes", repositoryChanges),
    formatChangeOverviewLine("Executable changes", executableChanges),
    formatChangeOverviewLine("Finding/policy changes", findingAndPolicyChanges),
  ].filter((line): line is string => line !== undefined);
}

type ChangeOverviewGroup = readonly [
  label: string,
  added?: number,
  removed?: number,
  changed?: number,
];

function formatChangeGroups(groups: ChangeOverviewGroup[]): string[] {
  return groups.flatMap(([label, added = 0, removed = 0, changed = 0]) => {
    const counts = [
      ...(added > 0 ? [`+${added}`] : []),
      ...(removed > 0 ? [`-${removed}`] : []),
      ...(changed > 0 ? [`~${changed}`] : []),
    ];
    return counts.length > 0 ? [`${label} ${counts.join("/")}`] : [];
  });
}

function formatChangeOverviewLine(
  label: string,
  groups: string[],
): string | undefined {
  return groups.length > 0 ? `- ${label}: ${groups.join("; ")}` : undefined;
}

function skillDiscoveryChangeCount(discovery: SkillDiscoveryDiff): number {
  const detailedChangeCount =
    Number(discovery.adoption.changed) +
    Number(discovery.coverage.changed) +
    discovery.publishedEntrypoints.added.length +
    discovery.publishedEntrypoints.removed.length +
    discovery.reachability.newlyReachable.length +
    discovery.reachability.newlyNotReached.length +
    discovery.unroutedSkills.newlyUnrouted.length +
    discovery.unroutedSkills.resolvedUnrouted.length +
    discovery.routes.added.length +
    discovery.routes.removed.length +
    discovery.routes.changed.length +
    discovery.cycles.added.length +
    discovery.cycles.resolved.length;
  if (detailedChangeCount > 0) return detailedChangeCount;
  return Object.values(discovery.summary).some((value) => value !== 0) ? 1 : 0;
}

function countNonZeroNumbers(value: unknown): number {
  if (typeof value === "number") return value === 0 ? 0 : 1;
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countNonZeroNumbers(item), 0);
  }
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce(
    (count, item) => count + countNonZeroNumbers(item),
    0,
  );
}

function formatSecurityPolicyRelaxationSection(
  policy: SecurityPolicyCiEvaluation,
): string[] {
  const { from, to, effective } = policy.configured;
  const configured =
    from === to
      ? [`- CI review policy: ${from}`]
      : [
          `- CI review policy: ${from} -> ${to}`,
          `- Effective CI review policy: ${effective}`,
        ];
  return [
    "## Security Policy Relaxation",
    "",
    ...configured,
    ...(effective === "off"
      ? [
          "- CI status effect: none — gate disabled; explicit human security review required",
        ]
      : [
          `- Policy outcome: ${policy.outcome.toUpperCase()} — explicit human security review required`,
        ]),
    "",
    ...policy.matches
      .slice(0, MAX_LIST_ITEMS)
      .map((match) => `- ${formatSecurityPolicyCiMatch(match)}`),
    ...formatOverflow(policy.matches.length),
  ];
}

function formatSecurityPolicyCiMatch(match: SecurityPolicyCiMatch): string {
  const asset = `${formatMarkdownInlineCode(match.asset.id)} (${formatMarkdownInlineCode(match.asset.path)})`;
  if (match.kind === "scalar") {
    return `${asset}: ${match.property} ${match.fromState} -> ${match.toState} (${match.id})`;
  }
  const values =
    match.direction === "allowed_value_added"
      ? match.addedValues
      : match.removedValues;
  const action =
    match.direction === "allowed_value_added"
      ? "allowed value added"
      : "restricted value removed";
  const renderedValues = values
    .slice(0, MAX_LIST_ITEMS)
    .map(formatMarkdownInlineCode)
    .join(", ");
  const overflow =
    values.length > MAX_LIST_ITEMS
      ? `; ${values.length - MAX_LIST_ITEMS} more not shown; see JSON for the full list`
      : "";
  return `${asset}: ${match.property} — ${action}: ${renderedValues}${overflow} (${match.id})`;
}

function formatReviewNotes(report: CiReportFormatInput): string[] {
  if (report.notes.length > 0) {
    return report.notes.map((note) => `- ${note}`);
  }
  return report.status === "pass"
    ? ["- No CI report regressions detected."]
    : ["- Review the changed metrics and evidence in the full report details."];
}

function formatExecutableSurfaceChanges(
  executableSurface: CiCompatibleExecutableSurfaceDiff,
): string[] {
  const newWithout =
    executableSurface.newInvocationsWithoutEffectivePolicyEvidence ?? [];
  const newMultiple =
    executableSurface.newInvocationsWithMultipleEffectivePolicyFingerprints ??
    [];
  const gained =
    executableSurface.invocationsGainedEffectivePolicyEvidence ?? [];
  const lost = executableSurface.invocationsLostEffectivePolicyEvidence ?? [];
  const multiple =
    executableSurface.invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints ??
    [];
  const dependencyResolutionChanges =
    executableSurface.dependencyResolutionChanges ?? [];
  const newProblematicDependencies =
    executableSurface.newProblematicDependencies ?? [];
  const newlyTransitive =
    executableSurface.newlyTransitivelyReachableSurfacePaths ?? [];
  const lostReachability =
    executableSurface.surfacesLostStaticInvocationReachability ?? [];
  const analyzerCounts =
    executableSurface.toSummary.dependencyAnalyzers
      ?.map(({ analyzer, count }) => `${analyzer} ${count}`)
      .join(", ") || "none";
  const lines = [
    `- Total surfaces: ${executableSurface.fromSummary.totalSurfaces} -> ${executableSurface.toSummary.totalSurfaces} (${formatDelta(executableSurface.summary.totalSurfacesDelta)})`,
    `- Added surfaces: ${executableSurface.addedSurfacePaths.length}`,
    `- Removed surfaces: ${executableSurface.removedSurfacePaths.length}`,
    `- Changed surfaces: ${executableSurface.changedSurfaces.length}`,
    `- Dependencies: ${executableSurface.fromSummary.totalDependencies ?? 0} -> ${executableSurface.toSummary.totalDependencies ?? 0} (${formatDelta(executableSurface.summary.totalDependenciesDelta ?? 0)})`,
    `- Resolved dependencies: ${executableSurface.fromSummary.resolvedDependencies ?? 0} -> ${executableSurface.toSummary.resolvedDependencies ?? 0} (${formatDelta(executableSurface.summary.resolvedDependenciesDelta ?? 0)})`,
    `- Dependency analyzers: ${analyzerCounts}`,
    `- New dependency evidence for review: ${newProblematicDependencies.length}`,
    `- Dependency resolution changes: ${dependencyResolutionChanges.length}`,
    `- Newly transitively reachable surfaces: ${newlyTransitive.length}`,
    `- Surfaces that lost static invocation reachability: ${lostReachability.length}`,
    `- New problematic invocation evidence: ${executableSurface.newProblematicInvocations.length}`,
    `- Invocation-context policy evidence: ${executableSurface.fromSummary.invocationsWithEffectivePolicyEvidence ?? 0} -> ${executableSurface.toSummary.invocationsWithEffectivePolicyEvidence ?? 0} (${formatDelta(executableSurface.summary.invocationsWithEffectivePolicyEvidenceDelta ?? 0)})`,
    `- Resolved invocation policy evidence: ${executableSurface.fromSummary.resolvedInvocationsWithEffectivePolicyEvidence ?? 0} -> ${executableSurface.toSummary.resolvedInvocationsWithEffectivePolicyEvidence ?? 0} (${formatDelta(executableSurface.summary.resolvedInvocationsWithEffectivePolicyEvidenceDelta ?? 0)})`,
    `- New invocations without effective policy evidence: ${newWithout.length}`,
    `- Invocations that gained effective policy evidence: ${gained.length}`,
    `- Invocations that lost effective policy evidence: ${lost.length}`,
    `- Invocations with multiple effective fingerprints: ${executableSurface.fromSummary.invocationsWithMultipleEffectivePolicyFingerprints ?? 0} -> ${executableSurface.toSummary.invocationsWithMultipleEffectivePolicyFingerprints ?? 0} (${formatDelta(executableSurface.summary.invocationsWithMultipleEffectivePolicyFingerprintsDelta ?? 0)})`,
    `- New invocations with multiple effective fingerprints: ${newMultiple.length}`,
    `- Governance changes with multiple effective fingerprints: ${multiple.length}`,
    `- Newly reachable Skill-local scripts: ${executableSurface.newlyReachableSkillLocalPaths.length}`,
    `- Newly unreachable Skill-local scripts: ${executableSurface.newlyUnreachableSkillLocalPaths.length}`,
    `- Surface policy-evidence coverage: ${formatDelta(executableSurface.summary.effectivePolicyCoverageDelta)} pp`,
  ];
  if (executableSurface.addedSurfacePaths.length > 0) {
    lines.push(
      "",
      "### Added executable surfaces",
      "",
      ...executableSurface.addedSurfacePaths
        .slice(0, MAX_LIST_ITEMS)
        .map((surfacePath) => `- \`${surfacePath}\``),
      ...formatOverflow(executableSurface.addedSurfacePaths.length),
    );
  }
  if (executableSurface.removedSurfacePaths.length > 0) {
    lines.push(
      "",
      "### Removed executable surfaces",
      "",
      ...executableSurface.removedSurfacePaths
        .slice(0, MAX_LIST_ITEMS)
        .map((surfacePath) => `- \`${surfacePath}\``),
      ...formatOverflow(executableSurface.removedSurfacePaths.length),
    );
  }
  if (executableSurface.changedSurfaces.length > 0) {
    lines.push(
      "",
      "### Changed executable surfaces",
      "",
      ...executableSurface.changedSurfaces
        .slice(0, MAX_LIST_ITEMS)
        .map(
          (surface) => `- \`${surface.path}\`: ${surface.reasons.join(", ")}`,
        ),
      ...formatOverflow(executableSurface.changedSurfaces.length),
    );
  }
  if (executableSurface.newProblematicInvocations.length > 0) {
    lines.push(
      "",
      "### New unresolved or unavailable invocations",
      "",
      ...executableSurface.newProblematicInvocations
        .slice(0, MAX_LIST_ITEMS)
        .map(
          (invocation) =>
            `- \`${invocation.sourcePath}:L${invocation.line}\` ${invocation.launcher} \`${invocation.target}\`: ${invocation.resolution}`,
        ),
      ...formatOverflow(executableSurface.newProblematicInvocations.length),
    );
  }
  appendDependencyDeltas(
    lines,
    "New executable dependency evidence for review",
    newProblematicDependencies,
  );
  if (dependencyResolutionChanges.length > 0) {
    lines.push(
      "",
      "### Executable dependency resolution changes",
      "",
      ...dependencyResolutionChanges
        .slice(0, MAX_LIST_ITEMS)
        .map(
          (dependency) =>
            `- \`${dependency.sourcePath}:L${dependency.toLine}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\`: ${dependency.fromResolution} -> ${dependency.toResolution}`,
        ),
      ...formatOverflow(dependencyResolutionChanges.length),
    );
  }
  appendSurfacePaths(
    lines,
    "Newly transitively reachable executable surfaces",
    newlyTransitive,
  );
  appendSurfacePaths(
    lines,
    "Executable surfaces that lost static invocation reachability",
    lostReachability,
  );
  appendInvocationGovernanceDeltas(
    lines,
    "New invocations without effective policy evidence",
    newWithout,
  );
  appendInvocationGovernanceChanges(
    lines,
    "Invocations that gained effective policy evidence",
    gained,
  );
  appendInvocationGovernanceChanges(
    lines,
    "Invocations that lost effective policy evidence",
    lost,
  );
  appendNewMultipleFingerprintInvocations(lines, newMultiple);
  appendInvocationGovernanceChanges(
    lines,
    "Invocation governance changes with multiple effective fingerprints",
    multiple,
  );
  return lines;
}

function appendDependencyDeltas(
  lines: string[],
  heading: string,
  dependencies: NonNullable<
    CiCompatibleExecutableSurfaceDiff["newProblematicDependencies"]
  >,
): void {
  if (dependencies.length === 0) return;
  lines.push(
    "",
    `### ${heading}`,
    "",
    ...dependencies
      .slice(0, MAX_LIST_ITEMS)
      .map(
        (dependency) =>
          `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\`: ${dependency.resolution}`,
      ),
    ...formatOverflow(dependencies.length),
  );
}

function appendSurfacePaths(
  lines: string[],
  heading: string,
  surfacePaths: readonly string[],
): void {
  if (surfacePaths.length === 0) return;
  lines.push(
    "",
    `### ${heading}`,
    "",
    ...surfacePaths
      .slice(0, MAX_LIST_ITEMS)
      .map((surfacePath) => `- \`${surfacePath}\``),
    ...formatOverflow(surfacePaths.length),
  );
}

function appendNewMultipleFingerprintInvocations(
  lines: string[],
  invocations: NonNullable<
    CiCompatibleDiffReport["executableSurface"]["newInvocationsWithMultipleEffectivePolicyFingerprints"]
  >,
): void {
  if (invocations.length === 0) return;
  lines.push(
    "",
    "### New invocations with multiple effective fingerprints",
    "",
    ...invocations
      .slice(0, MAX_LIST_ITEMS)
      .map(
        (invocation) =>
          `- \`${invocation.sourcePath}:L${invocation.line}\` ${invocation.launcher} \`${invocation.target}\`: owning Skill ${invocation.owningSkillResolution}; effective fingerprints ${invocation.distinctEffectivePolicyFingerprints.length}`,
      ),
    ...formatOverflow(invocations.length),
  );
}

function appendInvocationGovernanceDeltas(
  lines: string[],
  heading: string,
  invocations: NonNullable<
    CiCompatibleDiffReport["executableSurface"]["newInvocationsWithoutEffectivePolicyEvidence"]
  >,
): void {
  if (invocations.length === 0) return;
  lines.push(
    "",
    `### ${heading}`,
    "",
    ...invocations
      .slice(0, MAX_LIST_ITEMS)
      .map(
        (invocation) =>
          `- \`${invocation.sourcePath}:L${invocation.line}\` ${invocation.launcher} \`${invocation.target}\`: without effective policy evidence; owning Skill ${invocation.owningSkillResolution}; effective fingerprints ${invocation.distinctEffectivePolicyFingerprints.length}`,
      ),
    ...formatOverflow(invocations.length),
  );
}

function appendInvocationGovernanceChanges(
  lines: string[],
  heading: string,
  invocations: NonNullable<
    CiCompatibleDiffReport["executableSurface"]["invocationGovernanceChanges"]
  >,
): void {
  if (invocations.length === 0) return;
  lines.push(
    "",
    `### ${heading}`,
    "",
    ...invocations
      .slice(0, MAX_LIST_ITEMS)
      .map(
        (invocation) =>
          `- \`${invocation.sourcePath}:L${invocation.toLine}\` ${invocation.launcher} \`${invocation.target}\`: policy evidence ${invocation.fromHasEffectivePolicyEvidence ? "with" : "without"} -> ${invocation.toHasEffectivePolicyEvidence ? "with" : "without"}; owning Skill ${invocation.fromOwningSkillResolution} -> ${invocation.toOwningSkillResolution}; effective fingerprints ${invocation.fromDistinctEffectivePolicyFingerprints.length} -> ${invocation.toDistinctEffectivePolicyFingerprints.length}`,
      ),
    ...formatOverflow(invocations.length),
  );
}

function formatOwnershipSummary(
  from: DiffEndpoint,
  to: DiffEndpoint,
  coverageDelta: number,
): string {
  if (!from.ownership || !to.ownership) {
    return `- Ownership coverage: ${formatDelta(coverageDelta)}`;
  }
  return `- Ownership: ${formatOwnershipEndpoint(from)} -> ${formatOwnershipEndpoint(to)} (${formatDelta(coverageDelta)} pp)`;
}

function formatOwnershipEndpoint(endpoint: DiffEndpoint): string {
  const ownership = endpoint.ownership;
  if (!ownership) return "(unavailable)";
  return `${ownership.ownedAssets}/${ownership.eligibleAssets} (${ownership.coveragePercent}%)`;
}

function formatAssetChanges(
  catalog: CiCompatibleDiffReport["catalog"],
): string[] {
  return [
    ...formatAssetList("Added assets", catalog.addedAssets),
    "",
    ...formatAssetList("Removed assets", catalog.removedAssets),
    "",
    ...formatChangedAssetList(catalog.changedAssets),
  ];
}

function formatAssetList(heading: string, assets: AssetDelta[]): string[] {
  if (assets.length === 0) return [`### ${heading}`, "", "- None"];
  return [
    `### ${heading}`,
    "",
    ...assets
      .slice(0, MAX_LIST_ITEMS)
      .flatMap((asset) => formatAssetDetails(asset)),
    ...formatOverflow(assets.length),
  ];
}

function formatAssetDetails(asset: AssetDelta): string[] {
  const lifecycleEvidence =
    asset.statusReason !== undefined || asset.statusChangedAt !== undefined
      ? [
          `  - Status reason: ${formatPlainValue(asset.statusReason)}`,
          `  - Status changed at: ${formatPlainValue(asset.statusChangedAt)}`,
        ]
      : [];
  return [
    `- \`${asset.id}\``,
    `  - Path: ${formatCodeValue(asset.path)}`,
    `  - Kind: ${formatPlainValue(asset.kind)}`,
    `  - Status: ${formatPlainValue(asset.status)}`,
    ...lifecycleEvidence,
    `  - Declared owner: ${formatPlainValue(asset.declaredOwner)}`,
    `  - Effective owner: ${formatPlainValue(asset.effectiveOwner)}`,
  ];
}

function formatChangedAssetList(changes: AssetChange[]): string[] {
  if (changes.length === 0) return ["### Changed assets", "", "- None"];
  return [
    "### Changed assets",
    "",
    ...changes
      .slice(0, MAX_LIST_ITEMS)
      .flatMap((change) => formatChangedAsset(change)),
    ...formatOverflow(changes.length),
  ];
}

function formatChangedAsset(change: AssetChange): string[] {
  const path = change.path ?? change.to.path ?? change.from.path;
  return [
    `- \`${change.id}\` (${formatCodeValue(path)})`,
    ...change.changedFields.map(
      (field) =>
        `  - ${formatComparableAssetField(field)}: ${formatCodeValue(change.from[field])} -> ${formatCodeValue(change.to[field])}`,
    ),
  ];
}

function formatComparableAssetField(field: string): string {
  switch (field) {
    case "declaredOwner":
      return "declared owner";
    case "effectiveOwner":
      return "effective owner";
    case "statusReason":
      return "status reason";
    case "statusChangedAt":
      return "status changed at";
    default:
      return field;
  }
}

function formatGraphChanges(graph: CiCompatibleDiffReport["graph"]): string[] {
  return [
    ...formatEdgeList("Added edges", graph.addedEdges),
    "",
    ...formatEdgeList("Removed edges", graph.removedEdges),
  ];
}

function formatEdgeList(heading: string, edges: EdgeDelta[]): string[] {
  if (edges.length === 0) return [`### ${heading}`, "", "- None"];
  return [
    `### ${heading}`,
    "",
    ...edges.slice(0, MAX_LIST_ITEMS).map((edge) => `- ${formatEdge(edge)}`),
    ...formatOverflow(edges.length),
  ];
}

function formatEdge(edge: EdgeDelta): string {
  return `\`${edge.source}\` --${edge.kind}--> \`${edge.target}\` (${edge.resolved ? "resolved" : "unresolved"})`;
}

function formatReadinessCheckChanges(
  changes: CiCompatibleDiffReport["readiness"]["checkChanges"],
): string[] {
  if (changes.length === 0) return ["- None"];
  return [
    ...changes.slice(0, MAX_LIST_ITEMS).map((change) => {
      const from = formatCheckState(change.fromStatus, change.fromSeverity);
      const to = formatCheckState(change.toStatus, change.toSeverity);
      return `- \`${change.id}\`: ${from} -> ${to}; summary changed: ${change.summaryChanged ? "yes" : "no"}`;
    }),
    ...formatOverflow(changes.length),
  ];
}

function formatCheckState(status: string, severity?: string): string {
  return severity ? `${status}/${severity}` : status;
}

function formatCodeValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "(none)";
  return `\`${value}\``;
}

function formatPlainValue(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "(none)";
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
