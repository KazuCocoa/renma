import type { ExecutableSurfaceDiff } from "../executable-surface-diff.js";

export function formatExecutableSurfaceChanges(
  executableSurface: ExecutableSurfaceDiff,
): string[] {
  const invocationGovernanceChanges =
    executableSurface.invocationGovernanceChanges ?? [];
  const lines = [
    "## Executable Surface Changes",
    "",
    `- Total surfaces: ${executableSurface.toSummary.totalSurfaces} (${signed(executableSurface.summary.totalSurfacesDelta)})`,
    `- Added surfaces: ${executableSurface.addedSurfacePaths.length}`,
    `- Removed surfaces: ${executableSurface.removedSurfacePaths.length}`,
    `- Changed surfaces: ${executableSurface.changedSurfaces.length}`,
    `- Dependencies: ${executableSurface.fromSummary.totalDependencies} -> ${executableSurface.toSummary.totalDependencies} (${signed(executableSurface.summary.totalDependenciesDelta)})`,
    `- Resolved dependencies: ${executableSurface.fromSummary.resolvedDependencies} -> ${executableSurface.toSummary.resolvedDependencies} (${signed(executableSurface.summary.resolvedDependenciesDelta)})`,
    `- Dependency resolution changes: ${executableSurface.dependencyResolutionChanges.length}`,
    `- Static invocation reachability: ${executableSurface.toSummary.directlyInvokedSurfaces} direct, ${executableSurface.toSummary.transitivelyReachableSurfaces} transitive, ${executableSurface.toSummary.unreachedFromInvocationSurfaces} unreached`,
    `- Invocation resolution changes: ${executableSurface.invocationResolutionChanges.length}`,
    `- Invocation governance changes: ${invocationGovernanceChanges.length}`,
    `- Invocation-context policy evidence: ${executableSurface.toSummary.invocationsWithEffectivePolicyEvidence ?? 0} with (${signed(executableSurface.summary.invocationsWithEffectivePolicyEvidenceDelta ?? 0)}), ${executableSurface.toSummary.invocationsWithoutEffectivePolicyEvidence ?? 0} without (${signed(executableSurface.summary.invocationsWithoutEffectivePolicyEvidenceDelta ?? 0)})`,
    `- Resolved invocation policy evidence: ${executableSurface.toSummary.resolvedInvocationsWithEffectivePolicyEvidence ?? 0} with (${signed(executableSurface.summary.resolvedInvocationsWithEffectivePolicyEvidenceDelta ?? 0)}), ${executableSurface.toSummary.resolvedInvocationsWithoutEffectivePolicyEvidence ?? 0} without (${signed(executableSurface.summary.resolvedInvocationsWithoutEffectivePolicyEvidenceDelta ?? 0)})`,
    `- Surface policy evidence: ${executableSurface.toSummary.surfacesWithEffectivePolicy}/${executableSurface.toSummary.totalSurfaces} (${signed(executableSurface.summary.surfacesWithEffectivePolicyDelta)} surfaces with evidence)`,
  ];
  appendDetails(
    lines,
    "### Added executable surfaces",
    executableSurface.addedSurfacePaths,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "### Removed executable surfaces",
    executableSurface.removedSurfacePaths,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "### Changed executable surfaces",
    executableSurface.changedSurfaces,
    (surface) => `- \`${surface.path}\`: ${surface.reasons.join(", ")}`,
  );
  appendDetails(
    lines,
    "### Invocation resolution changes",
    executableSurface.invocationResolutionChanges,
    (invocation) =>
      `- \`${invocation.sourcePath}\` ${invocation.launcher} \`${invocation.target}\` #${invocation.occurrenceOrdinal}: ${invocation.fromResolution} -> ${invocation.toResolution}`,
  );
  appendDetails(
    lines,
    "### Added executable dependencies",
    executableSurface.addedDependencies,
    (dependency) =>
      `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\` #${dependency.occurrenceOrdinal}: ${dependency.resolution}`,
  );
  appendDetails(
    lines,
    "### Removed executable dependencies",
    executableSurface.removedDependencies,
    (dependency) =>
      `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\` #${dependency.occurrenceOrdinal}: ${dependency.resolution}`,
  );
  appendDetails(
    lines,
    "### Executable dependency resolution changes",
    executableSurface.dependencyResolutionChanges,
    (dependency) =>
      `- \`${dependency.sourcePath}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\` #${dependency.occurrenceOrdinal}: ${dependency.fromResolution} -> ${dependency.toResolution}`,
  );
  appendDetails(
    lines,
    "### New dependency evidence for review",
    executableSurface.newProblematicDependencies,
    (dependency) =>
      `- \`${dependency.sourcePath}:L${dependency.line}\` ${dependency.analyzer} ${dependency.relation} \`${dependency.target}\`: ${dependency.resolution}`,
  );
  appendDetails(
    lines,
    "### Newly transitively reachable executable surfaces",
    executableSurface.newlyTransitivelyReachableSurfacePaths,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "### Executable surfaces that lost static invocation reachability",
    executableSurface.surfacesLostStaticInvocationReachability,
    (surfacePath) => `- \`${surfacePath}\``,
  );
  appendDetails(
    lines,
    "### Invocation governance changes",
    invocationGovernanceChanges,
    (invocation) =>
      `- \`${invocation.sourcePath}\` ${invocation.launcher} \`${invocation.target}\` #${invocation.occurrenceOrdinal}: policy evidence ${invocation.fromHasEffectivePolicyEvidence ? "with" : "without"} -> ${invocation.toHasEffectivePolicyEvidence ? "with" : "without"}; owning Skill ${invocation.fromOwningSkillResolution} -> ${invocation.toOwningSkillResolution}; effective fingerprints ${invocation.fromDistinctEffectivePolicyFingerprints.length} -> ${invocation.toDistinctEffectivePolicyFingerprints.length}`,
  );
  return lines;
}

// Unlike the CI summary, semantic diff details retain every item.
function appendDetails<T>(
  lines: string[],
  heading: string,
  items: readonly T[],
  format: (item: T) => string,
): void {
  if (items.length === 0) return;
  lines.push("", heading, "", ...items.map(format));
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
