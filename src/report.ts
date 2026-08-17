import type { ScanResult } from "./types/scan-result.js";
import type {
  ExecutableSurfaceEntry,
  ExecutableSurfaceDependency,
  ExecutableSurfaceInventory,
  ExecutableSurfaceInvocation,
} from "./executable-surface-inventory.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import { visibleMarkdownInlineValue } from "./renderers/markdown-inline-code.js";

const EXECUTABLE_SURFACE_TEXT_LIMIT =
  DEFAULT_QUALITY_PROFILE.presentation.topSummaryItemCap;

interface ExecutableSurfaceTextReview {
  requiresReview: boolean;
  surfacePaths: string[];
  invocations: ExecutableSurfaceInvocation[];
  dependencies: ExecutableSurfaceDependency[];
}

/** Format one complete JSON document with two-space indentation and one newline. */
export function formatJsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Add a schema identity at a public JSON boundary without mutating its model. */
export function formatVersionedJsonDocument(
  schemaVersion: string,
  value: object,
): string {
  return formatJsonDocument(
    Object.assign({ schemaVersion }, value, { schemaVersion }),
  );
}

export const SCAN_JSON_SCHEMA_VERSION = "renma.scan.v1" as const;

/** Format a scan result as pretty-printed JSON. */
export function formatJson(result: ScanResult): string {
  return formatVersionedJsonDocument(SCAN_JSON_SCHEMA_VERSION, result);
}

