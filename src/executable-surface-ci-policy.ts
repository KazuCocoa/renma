import type {
  ExecutableInvocationGovernanceChange,
  ExecutableInvocationGovernanceDelta,
  ExecutableSurfaceDependencyDelta,
  ExecutableSurfaceDiff,
  ExecutableSurfaceInvocationDelta,
} from "./executable-surface-diff.js";
import type { ExecutableSurfaceCiPolicyMode } from "./types/configuration.js";

export const EXECUTABLE_SURFACE_CI_POLICY_SCHEMA_VERSION =
  "renma.executable-surface-ci-policy.v1" as const;

export const EXECUTABLE_SURFACE_CI_MATCH_IDS = {
  SURFACE_ADDED: "executable_surface_ci.surface_added",
  PROBLEMATIC_INVOCATION_ADDED:
    "executable_surface_ci.problematic_invocation_added",
  PROBLEMATIC_DEPENDENCY_ADDED:
    "executable_surface_ci.problematic_dependency_added",
  INVOCATION_POLICY_EVIDENCE_MISSING:
    "executable_surface_ci.invocation_policy_evidence_missing",
  INVOCATION_POLICY_EVIDENCE_LOST:
    "executable_surface_ci.invocation_policy_evidence_lost",
  INVOCATION_POLICY_AMBIGUOUS:
    "executable_surface_ci.invocation_policy_ambiguous",
  SKILL_LOCAL_REACHABILITY_LOST:
    "executable_surface_ci.skill_local_reachability_lost",
  STATIC_INVOCATION_REACHABILITY_LOST:
    "executable_surface_ci.static_invocation_reachability_lost",
  TRANSITIVE_REACHABILITY_ADDED:
    "executable_surface_ci.transitive_reachability_added",
} as const;

export type ExecutableSurfaceCiMatchId =
  (typeof EXECUTABLE_SURFACE_CI_MATCH_IDS)[keyof typeof EXECUTABLE_SURFACE_CI_MATCH_IDS];

export interface ExecutableSurfaceCiConfiguration {
  from: ExecutableSurfaceCiPolicyMode;
  to: ExecutableSurfaceCiPolicyMode;
}

interface ExecutableSurfaceCiSurfaceMatch {
  id:
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.SKILL_LOCAL_REACHABILITY_LOST
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.STATIC_INVOCATION_REACHABILITY_LOST
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.TRANSITIVE_REACHABILITY_ADDED;
  kind: "surface";
  path: string;
  summary: string;
}

interface ExecutableSurfaceCiProblematicInvocationMatch extends ExecutableSurfaceInvocationDelta {
  id: typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_INVOCATION_ADDED;
  kind: "invocation";
  summary: string;
}

interface ExecutableSurfaceCiProblematicDependencyMatch extends ExecutableSurfaceDependencyDelta {
  id: typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_DEPENDENCY_ADDED;
  kind: "dependency";
  summary: string;
}

interface ExecutableSurfaceCiNewInvocationGovernanceMatch extends ExecutableInvocationGovernanceDelta {
  id:
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_MISSING
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS;
  kind: "invocation";
  transition: "added";
  summary: string;
}

interface ExecutableSurfaceCiChangedInvocationGovernanceMatch extends ExecutableInvocationGovernanceChange {
  id:
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_LOST
    | typeof EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS;
  kind: "invocation";
  transition: "changed";
  summary: string;
}

export type ExecutableSurfaceCiMatch =
  | ExecutableSurfaceCiSurfaceMatch
  | ExecutableSurfaceCiProblematicInvocationMatch
  | ExecutableSurfaceCiProblematicDependencyMatch
  | ExecutableSurfaceCiNewInvocationGovernanceMatch
  | ExecutableSurfaceCiChangedInvocationGovernanceMatch;

export interface ExecutableSurfaceCiEvaluation {
  schemaVersion: typeof EXECUTABLE_SURFACE_CI_POLICY_SCHEMA_VERSION;
  configured: ExecutableSurfaceCiConfiguration & {
    effective: ExecutableSurfaceCiPolicyMode;
  };
  outcome: "pass" | "warn" | "fail";
  /** Counts policy reasons, so one invocation may contribute multiple matches. */
  matchCount: number;
  matches: ExecutableSurfaceCiMatch[];
}

const MODE_RANK: Record<ExecutableSurfaceCiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

export function effectiveExecutableSurfaceCiPolicy(
  configured: ExecutableSurfaceCiConfiguration,
): ExecutableSurfaceCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

