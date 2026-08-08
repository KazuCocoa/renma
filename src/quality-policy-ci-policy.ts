import type {
  QualityPolicyDiff,
  QualityPolicyThresholdChange,
} from "./quality-policy-diff.js";
import type { QualityCiPolicyMode } from "./types/configuration.js";

export const QUALITY_POLICY_CI_MATCH_IDS = {
  THRESHOLD_INCREASED: "quality_policy_ci.threshold_increased",
} as const;

export interface QualityPolicyCiConfiguration {
  from: QualityCiPolicyMode;
  to: QualityCiPolicyMode;
}

export interface QualityPolicyCiMatch {
  id: typeof QUALITY_POLICY_CI_MATCH_IDS.THRESHOLD_INCREASED;
  summary: string;
  change: QualityPolicyThresholdChange;
}

export interface QualityPolicyCiEvaluation {
  schemaVersion: "renma.quality-policy-ci-policy.v1";
  configured: QualityPolicyCiConfiguration & {
    effective: QualityCiPolicyMode;
  };
  outcome: "pass" | "warn" | "fail";
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

/** Gate only numeric threshold increases; tightening remains visible in the diff. */
export function evaluateQualityPolicyCiPolicy(
  diff: Pick<QualityPolicyDiff, "changes">,
  configured: QualityPolicyCiConfiguration,
): QualityPolicyCiEvaluation {
  const effective = effectiveQualityPolicyCiPolicy(configured);
  const matches = diff.changes
    .filter((change) => change.direction === "weakening")
    .map((change): QualityPolicyCiMatch => ({
      id: QUALITY_POLICY_CI_MATCH_IDS.THRESHOLD_INCREASED,
      summary: "A token-budget finding threshold was increased.",
      change,
    }));

  return {
    schemaVersion: "renma.quality-policy-ci-policy.v1",
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
