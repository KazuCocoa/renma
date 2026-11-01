import type { ExecutableSurfaceDiff } from "../executable-surface-diff.js";
import { MAX_LIST_ITEMS, formatOverflow } from "./ci-report-list.js";

type OptionalCiExecutableFields =
  | "newInvocationsWithMultipleEffectivePolicyFingerprints"
  | "addedDependencies"
  | "removedDependencies"
  | "dependencyResolutionChanges"
  | "newProblematicDependencies"
  | "newlyTransitivelyReachableSurfacePaths"
  | "surfacesLostStaticInvocationReachability"
  | "invocationDependencyDepthChanges";

export type CiCompatibleExecutableSurfaceDiff = Omit<
  ExecutableSurfaceDiff,
  OptionalCiExecutableFields
> &
  Partial<Pick<ExecutableSurfaceDiff, OptionalCiExecutableFields>>;

export function formatExecutableSurfaceChanges(
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
  appendDetails(
    lines,
    "Added executable surfaces",
    executableSurface.addedSurfacePaths,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "Removed executable surfaces",
    executableSurface.removedSurfacePaths,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "Changed executable surfaces",
    executableSurface.changedSurfaces,
    (surface) => `- \`${surface.path}\`: ${surface.reasons.join(", ")}`,
  );
  appendDetails(
    lines,
    "New unresolved or unavailable invocations",
    executableSurface.newProblematicInvocations,
    (invocation) =>
      `- \`${invocation.sourcePath}:L${invocation.line}\` ${invocation.launcher} \`${invocation.target}\`: ${invocation.resolution}`,
  );
  appendDetails(
    lines,
    "New executable dependency evidence for review",
    newProblematicDependencies,
    (dependency) =>
      `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\`: ${dependency.resolution}`,
  );
  appendDetails(
    lines,
    "Executable dependency resolution changes",
    dependencyResolutionChanges,
    (dependency) =>
      `- \`${dependency.sourcePath}:L${dependency.toLine}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\`: ${dependency.fromResolution} -> ${dependency.toResolution}`,
  );
  appendDetails(
    lines,
    "Newly transitively reachable executable surfaces",
    newlyTransitive,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "Executable surfaces that lost static invocation reachability",
    lostReachability,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "New invocations without effective policy evidence",
    newWithout,
    (invocation) =>
      `- \`${invocation.sourcePath}:L${invocation.line}\` ${invocation.launcher} \`${invocation.target}\`: without effective policy evidence; owning Skill ${invocation.owningSkillResolution}; effective fingerprints ${invocation.distinctEffectivePolicyFingerprints.length}`,
  );
  appendDetails(
    lines,
    "Invocations that gained effective policy evidence",
    gained,
    formatInvocationGovernanceChange,
  );
  appendDetails(
    lines,
    "Invocations that lost effective policy evidence",
    lost,
    formatInvocationGovernanceChange,
  );
  appendDetails(
    lines,
    "New invocations with multiple effective fingerprints",
    newMultiple,
    (invocation) =>
      `- \`${invocation.sourcePath}:L${invocation.line}\` ${invocation.launcher} \`${invocation.target}\`: owning Skill ${invocation.owningSkillResolution}; effective fingerprints ${invocation.distinctEffectivePolicyFingerprints.length}`,
  );
  appendDetails(
    lines,
    "Invocation governance changes with multiple effective fingerprints",
    multiple,
    formatInvocationGovernanceChange,
  );
  return lines;
}

// CI details share one presentation cap; full semantic diff keeps its own renderer.
function appendDetails<T>(
  lines: string[],
  heading: string,
  items: readonly T[],
  format: (item: T) => string,
): void {
  if (items.length === 0) return;
  lines.push(
    "",
    `### ${heading}`,
    "",
    ...items.slice(0, MAX_LIST_ITEMS).map(format),
    ...formatOverflow(items.length),
  );
}

function formatInvocationGovernanceChange(
  invocation: NonNullable<
    ExecutableSurfaceDiff["invocationGovernanceChanges"]
  >[number],
): string {
  return `- \`${invocation.sourcePath}:L${invocation.toLine}\` ${invocation.launcher} \`${invocation.target}\`: policy evidence ${invocation.fromHasEffectivePolicyEvidence ? "with" : "without"} -> ${invocation.toHasEffectivePolicyEvidence ? "with" : "without"}; owning Skill ${invocation.fromOwningSkillResolution} -> ${invocation.toOwningSkillResolution}; effective fingerprints ${invocation.fromDistinctEffectivePolicyFingerprints.length} -> ${invocation.toDistinctEffectivePolicyFingerprints.length}`;
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return String(value);
  return "+0";
}
