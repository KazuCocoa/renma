import type {
  MetadataPolicyDiff,
  MetadataPolicyRequiredFieldChange,
} from "./metadata-policy-diff.js";
import type { MetadataCiPolicyMode } from "./types/configuration.js";

export const METADATA_POLICY_CI_POLICY_SCHEMA_VERSION =
  "renma.metadata-policy-ci-policy.v1" as const;

export const METADATA_POLICY_CI_MATCH_IDS = {
  CI_POLICY_RELAXED: "metadata_policy_ci.ci_policy_relaxed",
  REQUIRED_FIELD_REMOVED: "metadata_policy_ci.required_field_removed",
} as const;

export interface MetadataPolicyCiConfiguration {
  from: MetadataCiPolicyMode;
  to: MetadataCiPolicyMode;
}

export type MetadataPolicyCiModeTransitionDirection =
  "unchanged" | "weakening" | "tightening";

export interface MetadataPolicyCiModeTransition {
  from: MetadataCiPolicyMode;
  to: MetadataCiPolicyMode;
  direction: MetadataPolicyCiModeTransitionDirection;
}

export type MetadataPolicyCiMatch =
  | {
      id: typeof METADATA_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED;
      summary: string;
      transition: MetadataPolicyCiModeTransition & { direction: "weakening" };
    }
  | {
      id: typeof METADATA_POLICY_CI_MATCH_IDS.REQUIRED_FIELD_REMOVED;
      summary: string;
      change: MetadataPolicyRequiredFieldChange & { direction: "weakening" };
    };

export interface MetadataPolicyCiEvaluation {
  schemaVersion: typeof METADATA_POLICY_CI_POLICY_SCHEMA_VERSION;
  configured: MetadataPolicyCiConfiguration & {
    effective: MetadataCiPolicyMode;
  };
  modeTransition: MetadataPolicyCiModeTransition;
  requiredFieldChanges: {
    weakenings: number;
    tightenings: number;
  };
  outcome: "pass" | "warn" | "fail";
  matchCount: number;
  matches: MetadataPolicyCiMatch[];
}

const MODE_RANK: Record<MetadataCiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

/** Select the stricter archived endpoint so a target cannot disable review. */
export function effectiveMetadataPolicyCiPolicy(
  configured: MetadataPolicyCiConfiguration,
): MetadataCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

export function metadataPolicyCiModeTransition(
  configured: MetadataPolicyCiConfiguration,
): MetadataPolicyCiModeTransition {
  return {
    ...configured,
    direction:
      configured.from === configured.to
        ? "unchanged"
        : MODE_RANK[configured.from] > MODE_RANK[configured.to]
          ? "weakening"
          : "tightening",
  };
}

/** Gate required-field removal and CI-mode weakening as independent evidence. */
export function evaluateMetadataPolicyCiPolicy(
  diff: Pick<MetadataPolicyDiff, "changes">,
  configured: MetadataPolicyCiConfiguration,
): MetadataPolicyCiEvaluation {
  const effective = effectiveMetadataPolicyCiPolicy(configured);
  const modeTransition = metadataPolicyCiModeTransition(configured);
  const modeMatches: MetadataPolicyCiMatch[] =
    modeTransition.direction === "weakening"
      ? [
          {
            id: METADATA_POLICY_CI_MATCH_IDS.CI_POLICY_RELAXED,
            summary: "The metadata-policy CI review mode was weakened.",
            transition: { ...modeTransition, direction: "weakening" },
          },
        ]
      : [];
  const fieldMatches: MetadataPolicyCiMatch[] = diff.changes
    .filter(
      (
        change,
      ): change is MetadataPolicyRequiredFieldChange & {
        direction: "weakening";
      } => change.direction === "weakening",
    )
    .map((change) => ({
      id: METADATA_POLICY_CI_MATCH_IDS.REQUIRED_FIELD_REMOVED,
      summary: "A repository-required metadata field was removed.",
      change,
    }));
  const matches = [...modeMatches, ...fieldMatches];
  const weakenings = fieldMatches.length;

  return {
    schemaVersion: METADATA_POLICY_CI_POLICY_SCHEMA_VERSION,
    configured: { ...configured, effective },
    modeTransition,
    requiredFieldChanges: {
      weakenings,
      tightenings: diff.changes.length - weakenings,
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
