import type {
  ExecutableInvocationGovernance,
  ExecutableInvocationOwningSkillResolution,
  ExecutableSurfaceEntry,
  ExecutableSurfaceInventory,
  ExecutableSurfaceInventorySummary,
  ExecutableSurfaceInvocation,
  ExecutableSurfaceDependency,
  ExecutableSurfaceDependencyResolution,
  StaticInvocationReachability,
} from "./executable-surface-inventory.js";

export type ExecutableSurfaceChangeReason =
  | "content"
  | "scope"
  | "interpreter"
  | "reachability"
  | "references"
  | "invocations"
  | "invocation-governance"
  | "dependency-graph"
  | "invocation-reachability"
  | "security-policy";

export interface ExecutableSurfaceChange {
  path: string;
  reasons: ExecutableSurfaceChangeReason[];
  fromFingerprint: string;
  toFingerprint: string;
}

export interface ExecutableSurfaceInvocationDelta {
  sourcePath: string;
  launcher: string;
  target: string;
  occurrenceOrdinal: number;
  resolution: ExecutableSurfaceInvocation["resolution"];
  line: number;
}

export interface ExecutableSurfaceInvocationResolutionChange {
  sourcePath: string;
  launcher: string;
  target: string;
  occurrenceOrdinal: number;
  fromResolution: ExecutableSurfaceInvocation["resolution"];
  toResolution: ExecutableSurfaceInvocation["resolution"];
  fromLine: number;
  toLine: number;
}

export interface ExecutableSurfaceDependencyDelta {
  sourcePath: string;
  analyzer: ExecutableSurfaceDependency["analyzer"];
  relation: ExecutableSurfaceDependency["relation"];
  target: string;
  occurrenceOrdinal: number;
  resolution: ExecutableSurfaceDependencyResolution;
  line: number;
}

export interface ExecutableSurfaceDependencyResolutionChange {
  sourcePath: string;
  analyzer: ExecutableSurfaceDependency["analyzer"];
  relation: ExecutableSurfaceDependency["relation"];
  target: string;
  occurrenceOrdinal: number;
  fromResolution: ExecutableSurfaceDependencyResolution;
  toResolution: ExecutableSurfaceDependencyResolution;
  fromLine: number;
  toLine: number;
}

export interface ExecutableSurfaceInvocationDepthChange {
  path: string;
  fromReachability: StaticInvocationReachability;
  toReachability: StaticInvocationReachability;
  fromDepth?: number;
  toDepth?: number;
}

export interface ExecutableInvocationGovernanceDelta {
  sourcePath: string;
  launcher: string;
  target: string;
  occurrenceOrdinal: number;
  hasEffectivePolicyEvidence: boolean;
  distinctEffectivePolicyFingerprints: string[];
  owningSkillResolution: ExecutableInvocationOwningSkillResolution;
  resolution: ExecutableSurfaceInvocation["resolution"];
  line: number;
}

export interface ExecutableInvocationGovernanceChange {
  sourcePath: string;
  launcher: string;
  target: string;
  occurrenceOrdinal: number;
  fromHasEffectivePolicyEvidence: boolean;
  toHasEffectivePolicyEvidence: boolean;
  fromDistinctEffectivePolicyFingerprints: string[];
  toDistinctEffectivePolicyFingerprints: string[];
  fromOwningSkillResolution: ExecutableInvocationOwningSkillResolution;
  toOwningSkillResolution: ExecutableInvocationOwningSkillResolution;
  fromGovernanceFingerprint: string;
  toGovernanceFingerprint: string;
  fromLine: number;
  toLine: number;
}

