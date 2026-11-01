import type { ExecutableSurfaceDiff } from "../executable-surface-diff.js";
import { MAX_LIST_ITEMS, formatOverflow } from "./ci-report-list.js";

export type CiCompatibleExecutableSurfaceDiff = Omit<
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
  appendSurfacePaths(
    lines,
    "Added executable surfaces",
    executableSurface.addedSurfacePaths,
  );
  appendSurfacePaths(
    lines,
    "Removed executable surfaces",
    executableSurface.removedSurfacePaths,
  );
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
    ExecutableSurfaceDiff["newInvocationsWithMultipleEffectivePolicyFingerprints"]
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
    ExecutableSurfaceDiff["newInvocationsWithoutEffectivePolicyEvidence"]
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
    ExecutableSurfaceDiff["invocationGovernanceChanges"]
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

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return String(value);
  return "+0";
}
