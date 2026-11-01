import type {
  SecurityPolicyCiEvaluation,
  SecurityPolicyCiMatch,
} from "../security-policy-ci-policy.js";
import type {
  ScanBoundaryCiEvaluation,
  ScanBoundaryCiMatch,
} from "../scan-boundary-ci-policy.js";
import {
  EXECUTABLE_SURFACE_CI_MATCH_IDS,
  type ExecutableSurfaceCiEvaluation,
  type ExecutableSurfaceCiMatch,
} from "../executable-surface-ci-policy.js";
import type { QualityPolicyCiEvaluation } from "../quality-policy-ci-policy.js";
import type { QualityPolicyThresholdChange } from "../quality-policy-diff.js";
import type { MetadataPolicyCiEvaluation } from "../metadata-policy-ci-policy.js";
import type { MetadataPolicyRequiredFieldChange } from "../metadata-policy-diff.js";
import type { DiagnosticSeverityCiEvaluation } from "../diagnostic-severity-ci-policy.js";
import type { DiagnosticSeverityPolicyChange } from "../diagnostic-severity-policy-diff.js";
import { formatMarkdownInlineCode } from "./markdown-inline-code.js";
import { MAX_LIST_ITEMS, formatOverflow } from "./ci-report-list.js";

interface CiPolicyRenderInput {
  securityPolicy: SecurityPolicyCiEvaluation | undefined;
  scanBoundaryPolicy: ScanBoundaryCiEvaluation | undefined;
  executableSurfacePolicy: ExecutableSurfaceCiEvaluation | undefined;
  qualityPolicy: QualityPolicyCiEvaluation | undefined;
  metadataPolicy: MetadataPolicyCiEvaluation | undefined;
  diagnosticSeverityPolicy: DiagnosticSeverityCiEvaluation | undefined;
  qualityChanges: readonly QualityPolicyThresholdChange[];
  metadataChanges: readonly MetadataPolicyRequiredFieldChange[];
  diagnosticSeverityChanges: readonly DiagnosticSeverityPolicyChange[];
}

/** Render evaluated policies without changing their evidence or CI outcomes. */
export function formatCiPolicySections({
  securityPolicy,
  scanBoundaryPolicy,
  executableSurfacePolicy,
  qualityPolicy,
  metadataPolicy,
  diagnosticSeverityPolicy,
  qualityChanges,
  metadataChanges,
  diagnosticSeverityChanges,
}: CiPolicyRenderInput): { summary: string[]; sections: string[] } {
  const summaryLines: string[] = [];
  const sections: string[] = [];
  if (securityPolicy && securityPolicy.matchCount > 0) {
    const suffix =
      securityPolicy.matchCount === 1 ? "relaxation" : "relaxations";
    summaryLines.push(
      `- Security policy relaxation: ${policyEffect(securityPolicy)} — ${securityPolicy.matchCount} ${suffix}; explicit human security review required`,
    );
    sections.push("", ...formatSecurityPolicyRelaxationSection(securityPolicy));
  }

  if (scanBoundaryPolicy && scanBoundaryPolicy.matchCount > 0) {
    summaryLines.push(
      `- Scan boundary weakening: ${policyEffect(scanBoundaryPolicy)} — ${scanBoundaryPolicy.matchCount} exact changes; target-local narrowing is not trusted`,
    );
    sections.push(
      "",
      ...formatScanBoundaryWeakeningSection(scanBoundaryPolicy),
    );
  }

  // Executable-surface policy remains visible even without a review match.
  if (executableSurfacePolicy) {
    if (executableSurfacePolicy.matchCount > 0) {
      const suffix =
        executableSurfacePolicy.matchCount === 1 ? "change" : "changes";
      summaryLines.push(
        `- Executable-surface CI policy: ${policyEffect(executableSurfacePolicy)} — ${executableSurfacePolicy.matchCount} review-triggering ${suffix}`,
      );
    }
    sections.push(
      "",
      ...formatExecutableSurfaceCiPolicySection(executableSurfacePolicy),
    );
  }

  if (
    qualityPolicy &&
    (qualityPolicy.configured.from !== qualityPolicy.configured.to ||
      qualityChanges.length > 0 ||
      qualityPolicy.matchCount > 0)
  ) {
    summaryLines.push(
      `- Quality policy: ${policyEffect(qualityPolicy)} — mode ${qualityPolicy.modeTransition.direction}; ${qualityPolicy.numericThresholdChanges.weakenings} numeric weakenings / ${qualityPolicy.numericThresholdChanges.tightenings} numeric tightenings`,
    );
    sections.push(
      "",
      ...formatQualityPolicySection(qualityPolicy, qualityChanges),
    );
  }

  // Presence is significant for these optional policy projections. The builder
  // has already decided whether evidence warrants including them in the report.
  if (metadataPolicy) {
    summaryLines.push(
      `- Required metadata policy: ${policyEffect(metadataPolicy)} — mode ${metadataPolicy.modeTransition.direction}; ${metadataPolicy.requiredFieldChanges.weakenings} removals / ${metadataPolicy.requiredFieldChanges.tightenings} additions`,
    );
    sections.push(
      "",
      ...formatMetadataPolicySection(metadataPolicy, metadataChanges),
    );
  }

  if (diagnosticSeverityPolicy) {
    summaryLines.push(
      `- Diagnostic severity policy: ${policyEffect(diagnosticSeverityPolicy)} — mode ${diagnosticSeverityPolicy.modeTransition.direction}; ${diagnosticSeverityPolicy.severityChanges.weakenings} weakenings / ${diagnosticSeverityPolicy.severityChanges.tightenings} strengthenings / ${diagnosticSeverityPolicy.severityChanges.neutrals} neutral / ${diagnosticSeverityPolicy.severityChanges.reviewRequired} review required`,
    );
    sections.push(
      "",
      ...formatDiagnosticSeverityPolicySection(
        diagnosticSeverityPolicy,
        diagnosticSeverityChanges,
      ),
    );
  }

  return { summary: summaryLines, sections };
}