/** Format a scan result as human-readable terminal text. */
export function formatText(result: ScanResult): string {
  const lines = [
    `Renma scan`,
    `Root: ${result.root}`,
    `Config: ${result.configPath ?? "(defaults)"}`,
    `Scan boundary: ${result.scanBoundary.globs.length} include globs, ${result.scanBoundary.exclude.length} exclusions, max depth ${result.scanBoundary.maxDepth}, max file size ${result.scanBoundary.maxFileSizeBytes} bytes, ${result.scanBoundary.activeSuppressions.length} active suppressions`,
    `Files scanned: ${result.scannedFileCount}`,
    `Inspection coverage: ${result.inspectionCoverage.inspectedPathCount}/${result.inspectionCoverage.expectedPathCount} expected agent-facing paths inspected (${result.inspectionCoverage.blockingIssues.length} blocking issues)`,
    `Agent Skills: ${result.agentSkills.validSkillCount}/${result.agentSkills.totalSkillCount} valid (${result.agentSkills.invalidSkillCount} invalid, ${result.agentSkills.legacySkillCount} legacy, ${result.agentSkills.hybridSkillCount} hybrid)`,
    ...(result.contextLens
      ? [
          `Context lenses: ${result.contextLens.validLensCount}/${result.contextLens.totalLensCount} valid (${result.contextLens.invalidLensCount} invalid)`,
          `Context lens diagnostics: error ${result.contextLens.diagnosticCounts.error}, warning ${result.contextLens.diagnosticCounts.warning}, info ${result.contextLens.diagnosticCounts.info}`,
        ]
      : []),
    `Diagnostics: ${result.diagnostics.length}`,
    `Exit threshold: ${result.exitThreshold}`,
    `Findings: ${result.findings.length}`,
    `Suppressed findings retained: ${result.suppressedFindings.length}`,
    ...(result.executableSurfaceInventory
      ? formatExecutableSurfaceInventoryText(result.executableSurfaceInventory)
      : []),
  ];

  for (const skill of result.agentSkills.results) {
    if (skill.issues.length === 0) continue;
    lines.push("");
    lines.push(`${skill.valid ? "VALID" : "INVALID"} ${skill.path}`);
    for (const issue of skill.issues) {
      lines.push(
        `  ${issue.severity.toUpperCase()} ${issue.code} L${issue.startLine}: ${issue.message}`,
      );
    }
    if (skill.migrationCommand) {
      lines.push("");
      lines.push("  Migration:");
      lines.push(`    ${skill.migrationCommand.display}`);
    }
  }

  if (result.inspectionCoverage.blockingIssues.length > 0) {
    lines.push("", "Inspection Coverage Issues");
    for (const issue of result.inspectionCoverage.blockingIssues) {
      const scope =
        issue.scope === "subtree"
          ? `subtree; ${issue.affectedBoundary ?? "agent-facing"} boundary`
          : `exact ${issue.classification.kind}`;
      lines.push(
        `  BLOCKING ${issue.path}: ${issue.state} (${scope}) — ${issue.reason}`,
      );
    }
  }

  if (result.findings.length === 0) {
    lines.push(
      result.inspectionCoverage.complete
        ? "No rule findings after complete inspection."
        : "No rule findings, but expected agent-facing content could not be inspected.",
    );
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

  for (const item of result.suppressedFindings) {
    lines.push("");
    lines.push(
      `SUPPRESSED ${item.finding.severity.toUpperCase()} ${item.finding.id}: ${item.finding.title}`,
    );
    lines.push(
      `  ${item.finding.evidence.path}:${item.finding.evidence.startLine}`,
    );
    lines.push(
      `  suppression: ${item.suppression.matchedPath}; expires ${item.suppression.expires}; reason: ${visibleMarkdownInlineValue(item.suppression.reason)}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/** Render the action-oriented executable-surface projection for scan text. */
export function formatExecutableSurfaceInventoryText(
  inventory: ExecutableSurfaceInventory,
): string[] {
  const compactSummary = formatExecutableSurfaceCompactSummary(inventory);
  const review = executableSurfaceTextReview(inventory);
  if (!review.requiresReview) return [compactSummary];

  const surfacesByPath = new Map(
    inventory.surfaces.map((surface) => [surface.path, surface]),
  );
  const reviewSurfaces = review.surfacePaths.flatMap((surfacePath) => {
    const surface = surfacesByPath.get(surfacePath);
    return surface ? [surface] : [];
  });
  const lines = ["", "Executable Surface Review", `  ${compactSummary}`];
  if (reviewSurfaces.length > 0) {
    lines.push(
      "  Review surfaces:",
      ...reviewSurfaces
        .slice(0, EXECUTABLE_SURFACE_TEXT_LIMIT)
        .map(formatExecutableSurfaceReviewRow),
      ...formatExecutableSurfaceTextOverflow(reviewSurfaces.length),
    );
  }
  if (review.invocations.length > 0) {
    lines.push(
      "  Review invocations:",
      ...review.invocations
        .slice(0, EXECUTABLE_SURFACE_TEXT_LIMIT)
        .map(formatExecutableInvocationReviewRow),
      ...formatExecutableSurfaceTextOverflow(review.invocations.length),
    );
  }
  if (review.dependencies.length > 0) {
    lines.push(
      "  Review dependencies:",
      ...review.dependencies
        .slice(0, EXECUTABLE_SURFACE_TEXT_LIMIT)
        .map(formatExecutableDependencyReviewRow),
      ...formatExecutableSurfaceTextOverflow(review.dependencies.length),
    );
  }
  return lines;
}

function formatExecutableSurfaceCompactSummary(
  inventory: ExecutableSurfaceInventory,
): string {
  const summary = inventory.summary;
  if (summary.totalSurfaces === 0) return "Executable surfaces: 0";
  if (summary.totalInvocations === 0) {
    return `Executable surfaces: ${summary.totalSurfaces}; no recognized invocations; ${summary.transitivelyReachableSurfaces} transitively reachable`;
  }
  return `Executable surfaces: ${summary.totalSurfaces}; static reachability ${summary.directlyInvokedSurfaces} direct, ${summary.transitivelyReachableSurfaces} transitive; invocations ${summary.resolvedInvocations}/${summary.totalInvocations} resolved; invocation-context policy evidence ${summary.invocationsWithEffectivePolicyEvidence}/${summary.totalInvocations}`;
}

function executableSurfaceTextReview(
  inventory: ExecutableSurfaceInventory,
): ExecutableSurfaceTextReview {
  const reviewInvocations = inventory.invocations
    .filter(invocationRequiresExecutableSurfaceReview)
    .sort(compareExecutableSurfaceReviewInvocations);
  const reviewDependencies = inventory.dependencies
    .filter((dependency) => dependency.resolution !== "resolved")
    .sort(compareExecutableSurfaceReviewDependencies);
  const surfacePaths = new Set(
    inventory.surfaces
      .filter(surfaceRequiresExecutableSurfaceReview)
      .map((surface) => surface.path),
  );
  const knownSurfacePaths = new Set(
    inventory.surfaces.map((surface) => surface.path),
  );
  for (const invocation of reviewInvocations) {
    if (
      invocation.normalizedTarget &&
      knownSurfacePaths.has(invocation.normalizedTarget)
    ) {
      surfacePaths.add(invocation.normalizedTarget);
    }
  }
  const orderedSurfacePaths = [...surfacePaths].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    requiresReview:
      orderedSurfacePaths.length > 0 ||
      reviewInvocations.length > 0 ||
      reviewDependencies.length > 0,
    surfacePaths: orderedSurfacePaths,
    invocations: reviewInvocations,
    dependencies: reviewDependencies,
  };
}

function surfaceRequiresExecutableSurfaceReview(
  surface: ExecutableSurfaceEntry,
): boolean {
  return (
    surface.scope === "noncanonical" ||
    (surface.scope === "skill-local" &&
      surface.reachableFromOwningSkill === false)
  );
}

function invocationRequiresExecutableSurfaceReview(
  invocation: ExecutableSurfaceInvocation,
): boolean {
  return (
    invocation.resolution !== "resolved" ||
    !invocation.governance.hasEffectivePolicyEvidence ||
    invocation.governance.distinctEffectivePolicyFingerprints.length > 1
  );
}

function formatExecutableSurfaceReviewRow(
  surface: ExecutableSurfaceEntry,
): string {
  const reachability =
    surface.scope === "skill-local"
      ? surface.reachableFromOwningSkill
        ? `reachable@${surface.reachabilityDepth}`
        : "unreachable"
      : "n/a";
  return `  - ${surface.path} [${surface.scope}; ${surface.interpreterHints.join(",")}; reachability ${reachability}; invocations ${surface.invocationCount}; surface-policy ${surface.securityPolicy.hasEffectivePolicy ? "effective" : "none"}; invocation-policy ${surface.invocationGovernance.invocationsWithEffectivePolicyEvidence}/${surface.invocationCount}; policy-variants ${surface.invocationGovernance.distinctEffectivePolicyFingerprints.length}]`;
}

function formatExecutableInvocationReviewRow(
  invocation: ExecutableSurfaceInvocation,
): string {
  const target = invocation.normalizedTarget ?? invocation.rawTarget;
  return `  - ${invocation.sourcePath}:L${invocation.line} ${invocation.launcher} ${target} [resolution ${invocation.resolution}; invocation-context policy evidence ${invocation.governance.hasEffectivePolicyEvidence ? "with" : "without"}; policy-variants ${invocation.governance.distinctEffectivePolicyFingerprints.length}; owning-skill ${invocation.governance.owningSkillResolution}]`;
}

function formatExecutableDependencyReviewRow(
  dependency: ExecutableSurfaceDependency,
): string {
  const candidates = dependency.normalizedTargetCandidates.join(", ");
  const target =
    dependency.normalizedTarget ?? (candidates || dependency.rawSpecifier);
  return `  - ${dependency.sourcePath}:L${dependency.line} ${dependency.analyzer} ${dependency.relation} ${target} [resolution ${dependency.resolution}]`;
}

function compareExecutableSurfaceReviewDependencies(
  left: ExecutableSurfaceDependency,
  right: ExecutableSurfaceDependency,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.analyzer.localeCompare(right.analyzer) ||
    left.relation.localeCompare(right.relation) ||
    (
      left.normalizedTarget ?? left.normalizedTargetCandidates.join("\0")
    ).localeCompare(
      right.normalizedTarget ?? right.normalizedTargetCandidates.join("\0"),
    )
  );
}

function compareExecutableSurfaceReviewInvocations(
  left: ExecutableSurfaceInvocation,
  right: ExecutableSurfaceInvocation,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.launcher.localeCompare(right.launcher) ||
    (left.normalizedTarget ?? left.rawTarget).localeCompare(
      right.normalizedTarget ?? right.rawTarget,
    ) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function formatExecutableSurfaceTextOverflow(length: number): string[] {
  if (length <= EXECUTABLE_SURFACE_TEXT_LIMIT) return [];
  return [
    `  - ${length - EXECUTABLE_SURFACE_TEXT_LIMIT} more not shown; use scan JSON for complete evidence.`,
  ];
}
