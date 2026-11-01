import { formatSecurityChanges } from "../renderers/security-diff.js";
import {
  formatExecutableSurfaceChanges,
  type CiCompatibleExecutableSurfaceDiff,
} from "../renderers/ci-executable-surface.js";
import { formatSkillDiscoverySection } from "../renderers/ci-discovery.js";
import { formatCiPolicySections } from "../renderers/ci-policy.js";
import { MAX_LIST_ITEMS, formatOverflow } from "../renderers/ci-report-list.js";
import { formatWritableByEvidence } from "../renderers/writable-by.js";
import {
  executeDiff,
  formatInspectionCoverageChange,
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
import { buildExecutableSurfaceDiff } from "../executable-surface-diff.js";
import { zeroExecutableSurfaceInventory } from "../executable-surface-inventory.js";
import type { ConfigOverrides } from "../config.js";
import { formatVersionedJsonDocument } from "../report.js";
import type { SkillDiscoveryDiff } from "../skill-discovery-diff.js";
import {
  evaluateSkillDiscoveryCiPolicy,
  type SkillDiscoveryCiPolicyConfiguration,
  type SkillDiscoveryCiPolicyEvaluation,
} from "../skill-discovery-ci-policy.js";
import {
  evaluateSecurityPolicyCiPolicy,
  type SecurityPolicyCiConfiguration,
  type SecurityPolicyCiEvaluation,
} from "../security-policy-ci-policy.js";
import { formatMarkdownInlineCode } from "../renderers/markdown-inline-code.js";
import {
  evaluateScanBoundaryCiPolicy,
  type ScanBoundaryCiConfiguration,
  type ScanBoundaryCiEvaluation,
} from "../scan-boundary-ci-policy.js";
import {
  evaluateExecutableSurfaceCiPolicy,
  type ExecutableSurfaceCiConfiguration,
  type ExecutableSurfaceCiEvaluation,
} from "../executable-surface-ci-policy.js";
import type { EffectiveCiScanBoundaryEvidence } from "../scan-boundary.js";
import {
  zeroInspectionCoverageDiff,
  type InspectionCoverageDiff,
} from "../inspection-coverage.js";
import { QUALITY_POLICY_DIFF_SCHEMA_VERSION } from "../quality-policy-diff.js";
import {
  evaluateQualityPolicyCiPolicy,
  type QualityPolicyCiConfiguration,
  type QualityPolicyCiEvaluation,
} from "../quality-policy-ci-policy.js";
import { CLI_EXIT } from "../cli-errors.js";
import {
  evaluateMetadataPolicyCiPolicy,
  type MetadataPolicyCiConfiguration,
  type MetadataPolicyCiEvaluation,
} from "../metadata-policy-ci-policy.js";
import { REQUIRED_METADATA_CONFIGURATION_KEY } from "../metadata-definitions.js";
import {
  evaluateDiagnosticSeverityCiPolicy,
  type DiagnosticSeverityCiConfiguration,
  type DiagnosticSeverityCiEvaluation,
} from "../diagnostic-severity-ci-policy.js";

type CiReportFormat = DiffFormat;
export const CI_REPORT_JSON_SCHEMA_VERSION = "renma.ci-report.v1" as const;
type CiReportStatus = "pass" | "warn" | "fail";
type CiReportFailureThreshold = "fail" | "warn";
type CiFormatCompatibleDiffReport = Omit<
  DiffReportWithoutSkillDiscovery,
  "executableSurface"
> & {
  executableSurface: CiCompatibleExecutableSurfaceDiff;
};
type CiCompatibleDiffReport = DiffReportWithoutSkillDiscovery;

export interface CiReport {
  root: string;
  from: DiffReport["from"];
  to: DiffReport["to"];
  status: CiReportStatus;
  summary: DiffReport["summary"];
  skillDiscovery: SkillDiscoveryDiff;
  skillDiscoveryPolicy: SkillDiscoveryCiPolicyEvaluation;
  securityPolicy: SecurityPolicyCiEvaluation;
  scanBoundaryPolicy: ScanBoundaryCiEvaluation;
  executableSurfacePolicy: ExecutableSurfaceCiEvaluation;
  qualityPolicy: QualityPolicyCiEvaluation;
  metadataPolicy?: MetadataPolicyCiEvaluation;
  diagnosticSeverityPolicy?: DiagnosticSeverityCiEvaluation;
  securityPosture: {
    added: SecurityPostureSummary;
    resolved: SecurityPostureSummary;
  };
  notes: string[];
  diff: CiCompatibleDiffReport;
}

export type CiReportFormatInput =
  | CiReport
  | (Omit<
      CiReport,
      | "diff"
      | "skillDiscoveryPolicy"
      | "securityPolicy"
      | "scanBoundaryPolicy"
      | "executableSurfacePolicy"
      | "qualityPolicy"
      | "metadataPolicy"
      | "diagnosticSeverityPolicy"
    > & {
      diff: CiFormatCompatibleDiffReport;
    })
  | (Omit<
      CiReport,
      | "diff"
      | "skillDiscovery"
      | "skillDiscoveryPolicy"
      | "securityPolicy"
      | "scanBoundaryPolicy"
      | "executableSurfacePolicy"
      | "qualityPolicy"
      | "metadataPolicy"
      | "diagnosticSeverityPolicy"
    > & {
      diff: CiFormatCompatibleDiffReport;
    });

interface CiReportOptions {
  fromRef: string;
  toRef: string;
  overrides?: ConfigOverrides;
  instrumentation?: DiffCollectionInstrumentation;
}

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
  details?: Record<string, unknown> | undefined;
}

