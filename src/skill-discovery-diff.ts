import path from "node:path";

import {
  SKILL_ROUTE_USABILITY_REASONS,
  resolveSkillDiscoveryRouteCycles,
  type DeclaredSkillRoute,
  type SkillDiscoveryAdoptionState,
  type SkillDiscoveryCoverage,
  type SkillDiscoveryIndex,
  type SkillRouteNormalizationRejection,
  type SkillRouteResolutionState,
  type SkillRouteUsabilityReason,
} from "./skill-discovery.js";

export interface SkillDiscoveryDiffSkill {
  id: string;
  path: string;
}

export interface SkillDiscoveryDiffSummary {
  publishedEntrypointCountDelta: number;
  routeEligibleSkillCountDelta: number;
  reachableSkillCountDelta: number;
  notReachedSkillCountDelta: number;
  unroutedSkillCountDelta: number;
  usableRouteCountDelta: number;
  unusableRouteCountDelta: number;
  unresolvedRouteCountDelta: number;
  cycleComponentCountDelta: number;
}

export interface SkillDiscoveryRouteDiffCandidate {
  id: string;
  path: string;
  kind: string;
}

export interface SkillDiscoveryRouteDiffTarget {
  id: string;
  path: string;
  kind: string;
  lifecycle?: string;
}

export interface SkillDiscoveryRouteDiffState {
  sourceId: string;
  sourcePath: string;
  normalizedTarget: string;
  declarationCount: number;
  resolution: SkillRouteResolutionState;
  normalizationRejection?: SkillRouteNormalizationRejection;
  candidates: SkillDiscoveryRouteDiffCandidate[];
  resolvedTarget?: SkillDiscoveryRouteDiffTarget;
  usable: boolean;
  usabilityReasons: SkillRouteUsabilityReason[];
}

export interface SkillDiscoveryRouteDiffIdentity {
  sourcePath: string;
  normalizedTarget: string;
}

export type SkillDiscoveryRouteChangedField =
  | "sourceId"
  | "declarationCount"
  | "resolution"
  | "normalizationRejection"
  | "candidates"
  | "resolvedTarget"
  | "targetLifecycle"
  | "usable"
  | "usabilityReasons";

export interface SkillDiscoveryRouteChange {
  identity: SkillDiscoveryRouteDiffIdentity;
  changedFields: SkillDiscoveryRouteChangedField[];
  from: SkillDiscoveryRouteDiffState;
  to: SkillDiscoveryRouteDiffState;
}

export interface SkillDiscoveryCycleDiff {
  skillIds: string[];
  skills: SkillDiscoveryDiffSkill[];
  selfLoop: boolean;
}

export interface SkillDiscoveryDiff {
  schemaVersion: "renma.skill-discovery-diff.v1";
  adoption: {
    from: SkillDiscoveryAdoptionState;
    to: SkillDiscoveryAdoptionState;
    changed: boolean;
  };
  coverage: {
    from: SkillDiscoveryCoverage["mode"];
    to: SkillDiscoveryCoverage["mode"];
    changed: boolean;
  };
  summary: SkillDiscoveryDiffSummary;
  publishedEntrypoints: {
    added: SkillDiscoveryDiffSkill[];
    removed: SkillDiscoveryDiffSkill[];
  };
  reachability: {
    newlyReachable: SkillDiscoveryDiffSkill[];
    newlyNotReached: SkillDiscoveryDiffSkill[];
  };
  unroutedSkills: {
    newlyUnrouted: SkillDiscoveryDiffSkill[];
    resolvedUnrouted: SkillDiscoveryDiffSkill[];
  };
  routes: {
    added: SkillDiscoveryRouteDiffState[];
    removed: SkillDiscoveryRouteDiffState[];
    changed: SkillDiscoveryRouteChange[];
  };
  cycles: {
    added: SkillDiscoveryCycleDiff[];
    resolved: SkillDiscoveryCycleDiff[];
  };
}

const ROUTE_CHANGED_FIELD_ORDER: readonly SkillDiscoveryRouteChangedField[] = [
  "sourceId",
  "declarationCount",
  "resolution",
  "normalizationRejection",
  "candidates",
  "resolvedTarget",
  "targetLifecycle",
  "usable",
  "usabilityReasons",
];