/** Evaluate high-signal CI review events from the canonical executable diff. */
export function evaluateExecutableSurfaceCiPolicy(
  diff: ExecutableSurfaceDiff,
  configured: ExecutableSurfaceCiConfiguration,
): ExecutableSurfaceCiEvaluation {
  const effective = effectiveExecutableSurfaceCiPolicy(configured);
  const addedSurfacePaths = new Set(diff.addedSurfacePaths ?? []);
  const removedSurfacePaths = new Set(diff.removedSurfacePaths ?? []);
  const isExistingSurfaceTransition = (path: string): boolean =>
    !addedSurfacePaths.has(path) && !removedSurfacePaths.has(path);
  const matches: ExecutableSurfaceCiMatch[] = [
    ...(diff.addedSurfacePaths ?? []).map((path) => ({
      id: EXECUTABLE_SURFACE_CI_MATCH_IDS.SURFACE_ADDED,
      kind: "surface" as const,
      path,
      summary: "A newly discovered executable surface was added.",
    })),
    ...(diff.newProblematicInvocations ?? []).map((invocation) => ({
      id: EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_INVOCATION_ADDED,
      kind: "invocation" as const,
      ...invocation,
      summary: "A new invocation has problematic resolution evidence.",
    })),
    ...(diff.newProblematicDependencies ?? []).map((dependency) => ({
      id: EXECUTABLE_SURFACE_CI_MATCH_IDS.PROBLEMATIC_DEPENDENCY_ADDED,
      kind: "dependency" as const,
      ...dependency,
      summary:
        "A new executable dependency has problematic resolution evidence.",
    })),
    ...(diff.newInvocationsWithoutEffectivePolicyEvidence ?? []).map(
      (invocation) => ({
        id: EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_MISSING,
        kind: "invocation" as const,
        transition: "added" as const,
        ...invocation,
        summary: "A new invocation lacks effective security-policy evidence.",
      }),
    ),
    ...(diff.invocationsLostEffectivePolicyEvidence ?? []).map((change) => ({
      id: EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_EVIDENCE_LOST,
      kind: "invocation" as const,
      transition: "changed" as const,
      ...change,
      summary:
        "An existing invocation lost effective security-policy evidence.",
    })),
    ...(diff.newInvocationsWithMultipleEffectivePolicyFingerprints ?? []).map(
      (invocation) => ({
        id: EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS,
        kind: "invocation" as const,
        transition: "added" as const,
        ...invocation,
        summary:
          "A new invocation has multiple effective security-policy fingerprints.",
      }),
    ),
    ...(
      diff.invocationGovernanceChangesWithMultipleEffectivePolicyFingerprints ??
      []
    )
      .filter(
        (change) =>
          change.fromDistinctEffectivePolicyFingerprints.length <= 1 &&
          change.toDistinctEffectivePolicyFingerprints.length > 1,
      )
      .map((change) => ({
        id: EXECUTABLE_SURFACE_CI_MATCH_IDS.INVOCATION_POLICY_AMBIGUOUS,
        kind: "invocation" as const,
        transition: "changed" as const,
        ...change,
        summary:
          "An existing invocation became ambiguous across effective security policies.",
      })),
    ...(diff.newlyUnreachableSkillLocalPaths ?? [])
      .filter(isExistingSurfaceTransition)
      .map((path) => ({
        id: EXECUTABLE_SURFACE_CI_MATCH_IDS.SKILL_LOCAL_REACHABILITY_LOST,
        kind: "surface" as const,
        path,
        summary:
          "A Skill-local executable surface became structurally unreachable.",
      })),
    ...(diff.surfacesLostStaticInvocationReachability ?? [])
      .filter(isExistingSurfaceTransition)
      .map((path) => ({
        id: EXECUTABLE_SURFACE_CI_MATCH_IDS.STATIC_INVOCATION_REACHABILITY_LOST,
        kind: "surface" as const,
        path,
        summary: "An executable surface lost static invocation reachability.",
      })),
    ...(diff.newlyTransitivelyReachableSurfacePaths ?? [])
      .filter(isExistingSurfaceTransition)
      .map((path) => ({
        id: EXECUTABLE_SURFACE_CI_MATCH_IDS.TRANSITIVE_REACHABILITY_ADDED,
        kind: "surface" as const,
        path,
        summary:
          "An existing executable surface became newly statically transitively reachable.",
      })),
  ].sort(compareMatches);

  return {
    schemaVersion: EXECUTABLE_SURFACE_CI_POLICY_SCHEMA_VERSION,
    configured: { ...configured, effective },
    outcome:
      effective === "off" || matches.length === 0
        ? "pass"
        : effective === "fail"
          ? "fail"
          : "warn",
    matchCount: matches.length,
    matches,
  };
}

function compareMatches(
  left: ExecutableSurfaceCiMatch,
  right: ExecutableSurfaceCiMatch,
): number {
  return matchKey(left).localeCompare(matchKey(right));
}

function matchKey(match: ExecutableSurfaceCiMatch): string {
  const path = match.kind === "surface" ? match.path : match.sourcePath;
  const target = match.kind === "surface" ? "" : match.target;
  const ordinal =
    match.kind === "surface"
      ? ""
      : String(match.occurrenceOrdinal).padStart(12, "0");
  return `${match.id}\0${path}\0${target}\0${ordinal}`;
}
