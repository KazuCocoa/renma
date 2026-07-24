import type { SkillDiscoveryDiff } from "./skill-discovery-diff.js";
import type { SkillDiscoveryCiPolicyMode } from "./types/configuration.js";

export const SKILL_DISCOVERY_CI_POLICY_MATCH_IDS = {
  ADOPTION_WEAKENED: "skill_discovery_ci.adoption_weakened",
  ADOPTION_INCOMPLETE: "skill_discovery_ci.adoption_incomplete",
  NEWLY_NOT_REACHED: "skill_discovery_ci.newly_not_reached",
  ROUTE_BECAME_UNUSABLE: "skill_discovery_ci.route_became_unusable",
  ADDED_UNUSABLE_ROUTE: "skill_discovery_ci.added_unusable_route",
} as const;

export type SkillDiscoveryCiPolicyMatchId =
  (typeof SKILL_DISCOVERY_CI_POLICY_MATCH_IDS)[keyof typeof SKILL_DISCOVERY_CI_POLICY_MATCH_IDS];

export interface SkillDiscoveryCiPolicyMatch {
  id: SkillDiscoveryCiPolicyMatchId;
  summary: string;
  skill?: {
    id: string;
    path: string;
  };
  route?: {
    sourcePath: string;
    normalizedTarget: string;
  };
  fromState?: string;
  toState?: string;
}

export interface SkillDiscoveryCiPolicyConfiguration {
  from: SkillDiscoveryCiPolicyMode;
  to: SkillDiscoveryCiPolicyMode;
}

export interface SkillDiscoveryCiPolicyEvaluation {
  schemaVersion: "renma.skill-discovery-ci-policy.v1";
  configured: SkillDiscoveryCiPolicyConfiguration & {
    effective: SkillDiscoveryCiPolicyMode;
  };
  outcome: "pass" | "warn";
  matchCount: number;
  matches: SkillDiscoveryCiPolicyMatch[];
}

const MATCH_ID_ORDER = new Map<SkillDiscoveryCiPolicyMatchId, number>(
  Object.values(SKILL_DISCOVERY_CI_POLICY_MATCH_IDS).map((id, index) => [
    id,
    index,
  ]),
);

/** Select the stricter archived-ref mode so a target-only change cannot bypass review. */
export function effectiveSkillDiscoveryCiPolicy(
  configured: SkillDiscoveryCiPolicyConfiguration,
): SkillDiscoveryCiPolicyMode {
  return configured.from === "warn" || configured.to === "warn"
    ? "warn"
    : "off";
}

/** Evaluate the fixed warn-only review conditions over an existing Discovery diff. */
export function evaluateSkillDiscoveryCiPolicy(
  discovery: SkillDiscoveryDiff,
  configured: SkillDiscoveryCiPolicyConfiguration,
): SkillDiscoveryCiPolicyEvaluation {
  const effective = effectiveSkillDiscoveryCiPolicy(configured);
  const configuredResult = {
    from: configured.from,
    to: configured.to,
    effective,
  };
  if (effective === "off") {
    return {
      schemaVersion: "renma.skill-discovery-ci-policy.v1",
      configured: configuredResult,
      outcome: "pass",
      matchCount: 0,
      matches: [],
    };
  }

  const matches = policyMatches(discovery).sort(comparePolicyMatches);
  return {
    schemaVersion: "renma.skill-discovery-ci-policy.v1",
    configured: configuredResult,
    outcome: matches.length > 0 ? "warn" : "pass",
    matchCount: matches.length,
    matches,
  };
}

function policyMatches(
  discovery: SkillDiscoveryDiff,
): SkillDiscoveryCiPolicyMatch[] {
  const matches: SkillDiscoveryCiPolicyMatch[] = [];
  const { adoption, coverage } = discovery;

  if (
    (adoption.from === "adopted" || adoption.from === "incomplete") &&
    (adoption.to === "partial" || adoption.to === "not-adopted")
  ) {
    matches.push({
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADOPTION_WEAKENED,
      summary: "Repository-wide Skill Discovery adoption weakened.",
      fromState: adoption.from,
      toState: adoption.to,
    });
  }

  if (adoption.to === "incomplete") {
    matches.push({
      id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADOPTION_INCOMPLETE,
      summary: "Repository-wide Skill Discovery adoption is incomplete.",
      fromState: adoption.from,
      toState: adoption.to,
    });
  }

  if (coverage.to === "authoritative") {
    for (const skill of discovery.reachability.newlyNotReached) {
      matches.push({
        id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.NEWLY_NOT_REACHED,
        summary:
          "Eligible Skill became not-reached under authoritative coverage.",
        skill: {
          id: skill.id,
          path: skill.path,
        },
      });
    }

    for (const change of discovery.routes.changed) {
      if (change.from.usable && !change.to.usable) {
        matches.push({
          id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ROUTE_BECAME_UNUSABLE,
          summary: "Existing Skill Discovery route became unusable.",
          route: {
            sourcePath: change.identity.sourcePath,
            normalizedTarget: change.identity.normalizedTarget,
          },
          fromState: "usable",
          toState: "unusable",
        });
      }
    }

    for (const route of discovery.routes.added) {
      if (!route.usable) {
        matches.push({
          id: SKILL_DISCOVERY_CI_POLICY_MATCH_IDS.ADDED_UNUSABLE_ROUTE,
          summary: "New unusable Skill Discovery route was added.",
          route: {
            sourcePath: route.sourcePath,
            normalizedTarget: route.normalizedTarget,
          },
          toState: "unusable",
        });
      }
    }
  }

  return matches;
}

function comparePolicyMatches(
  left: SkillDiscoveryCiPolicyMatch,
  right: SkillDiscoveryCiPolicyMatch,
): number {
  return (
    (MATCH_ID_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (MATCH_ID_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    (left.skill?.path ?? "").localeCompare(right.skill?.path ?? "") ||
    (left.route?.sourcePath ?? "").localeCompare(
      right.route?.sourcePath ?? "",
    ) ||
    (left.route?.normalizedTarget ?? "").localeCompare(
      right.route?.normalizedTarget ?? "",
    ) ||
    (left.skill?.id ?? "").localeCompare(right.skill?.id ?? "")
  );
}