function policyEffect(policy: {
  matchCount: number;
  configured: { effective: "off" | "warn" | "fail" };
  outcome: "pass" | "warn" | "fail";
}): string {
  return policy.matchCount > 0 && policy.configured.effective === "off"
    ? "GATE OFF"
    : policy.outcome.toUpperCase();
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

function formatQualityPolicySection(
  policy: QualityPolicyCiEvaluation,
  changes: readonly QualityPolicyThresholdChange[],
): string[] {
  const { from, to, effective } = policy.configured;
  return [
    "## Quality Policy",
    "",
    `- Configured CI review policy: ${from} -> ${to}`,
    `- Effective CI review policy: ${effective}`,
    `- Policy outcome: ${policy.outcome.toUpperCase()}`,
    `- Mode-transition direction: ${policy.modeTransition.direction}`,
    `- Numeric threshold weakenings: ${policy.numericThresholdChanges.weakenings}`,
    `- Numeric threshold tightenings: ${policy.numericThresholdChanges.tightenings}`,
    `- Evaluator matches: ${policy.matchCount}`,
    ...(effective === "off" && policy.matchCount > 0
      ? ["- CI status effect: none — gate disabled"]
      : []),
    "",
    ...(changes.length === 0
      ? ["- No numeric threshold changes."]
      : [
          ...changes
            .slice(0, MAX_LIST_ITEMS)
            .map((change) => `- ${formatQualityPolicyChange(change)}`),
          ...formatOverflow(changes.length),
        ]),
  ];
}

function formatQualityPolicyChange(
  change: QualityPolicyThresholdChange,
): string {
  const direction =
    change.direction === "weakening" ? "WEAKENING" : "tightening";
  return `${direction}: ${change.assetKind} ${change.thresholdType} ${change.from.value} (${change.from.source}) -> ${change.to.value} (${change.to.source}); ${formatMarkdownInlineCode(change.configKey)}`;
}

function formatMetadataPolicySection(
  policy: MetadataPolicyCiEvaluation,
  changes: readonly MetadataPolicyRequiredFieldChange[],
): string[] {
  const { from, to, effective } = policy.configured;
  return [
    "## Required Metadata Policy",
    "",
    `- Configured CI review policy: ${from} -> ${to}`,
    `- Effective CI review policy: ${effective}`,
    `- Policy outcome: ${policy.outcome.toUpperCase()}`,
    `- Mode-transition direction: ${policy.modeTransition.direction}`,
    `- Required-field removals: ${policy.requiredFieldChanges.weakenings}`,
    `- Required-field additions: ${policy.requiredFieldChanges.tightenings}`,
    `- Evaluator matches: ${policy.matchCount}`,
    ...(effective === "off" && policy.matchCount > 0
      ? ["- CI status effect: none — gate disabled"]
      : []),
    "",
    ...changes
      .slice(0, MAX_LIST_ITEMS)
      .map((change) => `- ${formatMetadataPolicyChange(change)}`),
    ...formatOverflow(changes.length),
  ];
}

function formatMetadataPolicyChange(
  change: MetadataPolicyRequiredFieldChange,
): string {
  const direction =
    change.direction === "weakening" ? "WEAKENING" : "tightening";
  return `${direction}: required ${formatMarkdownInlineCode(change.field)} ${formatMetadataPolicyEndpoint(change.from)} -> ${formatMetadataPolicyEndpoint(change.to)}; ${formatMarkdownInlineCode(change.configKey)}`;
}

function formatDiagnosticSeverityPolicySection(
  policy: DiagnosticSeverityCiEvaluation,
  changes: readonly DiagnosticSeverityPolicyChange[],
): string[] {
  const { from, to, effective } = policy.configured;
  const impact = [
    ...(policy.severityChanges.tightenings > 0
      ? [
          "Severity tightening is non-blocking by itself; higher-severity findings can change CI failure behavior.",
        ]
      : []),
    ...(policy.matchCount > 0
      ? [
          effective === "off"
            ? "CI status effect: none — gate disabled."
            : `CI status effect: ${policy.outcome.toUpperCase()} — effective CI review policy: ${effective}.`,
        ]
      : []),
  ];
  return [
    "## Diagnostic Severity Policy",
    "",
    ...(changes.length > 0
      ? [
          "Configuration keys: `diagnostics.severity.<Diagnostic>`.",
          "",
          "| Diagnostic | Previous | Current | Change |",
          "| --- | --- | --- | --- |",
          ...changes
            .slice(0, MAX_LIST_ITEMS)
            .map(formatDiagnosticSeverityPolicyChange),
          "",
        ]
      : []),
    ...(impact.length > 0 ? [`> ${impact.join(" ")}`, ""] : []),
    ...formatOverflow(changes.length),
    `- Configured CI review policy: ${from} -> ${to}; Effective CI review policy: ${effective}; Policy outcome: ${policy.outcome.toUpperCase()}`,
    `- Mode-transition direction: ${policy.modeTransition.direction}; Evaluator matches: ${policy.matchCount}`,
    `- Severity weakenings: ${policy.severityChanges.weakenings}; Severity strengthenings: ${policy.severityChanges.tightenings}; Severity neutral changes: ${policy.severityChanges.neutrals}; Severity review-required changes: ${policy.severityChanges.reviewRequired}`,
  ];
}

function formatDiagnosticSeverityPolicyChange(
  change: DiagnosticSeverityPolicyChange,
): string {
  const direction =
    change.direction === "weakening"
      ? "↓ WEAKENING"
      : change.direction === "tightening"
        ? "↑ tightening"
        : change.direction === "neutral"
          ? "neutral"
          : "REVIEW REQUIRED";
  const from = change.from.severity ?? "unknown producer default";
  const to = change.to.severity ?? "unknown producer default";
  const diagnostic = formatMarkdownInlineCode(change.diagnosticId).replaceAll(
    "|",
    "\\|",
  );
  return `| ${diagnostic} | ${from} (${change.from.source}) | ${to} (${change.to.source}) | ${direction} |`;
}

function formatMetadataPolicyEndpoint(
  endpoint: MetadataPolicyRequiredFieldChange["from"],
): string {
  if (endpoint.provenance.source === "renma_default") {
    return `${endpoint.required ? "required" : "not required"} (renma default)`;
  }
  return `${endpoint.required ? "required" : "not required"} (repository configuration ${formatMarkdownInlineCode(endpoint.provenance.configPath ?? "(explicit config path)")})`;
}

function formatExecutableSurfaceCiPolicySection(
  policy: ExecutableSurfaceCiEvaluation,
): string[] {
  const { from, to, effective } = policy.configured;
  return [
    "## Executable Surface CI Policy",
    "",
    `- Configured: ${from} -> ${to}`,
    `- Effective: ${effective}`,
    `- Outcome: ${policy.outcome.toUpperCase()}`,
    `- Matches: ${policy.matchCount}`,
    ...(policy.matchCount > 0
      ? [
          "",
          ...policy.matches
            .slice(0, MAX_LIST_ITEMS)
            .map((match) => `- ${formatExecutableSurfaceCiMatch(match)}`),
          ...formatOverflow(policy.matches.length),
        ]
      : []),
  ];
}

function formatExecutableSurfaceCiMatch(
  match: ExecutableSurfaceCiMatch,
): string {
  const id = formatMarkdownInlineCode(match.id);
  if (match.kind === "surface") {
    return `${id}: ${formatMarkdownInlineCode(match.path)}`;
  }
  const location = formatMarkdownInlineCode(
    `${match.sourcePath}:L${"line" in match ? match.line : match.toLine}`,
  );
  const target = formatMarkdownInlineCode(match.target);
  if (
    match.id === EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_INVOCATION_ADDED
  ) {
    return `${id}: ${location} -> ${target} (${match.resolution})`;
  }
  if (
    match.id === EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_DEPENDENCY_ADDED
  ) {
    return `${id}: ${location} ${match.analyzer} ${match.relation} -> ${target} (${match.resolution})`;
  }
  if (match.transition === "added") {
    return `${id}: ${location} -> ${target}; effective fingerprints: ${match.distinctEffectivePolicyFingerprints.length}`;
  }
  return `${id}: ${location} -> ${target}; policy evidence ${match.fromHasEffectivePolicyEvidence ? "present" : "missing"} -> ${match.toHasEffectivePolicyEvidence ? "present" : "missing"}; effective fingerprints ${match.fromDistinctEffectivePolicyFingerprints.length} -> ${match.toDistinctEffectivePolicyFingerprints.length}`;
}

function formatScanBoundaryWeakeningSection(
  policy: ScanBoundaryCiEvaluation,
): string[] {
  const { from, to, effective } = policy.configured;
  const configured =
    from === to
      ? [`- CI review policy: ${from}`]
      : [
          `- CI review policy: ${from} -> ${to}`,
          `- Effective CI review policy: ${effective}`,
        ];
  const boundary = policy.effectiveBoundary;
  return [
    "## Scan Boundary Weakening",
    "",
    ...configured,
    ...(effective === "off"
      ? ["- CI status effect: none — gate disabled; explicit review required"]
      : [`- Policy outcome: ${policy.outcome.toUpperCase()}`]),
    ...(boundary
      ? [
          `- Enforcement coverage: endpoint-boundary union over ${boundary.inspectedPaths.length} inspected target paths`,
          `- Enforcement suppressions trusted on both revisions: ${boundary.activeSuppressions.length}`,
        ]
      : []),
    "",
    ...policy.matches
      .slice(0, MAX_LIST_ITEMS)
      .map((match) => `- ${formatScanBoundaryCiMatch(match)}`),
    ...formatOverflow(policy.matches.length),
  ];
}

function formatScanBoundaryCiMatch(match: ScanBoundaryCiMatch): string {
  const change = match.change;
  if (change.kind === "glob") {
    return `include glob removed: ${formatMarkdownInlineCode(change.pattern)} (${match.id})`;
  }
  if (change.kind === "exclusion") {
    return `exclusion added: ${formatMarkdownInlineCode(change.pattern)} (${match.id})`;
  }
  if (change.kind === "limit") {
    const label =
      change.property === "maxDepth" ? "max depth" : "max file size bytes";
    return `${label}: ${change.from} -> ${change.to} (${match.id})`;
  }
  const expires =
    change.suppression.fromExpires === null
      ? `expires ${change.suppression.toExpires}`
      : `expires ${change.suppression.fromExpires} -> ${change.suppression.toExpires}`;
  return `suppression ${formatMarkdownInlineCode(change.suppression.id)} at ${formatMarkdownInlineCode(change.suppression.path)}; ${expires} (${match.id})`;
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