/** Compare only deterministic facts from two already prepared Discovery indexes. */
export function buildSkillDiscoveryDiff(
  from: SkillDiscoveryIndex,
  to: SkillDiscoveryIndex,
): SkillDiscoveryDiff {
  const fromCycles = cycleMap(from);
  const toCycles = cycleMap(to);
  const fromRoutes = routeMap(from);
  const toRoutes = routeMap(to);

  return {
    schemaVersion: "renma.skill-discovery-diff.v1",
    adoption: {
      from: from.adoption.state,
      to: to.adoption.state,
      changed: from.adoption.state !== to.adoption.state,
    },
    coverage: {
      from: from.coverage.mode,
      to: to.coverage.mode,
      changed: from.coverage.mode !== to.coverage.mode,
    },
    summary: {
      publishedEntrypointCountDelta: countDelta(
        to.summary.publishedEntrypointCount,
        from.summary.publishedEntrypointCount,
      ),
      routeEligibleSkillCountDelta: countDelta(
        to.summary.routeEligibleSkillCount,
        from.summary.routeEligibleSkillCount,
      ),
      reachableSkillCountDelta: countDelta(
        to.summary.reachableSkillCount,
        from.summary.reachableSkillCount,
      ),
      notReachedSkillCountDelta: countDelta(
        to.summary.notReachedSkillCount,
        from.summary.notReachedSkillCount,
      ),
      unroutedSkillCountDelta: countDelta(
        to.summary.unroutedSkillCount,
        from.summary.unroutedSkillCount,
      ),
      usableRouteCountDelta: countDelta(
        to.summary.usableRouteCount,
        from.summary.usableRouteCount,
      ),
      unusableRouteCountDelta: countDelta(
        unusableRouteCount(to),
        unusableRouteCount(from),
      ),
      unresolvedRouteCountDelta: countDelta(
        to.summary.unresolvedRouteCount,
        from.summary.unresolvedRouteCount,
      ),
      cycleComponentCountDelta: countDelta(toCycles.size, fromCycles.size),
    },
    publishedEntrypoints: identityChanges(
      effectivePublishedEntrypoints(from),
      effectivePublishedEntrypoints(to),
      "added",
      "removed",
    ),
    reachability: {
      newlyReachable: addedIdentities(
        reachabilityIdentities(from, from.reachableDiscoveryEligibleSkillIds),
        reachabilityIdentities(to, to.reachableDiscoveryEligibleSkillIds),
      ),
      newlyNotReached: addedIdentities(
        reachabilityIdentities(from, from.notReachedDiscoveryEligibleSkillIds),
        reachabilityIdentities(to, to.notReachedDiscoveryEligibleSkillIds),
      ),
    },
    unroutedSkills: {
      newlyUnrouted: addedIdentities(
        skillIdentitiesForIds(from, from.unroutedSkillIds),
        skillIdentitiesForIds(to, to.unroutedSkillIds),
      ),
      resolvedUnrouted: removedIdentities(
        skillIdentitiesForIds(from, from.unroutedSkillIds),
        skillIdentitiesForIds(to, to.unroutedSkillIds),
      ),
    },
    routes: {
      added: mapAdditions(fromRoutes, toRoutes),
      removed: mapRemovals(fromRoutes, toRoutes),
      changed: changedRoutes(fromRoutes, toRoutes),
    },
    cycles: {
      added: mapAdditions(fromCycles, toCycles),
      resolved: mapRemovals(fromCycles, toCycles),
    },
  };
}

function effectivePublishedEntrypoints(
  index: SkillDiscoveryIndex,
): SkillDiscoveryDiffSkill[] {
  return index.skills
    .filter((skill) => skill.publication.accepted)
    .map(skillIdentity)
    .sort(compareSkills);
}

function reachabilityIdentities(
  index: SkillDiscoveryIndex,
  ids: readonly string[],
): SkillDiscoveryDiffSkill[] {
  return skillIdentitiesForIds(index, ids, true);
}

function skillIdentitiesForIds(
  index: SkillDiscoveryIndex,
  ids: readonly string[],
  requireRouteEligible = false,
): SkillDiscoveryDiffSkill[] {
  const selectedIds = new Set(ids);
  return index.skills
    .filter(
      (skill) =>
        selectedIds.has(skill.id) &&
        (!requireRouteEligible || skill.routeEligible),
    )
    .map(skillIdentity)
    .sort(compareSkills);
}

function skillIdentity(skill: {
  id: string;
  sourcePath: string;
}): SkillDiscoveryDiffSkill {
  return {
    id: skill.id,
    path: normalizeRepositoryPath(skill.sourcePath),
  };
}

function identityChanges<AddedKey extends string, RemovedKey extends string>(
  from: SkillDiscoveryDiffSkill[],
  to: SkillDiscoveryDiffSkill[],
  addedKey: AddedKey,
  removedKey: RemovedKey,
): Record<AddedKey | RemovedKey, SkillDiscoveryDiffSkill[]> {
  return {
    [addedKey]: addedIdentities(from, to),
    [removedKey]: removedIdentities(from, to),
  } as Record<AddedKey | RemovedKey, SkillDiscoveryDiffSkill[]>;
}