export interface ExecutableSurfaceDiff {
  summary: {
    totalSurfacesDelta: number;
    skillLocalSurfacesDelta: number;
    repositoryToolSurfacesDelta: number;
    noncanonicalSurfacesDelta: number;
    reachableSkillLocalSurfacesDelta: number;
    unreachableSkillLocalSurfacesDelta: number;
    referencedSurfacesDelta: number;
    invokedSurfacesDelta: number;
    surfacesWithEffectivePolicyDelta: number;
    surfacesWithoutEffectivePolicyDelta: number;
    totalInvocationsDelta: number;
    resolvedInvocationsDelta: number;
    missingInvocationsDelta: number;
    unsafeInvocationsDelta: number;
    unscopedInvocationsDelta: number;
    noncanonicalInvocationsDelta: number;
    unavailableInvocationsDelta: number;
    invocationsWithEffectivePolicyEvidenceDelta: number;
    invocationsWithoutEffectivePolicyEvidenceDelta: number;
    resolvedInvocationsWithEffectivePolicyEvidenceDelta: number;
    resolvedInvocationsWithoutEffectivePolicyEvidenceDelta: number;
    invocationsWithMultipleEffectivePolicyFingerprintsDelta: number;
    sourceArtifactPolicyEvidenceRelationsDelta: number;
    owningSkillPolicyEvidenceRelationsDelta: number;
    effectivePolicyCoverageDelta: number;
    totalDependenciesDelta: number;
    resolvedDependenciesDelta: number;
    missingDependenciesDelta: number;
    unsafeDependenciesDelta: number;
    ambiguousDependenciesDelta: number;
    noncanonicalDependenciesDelta: number;
    notInventoryDependenciesDelta: number;
    unavailableDependenciesDelta: number;
    directlyInvokedSurfacesDelta: number;
    transitivelyReachableSurfacesDelta: number;
    unreachedFromInvocationSurfacesDelta: number;
  };
  fromSummary: ExecutableSurfaceInventorySummary;
  toSummary: ExecutableSurfaceInventorySummary;
  addedSurfacePaths: string[];
  removedSurfacePaths: string[];
  changedSurfaces: ExecutableSurfaceChange[];
  invocationResolutionChanges: ExecutableSurfaceInvocationResolutionChange[];
  invocationGovernanceChanges: ExecutableInvocationGovernanceChange[];
  newInvocationsWithoutEffectivePolicyEvidence: ExecutableInvocationGovernanceDelta[];
  newInvocationsWithMultipleEffectivePolicyFingerprints: ExecutableInvocationGovernanceDelta[];
  invocationsGainedEffectivePolicyEvidence: ExecutableInvocationGovernanceChange[];
  invocationsLostEffectivePolicyEvidence: ExecutableInvocationGovernanceChange[];
  invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints: ExecutableInvocationGovernanceChange[];
  newProblematicInvocations: ExecutableSurfaceInvocationDelta[];
  addedDependencies: ExecutableSurfaceDependencyDelta[];
  removedDependencies: ExecutableSurfaceDependencyDelta[];
  dependencyResolutionChanges: ExecutableSurfaceDependencyResolutionChange[];
  newProblematicDependencies: ExecutableSurfaceDependencyDelta[];
  newlyTransitivelyReachableSurfacePaths: string[];
  surfacesLostStaticInvocationReachability: string[];
  invocationDependencyDepthChanges: ExecutableSurfaceInvocationDepthChange[];
  newlyReachableSkillLocalPaths: string[];
  newlyUnreachableSkillLocalPaths: string[];
}

