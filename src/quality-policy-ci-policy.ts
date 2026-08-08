import type {
  QualityPolicyDiff,
  QualityPolicyThresholdChange,
} from "./quality-policy-diff.js";
import type { QualityCiPolicyMode } from "./types/configuration.js";

export const QUALITY_POLICY_CI_MATCH_IDS = {
  CI_POLICY_RELAXED: "quality_policy_ci.ci_policy_relaxed",
  THRESHOLD_INCREASED: "quality_policy_ci.threshold_increased",
} as const;

export interface QualityPolicyCiConfiguration {
  from: QualityCiPolicyMode;
  to: QualityCiPolicyMode;
}

export type QualityPolicyCiModeTransitionDirection =
  "unchanged" | "weakening" | "tightening";

export interface QualityPolicyCiModeTransition {
  from: QualityCiPolicyMode;
  to: QualityCiPolicyMode;
  direction: QualityPolicyCiModeTransitionDirection;
}

export interface QualityPolicyCiModeRelaxedMatch {
  id: typeof QUALITY_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED;
  summary: string;
  transition: QualityPolicyCiModeTransition & { direction: "weakening" };
}

export interface QualityPolicyThresholdIncreasedMatch {
  id: typeof QUALITY_POLICY_CI_MATCH_IDS.THRESHOLD_INCREASED;
  summary: string;
  change: QualityPolicyThresholdChange;
}

export type QualityPolicyCiMatch =
  QualityPolicyCiModeRelaxedMatch | QualityPolicyThresholdIncreasedMatch;

export interface QualityPolicyCiEvaluation {
  schemaVersion: "renma.quality-policy-ci-policy.v1";
  configured: QualityPolicyCiConfiguration & {
    effective: QualityCiPolicyMode;
  };
  modeTransition: QualityPolicyCiModeTransition;
  numericThresholdChanges: {
    weakenings: number;
    tightenings: number;
  };
  outcome: "pass" | "warn" | "fail";
  /** Total evaluator reasons across CI-mode and numeric-threshold weakening. */
  matchCount: number;
  matches: QualityPolicyCiMatch[];
}

const MODE_RANK: Record<QualityCiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

/** Select the stricter archived-ref mode so the target cannot disable review. */
export function effectiveQualityPolicyCiPolicy(
  configured: QualityPolicyCiConfiguration,
): QualityCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

/** Classify the archived CI-mode transition independently from threshold changes. */
export function qualityPolicyCiModeTransition(
  configured: QualityPolicyCiConfiguration,
): QualityPolicyCiModeTransition {
  const direction: QualityPolicyCiModeTransitionDirection =
    configured.from === configured.to
      ? "unchanged"
      : MODE_RANK[configured.from] > MODE_RANK[configured.to]
        ? "weakening"
        : "tightening";
  return { ...configured, direction };
}

/** Gate numeric threshold increases and CI-mode weakening as independent evidence. */
export function evaluateQualityPolicyCiPolicy(
  diff: Pick<QualityPolicyDiff, "changes">,
  configured: QualityPolicyCiConfiguration,
): QualityPolicyCiEvaluation {
  const effective = effectiveQualityPolicyCiPolicy(configured);
  const modeTransition = qualityPolicyCiModeTransition(configured);
  const thresholdMatches = diff.changes
    .filter((change) => change.direction === "weakening")
    .map((change): QualityPolicyThresholdIncreasedMatch => ({
      id: QUALITY_POLICY_CI_MATCH_IDS.THRESHOLD_INCREASED,
      summary: "A token-budget finding threshold was increased.",
      change,
    }));
  const modeMatches: QualityPolicyCiModeRelaxedMatch[] =
    modeTransition.direction === "weakening"
      ? [
          {
            id: QUALITY_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED,
            summary: "The Quality Policy CI review mode was weakened.",
            transition: { ...modeTransition, direction: "weakening" },
          },
        ]
      : [];
  const matches: QualityPolicyCiMatch[] = [...modeMatches, ...thresholdMatches];

  return {
    schemaVersion: "renma.quality-policy-ci-policy.v1",
    configured: { ...configured, effective },
    modeTransition,
    numericThresholdChanges: {
      weakenings: thresholdMatches.length,
      tightenings: diff.changes.length - thresholdMatches.length,
    },
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