function addedIdentities(
  from: SkillDiscoveryDiffSkill[],
  to: SkillDiscoveryDiffSkill[],
): SkillDiscoveryDiffSkill[] {
  const fromKeys = new Set(from.map(skillKey));
  return to.filter((skill) => !fromKeys.has(skillKey(skill)));
}

function removedIdentities(
  from: SkillDiscoveryDiffSkill[],
  to: SkillDiscoveryDiffSkill[],
): SkillDiscoveryDiffSkill[] {
  const toKeys = new Set(to.map(skillKey));
  return from.filter((skill) => !toKeys.has(skillKey(skill)));
}

function skillKey(skill: SkillDiscoveryDiffSkill): string {
  return `${skill.path}\0${skill.id}`;
}

function routeMap(
  index: SkillDiscoveryIndex,
): Map<string, SkillDiscoveryRouteDiffState> {
  const groups = new Map<string, DeclaredSkillRoute[]>();
  const stableRepresentativeByDuplicateGroup = new Map<string, string>();
  for (const route of index.routes) {
    const sourcePath = normalizeRepositoryPath(route.sourcePath);
    const key = routeKey(sourcePath, route.normalizedTarget);
    groups.set(key, [...(groups.get(key) ?? []), route]);
    const duplicateKey = duplicateRouteGroupKey(route);
    if (duplicateKey) {
      const current = stableRepresentativeByDuplicateGroup.get(duplicateKey);
      if (!current || key.localeCompare(current) < 0) {
        stableRepresentativeByDuplicateGroup.set(duplicateKey, key);
      }
    }
  }
  return new Map(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, routes]) => [
        key,
        routeState(
          routes,
          isStableDuplicateRepresentative(
            key,
            routes,
            stableRepresentativeByDuplicateGroup,
          ),
        ),
      ]),
  );
}

function routeState(
  routes: readonly DeclaredSkillRoute[],
  stableDuplicateRepresentative: boolean | undefined,
): SkillDiscoveryRouteDiffState {
  const representative =
    routes.find((route) => route.representative) ?? routes[0]!;
  const candidates = representative.candidates
    .map((candidate) => ({
      id: candidate.id,
      path: normalizeRepositoryPath(candidate.sourcePath),
      kind: candidate.kind,
    }))
    .sort(compareCandidates);
  const resolvedTarget = representative.resolvedTarget
    ? {
        id: representative.resolvedTarget.id,
        path: normalizeRepositoryPath(representative.resolvedTarget.sourcePath),
        kind: representative.resolvedTarget.kind,
        ...(representative.resolvedTarget.lifecycle
          ? { lifecycle: representative.resolvedTarget.lifecycle }
          : {}),
      }
    : undefined;
  const baseUsabilityReasons = representative.usabilityReasons.filter(
    (reason) => reason !== "duplicate-declaration",
  );
  const usabilityReasons =
    stableDuplicateRepresentative === false
      ? [...baseUsabilityReasons, "duplicate-declaration" as const].sort(
          compareUsabilityReasons,
        )
      : baseUsabilityReasons.sort(compareUsabilityReasons);
  return {
    sourceId: representative.sourceId,
    sourcePath: normalizeRepositoryPath(representative.sourcePath),
    normalizedTarget: representative.normalizedTarget,
    declarationCount: routes.length,
    resolution: representative.resolution,
    ...(representative.normalizationRejection
      ? {
          normalizationRejection: representative.normalizationRejection,
        }
      : {}),
    candidates,
    ...(resolvedTarget ? { resolvedTarget } : {}),
    usable:
      stableDuplicateRepresentative === undefined
        ? representative.usable
        : usabilityReasons.length === 0,
    usabilityReasons,
  };
}

function isStableDuplicateRepresentative(
  routeIdentity: string,
  routes: readonly DeclaredSkillRoute[],
  stableRepresentativeByDuplicateGroup: ReadonlyMap<string, string>,
): boolean | undefined {
  const duplicateKey = duplicateRouteGroupKey(routes[0]!);
  if (!duplicateKey) return undefined;
  return (
    stableRepresentativeByDuplicateGroup.get(duplicateKey) === routeIdentity
  );
}