export async function runCiReportCommand(
  targetPath: string,
  options: CiReportOptions & {
    format: CiReportFormat;
    failOnStatus?: CiReportFailureThreshold;
  },
): Promise<number> {
  const report = await ciReport(targetPath, options);
  process.stdout.write(formatCiReport(report, options.format));
  return ciReportStatusMeets(report.status, options.failOnStatus ?? "fail")
    ? CLI_EXIT.policyFailure
    : CLI_EXIT.success;
}

/** Keep semantic report status independent from the caller's exit policy. */
export function ciReportStatusMeets(
  status: CiReportStatus,
  threshold: CiReportFailureThreshold,
): boolean {
  return status === "fail" || (threshold === "warn" && status === "warn");
}

export async function ciReport(
  targetPath: string,
  options: CiReportOptions,
): Promise<CiReport> {
  const execution = await executeDiff(targetPath, {
    ...options,
    includeCiEvidence: true,
  });
  return buildCiReportFromDiff(
    execution.report,
    execution.skillDiscoveryCiPolicy,
    execution.securityPolicyCiPolicy,
    execution.scanBoundaryCiPolicy,
    execution.effectiveCiScanBoundary,
    execution.executableSurfaceCiPolicy,
    execution.qualityCiPolicy,
    execution.metadataCiPolicy,
    execution.diagnosticSeverityCiPolicy,
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
  configuredScanBoundaryPolicy: ScanBoundaryCiConfiguration = {
    from: "fail",
    to: "fail",
  },
  effectiveCiScanBoundary?: EffectiveCiScanBoundaryEvidence,
  configuredExecutableSurfacePolicy: ExecutableSurfaceCiConfiguration = {
    from: "off",
    to: "off",
  },
  configuredQualityPolicy: QualityPolicyCiConfiguration = {
    from: "fail",
    to: "fail",
  },
  configuredMetadataPolicy: MetadataPolicyCiConfiguration = {
    from: "fail",
    to: "fail",
  },
  configuredDiagnosticSeverityPolicy: DiagnosticSeverityCiConfiguration = {
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
  const scanBoundaryPolicy = evaluateScanBoundaryCiPolicy(
    ciCompatibleDiff.scanBoundary ?? { changes: [] },
    configuredScanBoundaryPolicy,
    effectiveCiScanBoundary,
  );
  const executableSurfacePolicy = evaluateExecutableSurfaceCiPolicy(
    ciCompatibleDiff.executableSurface ??
      buildExecutableSurfaceDiff(
        zeroExecutableSurfaceInventory(),
        zeroExecutableSurfaceInventory(),
      ),
    configuredExecutableSurfacePolicy,
  );
  const qualityPolicy = evaluateQualityPolicyCiPolicy(
    ciCompatibleDiff.qualityPolicy ?? {
      schemaVersion: QUALITY_POLICY_DIFF_SCHEMA_VERSION,
      changes: [],
    },
    configuredQualityPolicy,
  );
  const metadataPolicy = evaluateMetadataPolicyCiPolicy(
    ciCompatibleDiff.metadataPolicy ?? {
      changes: [],
    },
    configuredMetadataPolicy,
  );
  const diagnosticSeverityPolicy = evaluateDiagnosticSeverityCiPolicy(
    ciCompatibleDiff.diagnosticSeverityPolicy ?? { changes: [] },
    configuredDiagnosticSeverityPolicy,
  );
  const status = composeCiReportStatus(
    existingStatus,
    skillDiscoveryPolicy.outcome,
    securityPolicy.outcome,
    scanBoundaryPolicy.outcome,
    executableSurfacePolicy.outcome,
    qualityPolicy.outcome,
    metadataPolicy.outcome,
    diagnosticSeverityPolicy.outcome,
  );
  const securityPosture = {
    added: summarizeSecurityPosture(ciCompatibleDiff.findings.added),
    resolved: summarizeSecurityPosture(ciCompatibleDiff.findings.removed),
  };

  const hasMetadataPolicyEvidence =
    metadataPolicy.configured.from !== metadataPolicy.configured.to ||
    (ciCompatibleDiff.metadataPolicy?.changes.length ?? 0) > 0 ||
    metadataPolicy.matchCount > 0;
  const hasDiagnosticSeverityPolicyEvidence =
    diagnosticSeverityPolicy.configured.from !==
      diagnosticSeverityPolicy.configured.to ||
    (ciCompatibleDiff.diagnosticSeverityPolicy?.changes.length ?? 0) > 0 ||
    diagnosticSeverityPolicy.matchCount > 0;
  return {
    root: ciCompatibleDiff.root,
    from: ciCompatibleDiff.from,
    to: ciCompatibleDiff.to,
    status,
    summary: ciCompatibleDiff.summary,
    skillDiscovery: discovery,
    skillDiscoveryPolicy,
    securityPolicy,
    scanBoundaryPolicy,
    executableSurfacePolicy,
    qualityPolicy,
    ...(hasMetadataPolicyEvidence ? { metadataPolicy } : {}),
    ...(hasDiagnosticSeverityPolicyEvidence
      ? { diagnosticSeverityPolicy }
      : {}),
    securityPosture,
    notes: reviewNotes(
      ciCompatibleDiff,
      status,
      securityPosture.added,
      skillDiscoveryPolicy,
      securityPolicy,
      scanBoundaryPolicy,
      executableSurfacePolicy,
      qualityPolicy,
      metadataPolicy,
      diagnosticSeverityPolicy,
    ),
    diff: ciCompatibleDiff,
  };
}

export function formatCiReport(
  report: CiReportFormatInput,
  format: CiReportFormat,
): string {
  if (format === "json") {
    return formatVersionedJsonDocument(CI_REPORT_JSON_SCHEMA_VERSION, report);
  }
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
    hasReadinessRegression(report) ||
    inspectionCoverageDiff(report).regressions.length > 0 ||
    report.summary.readinessScoreDelta < 0 ||
    report.summary.ownershipCoverageDelta < 0 ||
    report.summary.graphResolutionDelta < 0 ||
    report.summary.findingsDelta > 0
  ) {
    return "warn";
  }

  return "pass";
}

function hasReadinessRegression(report: CiCompatibleDiffReport): boolean {
  const levels = new Map([
    ["not_ready", 0],
    ["needs_attention", 1],
    ["ready", 2],
  ]);
  const fromLevel = levels.get(report.from.readinessLevel);
  const toLevel = levels.get(report.to.readinessLevel);
  if (fromLevel !== undefined && toLevel !== undefined && toLevel < fromLevel) {
    return true;
  }
  return report.readiness.checkChanges.some(
    (change) =>
      (change.fromStatus === "pass" || change.fromStatus === "absent") &&
      (change.toStatus === "fail" || change.toSeverity === "error"),
  );
}

function inspectionCoverageDiff(
  report: Pick<CiCompatibleDiffReport, "inspectionCoverage">,
): InspectionCoverageDiff {
  return report.inspectionCoverage ?? zeroInspectionCoverageDiff();
}

export function composeCiReportStatus(
  existingStatus: CiReportStatus,
  discoveryPolicyOutcome: SkillDiscoveryCiPolicyEvaluation["outcome"],
  securityPolicyOutcome: SecurityPolicyCiEvaluation["outcome"] = "pass",
  scanBoundaryPolicyOutcome: ScanBoundaryCiEvaluation["outcome"] = "pass",
  executableSurfacePolicyOutcome: ExecutableSurfaceCiEvaluation["outcome"] = "pass",
  qualityPolicyOutcome: QualityPolicyCiEvaluation["outcome"] = "pass",
  metadataPolicyOutcome: MetadataPolicyCiEvaluation["outcome"] = "pass",
  diagnosticSeverityPolicyOutcome: DiagnosticSeverityCiEvaluation["outcome"] = "pass",
): CiReportStatus {
  if (
    existingStatus === "fail" ||
    securityPolicyOutcome === "fail" ||
    scanBoundaryPolicyOutcome === "fail" ||
    executableSurfacePolicyOutcome === "fail" ||
    qualityPolicyOutcome === "fail" ||
    metadataPolicyOutcome === "fail" ||
    diagnosticSeverityPolicyOutcome === "fail"
  )
    return "fail";
  if (
    existingStatus === "warn" ||
    discoveryPolicyOutcome === "warn" ||
    securityPolicyOutcome === "warn" ||
    scanBoundaryPolicyOutcome === "warn" ||
    executableSurfacePolicyOutcome === "warn" ||
    qualityPolicyOutcome === "warn" ||
    metadataPolicyOutcome === "warn" ||
    diagnosticSeverityPolicyOutcome === "warn"
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
  scanBoundaryPolicy: ScanBoundaryCiEvaluation,
  executableSurfacePolicy: ExecutableSurfaceCiEvaluation,
  qualityPolicy: QualityPolicyCiEvaluation,
  metadataPolicy: MetadataPolicyCiEvaluation,
  diagnosticSeverityPolicy: DiagnosticSeverityCiEvaluation,
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
  if (hasReadinessRegression(report)) {
    notes.push("Readiness level or a blocking readiness check regressed.");
  }
  if (inspectionCoverageDiff(report).regressions.length > 0) {
    notes.push(
      "Review newly incomplete inspection coverage for expected agent-facing artifacts.",
    );
  }
  if (report.summary.ownershipCoverageDelta > 0) {
    notes.push("Ownership coverage improved.");
  }
  if (
    report.summary.findingsDelta < 0 &&
    securityPolicy.matchCount === 0 &&
    scanBoundaryPolicy.matchCount === 0 &&
    qualityPolicy.matchCount === 0 &&
    metadataPolicy.matchCount === 0 &&
    diagnosticSeverityPolicy.matchCount === 0
  ) {
    notes.push("Scan findings decreased.");
  }
  if (scanBoundaryPolicy.matchCount > 0) {
    const suffix =
      scanBoundaryPolicy.matchCount === 1 ? "weakening" : "weakenings";
    notes.push(
      `Scan boundary policy matched ${scanBoundaryPolicy.matchCount} ${suffix}; target-local narrowing is not trusted for CI enforcement.`,
    );
    if (report.summary.findingsDelta < 0) {
      notes.push(
        "Scan findings decreased alongside a scan-boundary weakening; this is not treated as verified remediation.",
      );
    }
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
  if (qualityPolicy.matchCount > 0) {
    const thresholdWeakeningCount =
      qualityPolicy.numericThresholdChanges.weakenings;
    const suffix = thresholdWeakeningCount === 1 ? "increase" : "increases";
    if (thresholdWeakeningCount > 0) {
      if (qualityPolicy.configured.effective === "off") {
        notes.push(
          `Quality-policy CI review is off; ${thresholdWeakeningCount} numeric threshold ${suffix} remain informational.`,
        );
      } else {
        notes.push(
          `Quality policy matched ${thresholdWeakeningCount} numeric token-threshold ${suffix}.`,
        );
      }
    }
    if (report.summary.findingsDelta < 0 && thresholdWeakeningCount > 0) {
      notes.push(
        "Scan findings decreased alongside a token-threshold weakening; this is not treated as verified remediation.",
      );
    }
  }
  if (qualityPolicy.modeTransition.direction === "weakening") {
    if (qualityPolicy.configured.effective === "off") {
      notes.push(
        `Quality CI mode was relaxed from ${qualityPolicy.modeTransition.from} to ${qualityPolicy.modeTransition.to}; the gate is disabled.`,
      );
    } else {
      notes.push(
        `Quality CI mode was relaxed from ${qualityPolicy.modeTransition.from} to ${qualityPolicy.modeTransition.to}; the stricter ${qualityPolicy.configured.effective} endpoint mode governs this comparison.`,
      );
    }
  } else if (qualityPolicy.modeTransition.direction === "tightening") {
    notes.push(
      `Quality CI mode was tightened from ${qualityPolicy.modeTransition.from} to ${qualityPolicy.modeTransition.to}; the transition is non-blocking.`,
    );
  }
  const removedRequiredFields = metadataPolicy.matches.flatMap((match) =>
    "change" in match ? [match.change.field] : [],
  );
  if (removedRequiredFields.length > 0) {
    notes.push(
      `Metadata policy removed ${removedRequiredFields.length} required ${removedRequiredFields.length === 1 ? "field" : "fields"}: ${removedRequiredFields.join(", ")}.`,
    );
    if (report.summary.findingsDelta < 0) {
      notes.push(
        "Scan findings decreased alongside required-metadata policy weakening; this is not treated as verified remediation.",
      );
    }
  }
  if (metadataPolicy.modeTransition.direction === "weakening") {
    notes.push(
      `Metadata CI mode was relaxed from ${metadataPolicy.modeTransition.from} to ${metadataPolicy.modeTransition.to}; the stricter ${metadataPolicy.configured.effective} endpoint mode governs this comparison.`,
    );
  } else if (metadataPolicy.modeTransition.direction === "tightening") {
    notes.push(
      `Metadata CI mode was tightened from ${metadataPolicy.modeTransition.from} to ${metadataPolicy.modeTransition.to}; the transition is non-blocking.`,
    );
  }
  if (diagnosticSeverityPolicy.severityChanges.weakenings > 0) {
    notes.push(
      `Diagnostic severity policy matched ${diagnosticSeverityPolicy.severityChanges.weakenings} weakening${diagnosticSeverityPolicy.severityChanges.weakenings === 1 ? "" : "s"}.`,
    );
    if (report.summary.findingsDelta < 0) {
      notes.push(
        "Scan findings decreased alongside diagnostic severity-policy weakening; this is not treated as verified remediation.",
      );
    }
  }
  if (diagnosticSeverityPolicy.severityChanges.reviewRequired > 0) {
    notes.push(
      `Diagnostic severity policy matched ${diagnosticSeverityPolicy.severityChanges.reviewRequired} change${diagnosticSeverityPolicy.severityChanges.reviewRequired === 1 ? "" : "s"} requiring review because the built-in severity cannot be resolved to one static value.`,
    );
  }
  if (diagnosticSeverityPolicy.modeTransition.direction === "weakening") {
    notes.push(
      `Diagnostics CI mode was relaxed from ${diagnosticSeverityPolicy.modeTransition.from} to ${diagnosticSeverityPolicy.modeTransition.to}; the stricter ${diagnosticSeverityPolicy.configured.effective} endpoint mode governs this comparison.`,
    );
  } else if (
    diagnosticSeverityPolicy.modeTransition.direction === "tightening"
  ) {
    notes.push(
      `Diagnostics CI mode was tightened from ${diagnosticSeverityPolicy.modeTransition.from} to ${diagnosticSeverityPolicy.modeTransition.to}; the transition is non-blocking.`,
    );
  }
  if (executableSurfacePolicy.matchCount > 0) {
    if (executableSurfacePolicy.configured.effective === "off") {
      const suffix =
        executableSurfacePolicy.matchCount === 1
          ? "matching change remains"
          : "matching changes remain";
      notes.push(
        `Executable-surface CI policy is off; ${executableSurfacePolicy.matchCount} ${suffix} informational.`,
      );
    } else {
      const suffix =
        executableSurfacePolicy.matchCount === 1 ? "change" : "changes";
      notes.push(
        `Executable-surface CI policy matched ${executableSurfacePolicy.matchCount} review-triggering ${suffix}.`,
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
  const inspectionCoverage =
    report.diff.inspectionCoverage ?? zeroInspectionCoverageDiff();
  const executableSurface =
    report.diff.executableSurface ??
    buildExecutableSurfaceDiff(
      zeroExecutableSurfaceInventory(),
      zeroExecutableSurfaceInventory(),
    );
  const qualityDiff = report.diff.qualityPolicy ?? {
    schemaVersion: QUALITY_POLICY_DIFF_SCHEMA_VERSION,
    changes: [],
  };
  const metadataDiff = report.diff.metadataPolicy;
  const diagnosticSeverityDiff = report.diff.diagnosticSeverityPolicy;
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
    ...(report.summary.contentChangedAssets === undefined
      ? []
      : [`- Content changes: ${report.summary.contentChangedAssets}`]),
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
  if (inspectionCoverage.regressions.length > 0) {
    summaryLines.push(
      `- Inspection coverage regressions: ${inspectionCoverage.regressions.length}`,
    );
  }
  const metadataPolicy =
    "metadataPolicy" in report ? report.metadataPolicy : undefined;
  const diagnosticSeverityPolicy =
    "diagnosticSeverityPolicy" in report
      ? report.diagnosticSeverityPolicy
      : undefined;
  const policySections = formatCiPolicySections({
    securityPolicy:
      "securityPolicy" in report ? report.securityPolicy : undefined,
    scanBoundaryPolicy:
      "scanBoundaryPolicy" in report ? report.scanBoundaryPolicy : undefined,
    executableSurfacePolicy:
      "executableSurfacePolicy" in report
        ? report.executableSurfacePolicy
        : undefined,
    qualityPolicy: "qualityPolicy" in report ? report.qualityPolicy : undefined,
    metadataPolicy,
    diagnosticSeverityPolicy,
    qualityChanges: qualityDiff.changes,
    metadataChanges: metadataDiff?.changes ?? [],
    diagnosticSeverityChanges: diagnosticSeverityDiff?.changes ?? [],
  });
  summaryLines.push(...policySections.summary);

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
    ...(report.summary.contentChangedAssets === undefined
      ? []
      : [`- Content-changed assets: ${report.summary.contentChangedAssets}`]),
    `- New unresolved required edges: ${newUnresolvedRequiredEdgeCount(report.diff)}`,
    `- Resolved edges: ${report.diff.graph.resolvedEdges.length}`,
    `- Added findings: ${report.diff.findings.added.length}`,
    `- Resolved findings: ${report.diff.findings.removed.length}`,
    `- Quality token-threshold changes: ${qualityDiff.changes.length}`,
    ...(metadataPolicy || metadataDiff
      ? [`- Required metadata changes: ${metadataDiff?.changes.length ?? 0}`]
      : []),
    ...(diagnosticSeverityPolicy || diagnosticSeverityDiff
      ? [
          `- Diagnostic severity changes: ${diagnosticSeverityDiff?.changes.length ?? 0}`,
        ]
      : []),
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
    "",
    "## Inspection Coverage",
    "",
    `- Expected paths: ${inspectionCoverage.from.expectedPathCount} -> ${inspectionCoverage.to.expectedPathCount}`,
    `- Inspected paths: ${inspectionCoverage.from.inspectedPathCount} -> ${inspectionCoverage.to.inspectedPathCount}`,
    `- Blocking issues: ${inspectionCoverage.from.blockingIssueCount} -> ${inspectionCoverage.to.blockingIssueCount}`,
    `- Regressions: ${inspectionCoverage.regressions.length}`,
    `- Resolved issues: ${inspectionCoverage.resolvedIssues.length}`,
    ...(inspectionCoverage.regressions.length > 0
      ? [
          "",
          "### Inspection coverage regressions",
          "",
          ...inspectionCoverage.regressions.map(
            (change) => `- ${formatInspectionCoverageChange(change)}`,
          ),
        ]
      : []),
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
    ...("suppressed" in report.diff.findings
      ? [
          "### Suppression Evidence",
          "",
          `- Suppressed at base: ${report.diff.findings.suppressed.from.length}`,
          `- Suppressed at target: ${report.diff.findings.suppressed.to.length}`,
          ...(report.diff.findings.suppressed.to.length > 0
            ? [
                "",
                "#### Target Suppressed Finding Evidence",
                "",
                ...report.diff.findings.suppressed.to
                  .slice(0, MAX_LIST_ITEMS)
                  .map(
                    (item) =>
                      `- ${item.finding.severity.toUpperCase()} ${formatMarkdownInlineCode(item.finding.id)} at ${formatMarkdownInlineCode(item.finding.evidence.path)}; matched ${formatMarkdownInlineCode(item.suppression.matchedPath)}; expires ${item.suppression.expires}; reason: ${formatMarkdownInlineCode(item.suppression.reason)}`,
                  ),
                ...formatOverflow(report.diff.findings.suppressed.to.length),
              ]
            : []),
        ]
      : []),
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
    ...policySections.sections,
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
      "inspection coverage",
      inspectionCoverageDiff(report.diff).regressions.length,
      inspectionCoverageDiff(report.diff).resolvedIssues.length,
    ],
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
      "quality token thresholds",
      0,
      0,
      report.diff.qualityPolicy?.changes.length ?? 0,
    ],
    [
      "diagnostic severity policy",
      0,
      0,
      report.diff.diagnosticSeverityPolicy?.changes.length ?? 0,
    ],
    [
      "required metadata",
      report.diff.metadataPolicy?.addedRequiredFields.length ?? 0,
      report.diff.metadataPolicy?.removedRequiredFields.length ?? 0,
    ],
    [
      "security policy relaxations",
      "securityPolicy" in report ? report.securityPolicy.matchCount : 0,
    ],
    [
      "scan boundary weakenings",
      "scanBoundaryPolicy" in report ? report.scanBoundaryPolicy.matchCount : 0,
    ],
    [
      "executable-surface CI matches",
      "executableSurfacePolicy" in report
        ? report.executableSurfacePolicy.matchCount
        : 0,
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

function formatReviewNotes(report: CiReportFormatInput): string[] {
  if (report.notes.length > 0) {
    return report.notes.map((note) => `- ${note}`);
  }
  return report.status === "pass"
    ? ["- No CI report regressions detected."]
    : ["- Review the changed metrics and evidence in the full report details."];
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
    ...formatWritableByEvidence(asset, undefined, MAX_LIST_ITEMS),
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
  const contentChangeLines =
    change.contentChanged === true
      ? [
          "  - Content changed: yes",
          `  - Content hash: ${formatCodeValue(change.from.contentHash)} -> ${formatCodeValue(change.to.contentHash)}`,
        ]
      : change.contentChanged === false
        ? ["  - Content changed: no"]
        : [];
  return [
    `- \`${change.id}\` (${formatCodeValue(path)})`,
    ...contentChangeLines,
    ...formatWritableByEvidence(change.to, change.from, MAX_LIST_ITEMS),
    ...change.changedFields
      .filter((field) => field !== "writableBy")
      .map(
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
    ...(target.externalUploadGovernance
      ? [
          `- Target upload denied: ${target.externalUploadGovernance.denied}`,
          `- Target upload allowed; approval required: ${target.externalUploadGovernance.allowedApprovalRequired}`,
          `- Target upload allowed; approval not required: ${target.externalUploadGovernance.allowedNoApprovalRequired}`,
          `- Target upload allowed; approval requirement unspecified: ${target.externalUploadGovernance.allowedApprovalUnspecified}`,
          `- Target upload permission unspecified: ${target.externalUploadGovernance.unspecified}`,
        ]
      : []),
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
  const requiredField = reportDetailString(finding.details, "requiredField");
  const expectedKey = reportDetailString(
    finding.details,
    "expectedSerializedKey",
  );
  const presence = reportDetailString(finding.details, "presenceState");
  const policyEvidence =
    requiredField && expectedKey
      ? `; required ${formatMarkdownInlineCode(requiredField)} as ${formatMarkdownInlineCode(expectedKey)} by ${formatMarkdownInlineCode(REQUIRED_METADATA_CONFIGURATION_KEY)}${presence ? ` (${presence})` : ""}`
      : "";
  return `- ${finding.severity.toUpperCase()}${risk} \`${finding.id}\` \`${location}\` — ${finding.title}${policyEvidence}`;
}

function reportDetailString(
  details: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = details?.[key];
  return typeof value === "string" ? value : undefined;
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