/** Compare semantic surface identity and line-insensitive invocation identity. */
export function buildExecutableSurfaceDiff(
  from: ExecutableSurfaceInventory,
  to: ExecutableSurfaceInventory,
): ExecutableSurfaceDiff {
  const fromSurfaces = new Map(
    from.surfaces.map((surface) => [surface.path, surface]),
  );
  const toSurfaces = new Map(
    to.surfaces.map((surface) => [surface.path, surface]),
  );
  const fromInvocations = semanticInvocationMap(from.invocations);
  const toInvocations = semanticInvocationMap(to.invocations);
  const fromDependencies = semanticDependencyMap(from.dependencies);
  const toDependencies = semanticDependencyMap(to.dependencies);
  const fromDependencyGraphSignatures = dependencyGraphSignatures(from);
  const toDependencyGraphSignatures = dependencyGraphSignatures(to);

  const addedSurfacePaths = [...toSurfaces.keys()]
    .filter((surfacePath) => !fromSurfaces.has(surfacePath))
    .sort((left, right) => left.localeCompare(right));
  const removedSurfacePaths = [...fromSurfaces.keys()]
    .filter((surfacePath) => !toSurfaces.has(surfacePath))
    .sort((left, right) => left.localeCompare(right));
  const changedSurfaces = [...toSurfaces]
    .flatMap(([surfacePath, toSurface]) => {
      const fromSurface = fromSurfaces.get(surfacePath);
      if (!fromSurface || fromSurface.fingerprint === toSurface.fingerprint) {
        return [];
      }
      return [
        {
          path: surfacePath,
          reasons: surfaceChangeReasons(
            fromSurface,
            toSurface,
            fromDependencyGraphSignatures.get(surfacePath) ?? "",
            toDependencyGraphSignatures.get(surfacePath) ?? "",
          ),
          fromFingerprint: fromSurface.fingerprint,
          toFingerprint: toSurface.fingerprint,
        },
      ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const invocationResolutionChanges = [...toInvocations]
    .flatMap(([key, toInvocation]) => {
      const fromInvocation = fromInvocations.get(key);
      if (
        !fromInvocation ||
        fromInvocation.resolution === toInvocation.resolution
      ) {
        return [];
      }
      return [
        {
          sourcePath: toInvocation.sourcePath,
          launcher: toInvocation.launcher,
          target: toInvocation.target,
          occurrenceOrdinal: toInvocation.occurrenceOrdinal,
          fromResolution: fromInvocation.resolution,
          toResolution: toInvocation.resolution,
          fromLine: fromInvocation.line,
          toLine: toInvocation.line,
        },
      ];
    })
    .sort(compareInvocationChanges);
  const invocationGovernanceChanges = [...toInvocations]
    .flatMap(([key, toInvocation]) => {
      const fromInvocation = fromInvocations.get(key);
      if (
        !fromInvocation ||
        fromInvocation.governance.fingerprint ===
          toInvocation.governance.fingerprint
      ) {
        return [];
      }
      return [governanceChange(fromInvocation, toInvocation)];
    })
    .sort(compareGovernanceChanges);
  const newInvocationsWithoutEffectivePolicyEvidence = [...toInvocations]
    .filter(
      ([key, invocation]) =>
        !fromInvocations.has(key) &&
        !invocation.governance.hasEffectivePolicyEvidence,
    )
    .map(([, invocation]) => governanceDelta(invocation))
    .sort(compareGovernanceDeltas);
  const newInvocationsWithMultipleEffectivePolicyFingerprints = [
    ...toInvocations,
  ]
    .filter(
      ([key, invocation]) =>
        !fromInvocations.has(key) &&
        invocation.governance.distinctEffectivePolicyFingerprints.length > 1,
    )
    .map(([, invocation]) => governanceDelta(invocation))
    .sort(compareGovernanceDeltas);
  const invocationsGainedEffectivePolicyEvidence =
    invocationGovernanceChanges.filter(
      (change) =>
        !change.fromHasEffectivePolicyEvidence &&
        change.toHasEffectivePolicyEvidence,
    );
  const invocationsLostEffectivePolicyEvidence =
    invocationGovernanceChanges.filter(
      (change) =>
        change.fromHasEffectivePolicyEvidence &&
        !change.toHasEffectivePolicyEvidence,
    );
  const invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints =
    invocationGovernanceChanges.filter(
      (change) =>
        change.fromDistinctEffectivePolicyFingerprints.length > 1 ||
        change.toDistinctEffectivePolicyFingerprints.length > 1,
    );
  const newProblematicInvocations = [...toInvocations]
    .filter(([key, invocation]) => {
      const previous = fromInvocations.get(key);
      return (
        invocation.resolution !== "resolved" &&
        previous?.resolution !== invocation.resolution
      );
    })
    .map(([, invocation]) => invocation)
    .sort(compareInvocationDeltas);
  const addedDependencies = [...toDependencies]
    .filter(([key]) => !fromDependencies.has(key))
    .map(([, dependency]) => dependencyDelta(dependency))
    .sort(compareDependencyDeltas);
  const removedDependencies = [...fromDependencies]
    .filter(([key]) => !toDependencies.has(key))
    .map(([, dependency]) => dependencyDelta(dependency))
    .sort(compareDependencyDeltas);
  const dependencyResolutionChanges = [...toDependencies]
    .flatMap(([key, toDependency]) => {
      const fromDependency = fromDependencies.get(key);
      if (
        !fromDependency ||
        fromDependency.resolution === toDependency.resolution
      ) {
        return [];
      }
      return [
        {
          sourcePath: toDependency.sourcePath,
          analyzer: toDependency.analyzer,
          relation: toDependency.relation,
          target: toDependency.target,
          occurrenceOrdinal: toDependency.occurrenceOrdinal,
          fromResolution: fromDependency.resolution,
          toResolution: toDependency.resolution,
          fromLine: fromDependency.line,
          toLine: toDependency.line,
        },
      ];
    })
    .sort(compareDependencyChanges);
  const newProblematicDependencies = [...toDependencies]
    .filter(([key, dependency]) => {
      const previous = fromDependencies.get(key);
      return (
        dependency.resolution !== "resolved" &&
        previous?.resolution !== dependency.resolution
      );
    })
    .map(([, dependency]) => dependencyDelta(dependency))
    .sort(compareDependencyDeltas);

  return {
    summary: summaryDelta(from.summary, to.summary),
    fromSummary: from.summary,
    toSummary: to.summary,
    addedSurfacePaths,
    removedSurfacePaths,
    changedSurfaces,
    invocationResolutionChanges,
    invocationGovernanceChanges,
    newInvocationsWithoutEffectivePolicyEvidence,
    newInvocationsWithMultipleEffectivePolicyFingerprints,
    invocationsGainedEffectivePolicyEvidence,
    invocationsLostEffectivePolicyEvidence,
    invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints,
    newProblematicInvocations,
    addedDependencies,
    removedDependencies,
    dependencyResolutionChanges,
    newProblematicDependencies,
    newlyTransitivelyReachableSurfacePaths: staticReachabilityChanges(
      fromSurfaces,
      toSurfaces,
      "transitive",
    ),
    surfacesLostStaticInvocationReachability: lostStaticReachability(
      fromSurfaces,
      toSurfaces,
    ),
    invocationDependencyDepthChanges: invocationDepthChanges(
      fromSurfaces,
      toSurfaces,
    ),
    newlyReachableSkillLocalPaths: reachabilityChanges(
      fromSurfaces,
      toSurfaces,
      true,
    ),
    newlyUnreachableSkillLocalPaths: reachabilityChanges(
      fromSurfaces,
      toSurfaces,
      false,
    ),
  };
}

function summaryDelta(
  from: ExecutableSurfaceInventorySummary,
  to: ExecutableSurfaceInventorySummary,
): ExecutableSurfaceDiff["summary"] {
  return {
    totalSurfacesDelta: to.totalSurfaces - from.totalSurfaces,
    skillLocalSurfacesDelta: to.skillLocalSurfaces - from.skillLocalSurfaces,
    repositoryToolSurfacesDelta:
      to.repositoryToolSurfaces - from.repositoryToolSurfaces,
    noncanonicalSurfacesDelta:
      to.noncanonicalSurfaces - from.noncanonicalSurfaces,
    reachableSkillLocalSurfacesDelta:
      to.reachableSkillLocalSurfaces - from.reachableSkillLocalSurfaces,
    unreachableSkillLocalSurfacesDelta:
      to.unreachableSkillLocalSurfaces - from.unreachableSkillLocalSurfaces,
    referencedSurfacesDelta: to.referencedSurfaces - from.referencedSurfaces,
    invokedSurfacesDelta: to.invokedSurfaces - from.invokedSurfaces,
    surfacesWithEffectivePolicyDelta:
      to.surfacesWithEffectivePolicy - from.surfacesWithEffectivePolicy,
    surfacesWithoutEffectivePolicyDelta:
      to.surfacesWithoutEffectivePolicy - from.surfacesWithoutEffectivePolicy,
    totalInvocationsDelta: to.totalInvocations - from.totalInvocations,
    resolvedInvocationsDelta: to.resolvedInvocations - from.resolvedInvocations,
    missingInvocationsDelta: to.missingInvocations - from.missingInvocations,
    unsafeInvocationsDelta: to.unsafeInvocations - from.unsafeInvocations,
    unscopedInvocationsDelta: to.unscopedInvocations - from.unscopedInvocations,
    noncanonicalInvocationsDelta:
      to.noncanonicalInvocations - from.noncanonicalInvocations,
    unavailableInvocationsDelta:
      to.unavailableInvocations - from.unavailableInvocations,
    invocationsWithEffectivePolicyEvidenceDelta:
      to.invocationsWithEffectivePolicyEvidence -
      from.invocationsWithEffectivePolicyEvidence,
    invocationsWithoutEffectivePolicyEvidenceDelta:
      to.invocationsWithoutEffectivePolicyEvidence -
      from.invocationsWithoutEffectivePolicyEvidence,
    resolvedInvocationsWithEffectivePolicyEvidenceDelta:
      to.resolvedInvocationsWithEffectivePolicyEvidence -
      from.resolvedInvocationsWithEffectivePolicyEvidence,
    resolvedInvocationsWithoutEffectivePolicyEvidenceDelta:
      to.resolvedInvocationsWithoutEffectivePolicyEvidence -
      from.resolvedInvocationsWithoutEffectivePolicyEvidence,
    invocationsWithMultipleEffectivePolicyFingerprintsDelta:
      to.invocationsWithMultipleEffectivePolicyFingerprints -
      from.invocationsWithMultipleEffectivePolicyFingerprints,
    sourceArtifactPolicyEvidenceRelationsDelta:
      to.invocationPolicyEvidenceRelations.sourceArtifact -
      from.invocationPolicyEvidenceRelations.sourceArtifact,
    owningSkillPolicyEvidenceRelationsDelta:
      to.invocationPolicyEvidenceRelations.owningSkill -
      from.invocationPolicyEvidenceRelations.owningSkill,
    effectivePolicyCoverageDelta: coveragePercent(to) - coveragePercent(from),
    totalDependenciesDelta: to.totalDependencies - from.totalDependencies,
    resolvedDependenciesDelta:
      to.resolvedDependencies - from.resolvedDependencies,
    missingDependenciesDelta: to.missingDependencies - from.missingDependencies,
    unsafeDependenciesDelta: to.unsafeDependencies - from.unsafeDependencies,
    ambiguousDependenciesDelta:
      to.ambiguousDependencies - from.ambiguousDependencies,
    noncanonicalDependenciesDelta:
      to.noncanonicalDependencies - from.noncanonicalDependencies,
    notInventoryDependenciesDelta:
      to.notInventoryDependencies - from.notInventoryDependencies,
    unavailableDependenciesDelta:
      to.unavailableDependencies - from.unavailableDependencies,
    directlyInvokedSurfacesDelta:
      to.directlyInvokedSurfaces - from.directlyInvokedSurfaces,
    transitivelyReachableSurfacesDelta:
      to.transitivelyReachableSurfaces - from.transitivelyReachableSurfaces,
    unreachedFromInvocationSurfacesDelta:
      to.unreachedFromInvocationSurfaces - from.unreachedFromInvocationSurfaces,
  };
}

function surfaceChangeReasons(
  from: ExecutableSurfaceEntry,
  to: ExecutableSurfaceEntry,
  fromDependencyGraphSignature: string,
  toDependencyGraphSignature: string,
): ExecutableSurfaceChangeReason[] {
  const reasons: ExecutableSurfaceChangeReason[] = [];
  if (
    from.contentHash !== to.contentHash ||
    from.contentClassification !== to.contentClassification ||
    from.artifactKind !== to.artifactKind
  ) {
    reasons.push("content");
  }
  if (from.scope !== to.scope) reasons.push("scope");
  if (
    !sameStrings(from.interpreterHints, to.interpreterHints) ||
    from.shebang !== to.shebang
  ) {
    reasons.push("interpreter");
  }
  if (
    from.reachableFromOwningSkill !== to.reachableFromOwningSkill ||
    from.reachabilityDepth !== to.reachabilityDepth ||
    JSON.stringify(from.owningSkill) !== JSON.stringify(to.owningSkill)
  ) {
    reasons.push("reachability");
  }
  if (
    from.staticallyReferenced !== to.staticallyReferenced ||
    from.referenceCount !== to.referenceCount ||
    !sameStrings(from.origins, to.origins)
  ) {
    reasons.push("references");
  }
  if (
    from.staticallyInvoked !== to.staticallyInvoked ||
    from.invocationCount !== to.invocationCount
  ) {
    reasons.push("invocations");
  }
  if (
    from.invocationGovernance.invocationsWithEffectivePolicyEvidence !==
      to.invocationGovernance.invocationsWithEffectivePolicyEvidence ||
    from.invocationGovernance.invocationsWithoutEffectivePolicyEvidence !==
      to.invocationGovernance.invocationsWithoutEffectivePolicyEvidence ||
    !sameStrings(
      from.invocationGovernance.distinctEffectivePolicyFingerprints,
      to.invocationGovernance.distinctEffectivePolicyFingerprints,
    )
  ) {
    reasons.push("invocation-governance");
  }
  if (
    fromDependencyGraphSignature !== toDependencyGraphSignature ||
    from.dependencyEvidence.incomingResolvedDependencyCount !==
      to.dependencyEvidence.incomingResolvedDependencyCount ||
    from.dependencyEvidence.outgoingResolvedDependencyCount !==
      to.dependencyEvidence.outgoingResolvedDependencyCount
  ) {
    reasons.push("dependency-graph");
  }
  if (
    from.dependencyEvidence.staticInvocationReachability !==
      to.dependencyEvidence.staticInvocationReachability ||
    from.dependencyEvidence.minimumInvocationDependencyDepth !==
      to.dependencyEvidence.minimumInvocationDependencyDepth
  ) {
    reasons.push("invocation-reachability");
  }
  if (
    from.securityPolicy.hasEffectivePolicy !==
      to.securityPolicy.hasEffectivePolicy ||
    from.securityPolicy.fingerprint !== to.securityPolicy.fingerprint ||
    !sameStrings(
      from.securityPolicy.policySources,
      to.securityPolicy.policySources,
    )
  ) {
    reasons.push("security-policy");
  }
  return reasons;
}

function dependencyGraphSignatures(
  inventory: ExecutableSurfaceInventory,
): ReadonlyMap<string, string> {
  const evidence = new Map<string, { incoming: string[]; outgoing: string[] }>(
    inventory.surfaces.map((surface) => [
      surface.path,
      { incoming: [], outgoing: [] },
    ]),
  );
  for (const dependency of inventory.dependencies) {
    if (
      (dependency.resolution !== "resolved" &&
        dependency.resolution !== "noncanonical") ||
      !dependency.normalizedTarget
    ) {
      continue;
    }
    evidence
      .get(dependency.sourcePath)
      ?.outgoing.push(dependency.normalizedTarget);
    evidence
      .get(dependency.normalizedTarget)
      ?.incoming.push(dependency.sourcePath);
  }
  return new Map(
    [...evidence].map(([surfacePath, graph]) => [
      surfacePath,
      JSON.stringify({
        incoming: graph.incoming.sort((left, right) =>
          left.localeCompare(right),
        ),
        outgoing: graph.outgoing.sort((left, right) =>
          left.localeCompare(right),
        ),
      }),
    ]),
  );
}

interface SemanticInvocation {
  sourcePath: string;
  launcher: string;
  target: string;
  occurrenceOrdinal: number;
  resolution: ExecutableSurfaceInvocation["resolution"];
  governance: ExecutableInvocationGovernance;
  line: number;
}

interface SemanticDependency {
  sourcePath: string;
  analyzer: ExecutableSurfaceDependency["analyzer"];
  relation: ExecutableSurfaceDependency["relation"];
  target: string;
  rawSpecifier: string;
  occurrenceOrdinal: number;
  resolution: ExecutableSurfaceDependencyResolution;
  line: number;
}

function semanticInvocationMap(
  invocations: readonly ExecutableSurfaceInvocation[],
): Map<string, SemanticInvocation> {
  const ordinals = new Map<string, number>();
  return new Map(
    [...invocations]
      .sort(
        (left, right) =>
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.line - right.line ||
          left.launcher.localeCompare(right.launcher) ||
          invocationTarget(left).localeCompare(invocationTarget(right)),
      )
      .map((invocation) => {
        const target = invocationTarget(invocation);
        const base = [invocation.sourcePath, invocation.launcher, target].join(
          "\0",
        );
        const occurrenceOrdinal = (ordinals.get(base) ?? 0) + 1;
        ordinals.set(base, occurrenceOrdinal);
        const row = {
          sourcePath: invocation.sourcePath,
          launcher: invocation.launcher,
          target,
          occurrenceOrdinal,
          resolution: invocation.resolution,
          governance: invocation.governance,
          line: invocation.line,
        };
        return [`${base}\0${occurrenceOrdinal}`, row] as const;
      }),
  );
}

function semanticDependencyMap(
  dependencies: readonly ExecutableSurfaceDependency[],
): Map<string, SemanticDependency> {
  const ordinals = new Map<string, number>();
  return new Map(
    [...dependencies]
      .sort(
        (left, right) =>
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.line - right.line ||
          left.analyzer.localeCompare(right.analyzer) ||
          left.relation.localeCompare(right.relation) ||
          dependencyTarget(left).localeCompare(dependencyTarget(right)) ||
          left.rawSpecifier.localeCompare(right.rawSpecifier),
      )
      .map((dependency) => {
        const target = dependencyTarget(dependency);
        const base = [
          dependency.sourcePath,
          dependency.analyzer,
          dependency.relation,
          target,
          dependency.rawSpecifier,
        ].join("\0");
        const occurrenceOrdinal = (ordinals.get(base) ?? 0) + 1;
        ordinals.set(base, occurrenceOrdinal);
        const row = {
          sourcePath: dependency.sourcePath,
          analyzer: dependency.analyzer,
          relation: dependency.relation,
          target,
          rawSpecifier: dependency.rawSpecifier,
          occurrenceOrdinal,
          resolution: dependency.resolution,
          line: dependency.line,
        };
        return [`${base}\0${occurrenceOrdinal}`, row] as const;
      }),
  );
}

function dependencyDelta(
  dependency: SemanticDependency,
): ExecutableSurfaceDependencyDelta {
  return {
    sourcePath: dependency.sourcePath,
    analyzer: dependency.analyzer,
    relation: dependency.relation,
    target: dependency.target,
    occurrenceOrdinal: dependency.occurrenceOrdinal,
    resolution: dependency.resolution,
    line: dependency.line,
  };
}

function governanceChange(
  from: SemanticInvocation,
  to: SemanticInvocation,
): ExecutableInvocationGovernanceChange {
  return {
    sourcePath: to.sourcePath,
    launcher: to.launcher,
    target: to.target,
    occurrenceOrdinal: to.occurrenceOrdinal,
    fromHasEffectivePolicyEvidence: from.governance.hasEffectivePolicyEvidence,
    toHasEffectivePolicyEvidence: to.governance.hasEffectivePolicyEvidence,
    fromDistinctEffectivePolicyFingerprints: [
      ...from.governance.distinctEffectivePolicyFingerprints,
    ],
    toDistinctEffectivePolicyFingerprints: [
      ...to.governance.distinctEffectivePolicyFingerprints,
    ],
    fromOwningSkillResolution: from.governance.owningSkillResolution,
    toOwningSkillResolution: to.governance.owningSkillResolution,
    fromGovernanceFingerprint: from.governance.fingerprint,
    toGovernanceFingerprint: to.governance.fingerprint,
    fromLine: from.line,
    toLine: to.line,
  };
}

function governanceDelta(
  invocation: SemanticInvocation,
): ExecutableInvocationGovernanceDelta {
  return {
    sourcePath: invocation.sourcePath,
    launcher: invocation.launcher,
    target: invocation.target,
    occurrenceOrdinal: invocation.occurrenceOrdinal,
    hasEffectivePolicyEvidence:
      invocation.governance.hasEffectivePolicyEvidence,
    distinctEffectivePolicyFingerprints: [
      ...invocation.governance.distinctEffectivePolicyFingerprints,
    ],
    owningSkillResolution: invocation.governance.owningSkillResolution,
    resolution: invocation.resolution,
    line: invocation.line,
  };
}

function reachabilityChanges(
  from: ReadonlyMap<string, ExecutableSurfaceEntry>,
  to: ReadonlyMap<string, ExecutableSurfaceEntry>,
  reachable: boolean,
): string[] {
  return [...to]
    .filter(([surfacePath, surface]) => {
      if (surface.scope !== "skill-local") return false;
      const current = surface.reachableFromOwningSkill === true;
      const previousSurface = from.get(surfacePath);
      if (!previousSurface) return current === reachable;
      const previous = previousSurface.reachableFromOwningSkill === true;
      return current === reachable && previous !== reachable;
    })
    .map(([surfacePath]) => surfacePath)
    .sort((left, right) => left.localeCompare(right));
}

function staticReachabilityChanges(
  from: ReadonlyMap<string, ExecutableSurfaceEntry>,
  to: ReadonlyMap<string, ExecutableSurfaceEntry>,
  reachability: StaticInvocationReachability,
): string[] {
  return [...to]
    .filter(([surfacePath, surface]) => {
      const current = surface.dependencyEvidence.staticInvocationReachability;
      const previous =
        from.get(surfacePath)?.dependencyEvidence.staticInvocationReachability;
      return current === reachability && previous !== reachability;
    })
    .map(([surfacePath]) => surfacePath)
    .sort((left, right) => left.localeCompare(right));
}

function lostStaticReachability(
  from: ReadonlyMap<string, ExecutableSurfaceEntry>,
  to: ReadonlyMap<string, ExecutableSurfaceEntry>,
): string[] {
  return [...from]
    .filter(([surfacePath, surface]) => {
      const previous = surface.dependencyEvidence.staticInvocationReachability;
      const current =
        to.get(surfacePath)?.dependencyEvidence.staticInvocationReachability;
      return (
        previous !== "unreached" &&
        (current === undefined || current === "unreached")
      );
    })
    .map(([surfacePath]) => surfacePath)
    .sort((left, right) => left.localeCompare(right));
}

function invocationDepthChanges(
  from: ReadonlyMap<string, ExecutableSurfaceEntry>,
  to: ReadonlyMap<string, ExecutableSurfaceEntry>,
): ExecutableSurfaceInvocationDepthChange[] {
  return [...to]
    .flatMap(([surfacePath, toSurface]) => {
      const fromSurface = from.get(surfacePath);
      if (!fromSurface) return [];
      const fromEvidence = fromSurface.dependencyEvidence;
      const toEvidence = toSurface.dependencyEvidence;
      if (
        fromEvidence.minimumInvocationDependencyDepth ===
          toEvidence.minimumInvocationDependencyDepth &&
        fromEvidence.staticInvocationReachability ===
          toEvidence.staticInvocationReachability
      ) {
        return [];
      }
      if (
        fromEvidence.minimumInvocationDependencyDepth === undefined &&
        toEvidence.minimumInvocationDependencyDepth === undefined
      ) {
        return [];
      }
      return [
        {
          path: surfacePath,
          fromReachability: fromEvidence.staticInvocationReachability,
          toReachability: toEvidence.staticInvocationReachability,
          ...(fromEvidence.minimumInvocationDependencyDepth !== undefined
            ? {
                fromDepth: fromEvidence.minimumInvocationDependencyDepth,
              }
            : {}),
          ...(toEvidence.minimumInvocationDependencyDepth !== undefined
            ? { toDepth: toEvidence.minimumInvocationDependencyDepth }
            : {}),
        },
      ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function invocationTarget(invocation: ExecutableSurfaceInvocation): string {
  return invocation.normalizedTarget ?? invocation.rawTarget;
}

function dependencyTarget(
  dependency: Pick<
    ExecutableSurfaceDependency,
    "normalizedTarget" | "normalizedTargetCandidates" | "rawSpecifier"
  >,
): string {
  const candidates = dependency.normalizedTargetCandidates.join("|");
  return dependency.normalizedTarget ?? (candidates || dependency.rawSpecifier);
}

function coveragePercent(summary: ExecutableSurfaceInventorySummary): number {
  if (summary.totalSurfaces === 0) return 100;
  return Math.round(
    (summary.surfacesWithEffectivePolicy / summary.totalSurfaces) * 100,
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function compareInvocationChanges(
  left: ExecutableSurfaceInvocationResolutionChange,
  right: ExecutableSurfaceInvocationResolutionChange,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.launcher.localeCompare(right.launcher) ||
    left.target.localeCompare(right.target) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function compareInvocationDeltas(
  left: ExecutableSurfaceInvocationDelta,
  right: ExecutableSurfaceInvocationDelta,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.launcher.localeCompare(right.launcher) ||
    left.target.localeCompare(right.target) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function compareDependencyChanges(
  left: ExecutableSurfaceDependencyResolutionChange,
  right: ExecutableSurfaceDependencyResolutionChange,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.analyzer.localeCompare(right.analyzer) ||
    left.relation.localeCompare(right.relation) ||
    left.target.localeCompare(right.target) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function compareDependencyDeltas(
  left: ExecutableSurfaceDependencyDelta,
  right: ExecutableSurfaceDependencyDelta,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.analyzer.localeCompare(right.analyzer) ||
    left.relation.localeCompare(right.relation) ||
    left.target.localeCompare(right.target) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function compareGovernanceChanges(
  left: ExecutableInvocationGovernanceChange,
  right: ExecutableInvocationGovernanceChange,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.launcher.localeCompare(right.launcher) ||
    left.target.localeCompare(right.target) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function compareGovernanceDeltas(
  left: ExecutableInvocationGovernanceDelta,
  right: ExecutableInvocationGovernanceDelta,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.launcher.localeCompare(right.launcher) ||
    left.target.localeCompare(right.target) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}