function duplicateRouteGroupKey(route: DeclaredSkillRoute): string | undefined {
  if (route.duplicateDeclarationIndices.length < 2) return undefined;
  const sourcePath = normalizeRepositoryPath(route.sourcePath);
  if (
    route.resolution === "resolved" &&
    route.resolvedTarget?.kind === "skill"
  ) {
    return `${sourcePath}\0skill:${normalizeRepositoryPath(route.resolvedTarget.sourcePath)}`;
  }
  if (route.resolution === "unresolved") {
    return `${sourcePath}\0spelling:${route.normalizedTarget}`;
  }
  return undefined;
}

function changedRoutes(
  from: ReadonlyMap<string, SkillDiscoveryRouteDiffState>,
  to: ReadonlyMap<string, SkillDiscoveryRouteDiffState>,
): SkillDiscoveryRouteChange[] {
  return [...to.entries()].flatMap(([key, toState]) => {
    const fromState = from.get(key);
    if (!fromState) return [];
    const changedFields = ROUTE_CHANGED_FIELD_ORDER.filter((field) =>
      routeFieldChanged(field, fromState, toState),
    );
    if (changedFields.length === 0) return [];
    return [
      {
        identity: {
          sourcePath: toState.sourcePath,
          normalizedTarget: toState.normalizedTarget,
        },
        changedFields,
        from: fromState,
        to: toState,
      },
    ];
  });
}

function routeFieldChanged(
  field: SkillDiscoveryRouteChangedField,
  from: SkillDiscoveryRouteDiffState,
  to: SkillDiscoveryRouteDiffState,
): boolean {
  switch (field) {
    case "sourceId":
    case "declarationCount":
    case "resolution":
    case "normalizationRejection":
    case "usable":
      return from[field] !== to[field];
    case "candidates":
    case "usabilityReasons":
      return JSON.stringify(from[field]) !== JSON.stringify(to[field]);
    case "resolvedTarget":
      return (
        JSON.stringify(targetIdentity(from.resolvedTarget)) !==
        JSON.stringify(targetIdentity(to.resolvedTarget))
      );
    case "targetLifecycle":
      return from.resolvedTarget?.lifecycle !== to.resolvedTarget?.lifecycle;
  }
}

function targetIdentity(
  target: SkillDiscoveryRouteDiffTarget | undefined,
): Omit<SkillDiscoveryRouteDiffTarget, "lifecycle"> | undefined {
  if (!target) return undefined;
  return { id: target.id, path: target.path, kind: target.kind };
}

function routeKey(sourcePath: string, normalizedTarget: string): string {
  return `${sourcePath}\0${normalizedTarget}`;
}

function cycleMap(
  index: SkillDiscoveryIndex,
): Map<string, SkillDiscoveryCycleDiff> {
  return new Map(
    resolveSkillDiscoveryRouteCycles(index.routes)
      .map((cycle) => {
        const skillIds = [...cycle.cycleSkillIds].sort((left, right) =>
          left.localeCompare(right),
        );
        const projected: SkillDiscoveryCycleDiff = {
          skillIds,
          skills: cycle.cycleSkills.map(skillIdentity).sort(compareSkills),
          selfLoop: cycle.selfLoop,
        };
        return [skillIds.join("\0"), projected] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function mapAdditions<T>(
  from: ReadonlyMap<string, T>,
  to: ReadonlyMap<string, T>,
): T[] {
  return [...to].filter(([key]) => !from.has(key)).map(([, value]) => value);
}

function mapRemovals<T>(
  from: ReadonlyMap<string, T>,
  to: ReadonlyMap<string, T>,
): T[] {
  return [...from].filter(([key]) => !to.has(key)).map(([, value]) => value);
}

function unusableRouteCount(index: SkillDiscoveryIndex): number {
  return index.routes.filter((route) => !route.usable).length;
}

function countDelta(to: number, from: number): number {
  return to - from;
}

function normalizeRepositoryPath(value: string): string {
  const slashPath = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const normalized = path.posix.normalize(slashPath);
  return normalized === "." ? "" : normalized;
}

function compareSkills(
  left: SkillDiscoveryDiffSkill,
  right: SkillDiscoveryDiffSkill,
): number {
  return left.path.localeCompare(right.path) || left.id.localeCompare(right.id);
}

function compareCandidates(
  left: SkillDiscoveryRouteDiffCandidate,
  right: SkillDiscoveryRouteDiffCandidate,
): number {
  return (
    left.path.localeCompare(right.path) ||
    left.id.localeCompare(right.id) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareUsabilityReasons(
  left: SkillRouteUsabilityReason,
  right: SkillRouteUsabilityReason,
): number {
  return (
    SKILL_ROUTE_USABILITY_REASONS.indexOf(left) -
    SKILL_ROUTE_USABILITY_REASONS.indexOf(right)
  );
}
