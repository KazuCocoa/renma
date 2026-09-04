import type {
  DiagnosticSeverityPolicyChange,
  DiagnosticSeverityPolicyDiff,
} from "./diagnostic-severity-policy-diff.js";
import type { DiagnosticsCiPolicyMode } from "./types/configuration.js";

export const DIAGNOSTIC_SEVERITY_CI_POLICY_SCHEMA_VERSION =
  "renma.diagnostic-severity-ci-policy.v1" as const;

export const DIAGNOSTIC_SEVERITY_CI_MATCH_IDS = {
  CI_POLICY_RELAXED: "diagnostic_severity_ci.ci_policy_relaxed",
  SEVERITY_POLICY_WEAKENED: "diagnostic_severity_ci.severity_policy_weakened",
} as const;

export interface DiagnosticSeverityCiConfiguration {
  from: DiagnosticsCiPolicyMode;
  to: DiagnosticsCiPolicyMode;
}

export type DiagnosticSeverityCiModeTransitionDirection =
  "unchanged" | "weakening" | "tightening";

export interface DiagnosticSeverityCiModeTransition {
  from: DiagnosticsCiPolicyMode;
  to: DiagnosticsCiPolicyMode;
  direction: DiagnosticSeverityCiModeTransitionDirection;
}

export type DiagnosticSeverityCiMatch =
  | {
      id: typeof DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.CI_POLICY_RELAXED;
      summary: string;
      transition: DiagnosticSeverityCiModeTransition & {
        direction: "weakening";
      };
    }
  | {
      id: typeof DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.SEVERITY_POLICY_WEAKENED;
      summary: string;
      change: DiagnosticSeverityPolicyChange & { direction: "weakening" };
    };

export interface DiagnosticSeverityCiEvaluation {
  schemaVersion: typeof DIAGNOSTIC_SEVERITY_CI_POLICY_SCHEMA_VERSION;
  configured: DiagnosticSeverityCiConfiguration & {
    effective: DiagnosticsCiPolicyMode;
  };
  modeTransition: DiagnosticSeverityCiModeTransition;
  severityChanges: {
    weakenings: number;
    tightenings: number;
  };
  outcome: "pass" | "warn" | "fail";
  matchCount: number;
  matches: DiagnosticSeverityCiMatch[];
}

const MODE_RANK: Record<DiagnosticsCiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

/** Select the stricter endpoint so a target cannot disable review. */
export function effectiveDiagnosticSeverityCiPolicy(
  configured: DiagnosticSeverityCiConfiguration,
): DiagnosticsCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

export function diagnosticSeverityCiModeTransition(
  configured: DiagnosticSeverityCiConfiguration,
): DiagnosticSeverityCiModeTransition {
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

/** Gate severity-policy weakening and CI-mode weakening independently. */
export function evaluateDiagnosticSeverityCiPolicy(
  diff: Pick<DiagnosticSeverityPolicyDiff, "changes">,
  configured: DiagnosticSeverityCiConfiguration,
): DiagnosticSeverityCiEvaluation {
  const effective = effectiveDiagnosticSeverityCiPolicy(configured);
  const modeTransition = diagnosticSeverityCiModeTransition(configured);
  const modeMatches: DiagnosticSeverityCiMatch[] =
    modeTransition.direction === "weakening"
      ? [
          {
            id: DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.CI_POLICY_RELAXED,
            summary: "The diagnostic-severity CI review mode was weakened.",
            transition: { ...modeTransition, direction: "weakening" },
          },
        ]
      : [];
  const severityMatches: DiagnosticSeverityCiMatch[] = diff.changes
    .filter(
      (
        change,
      ): change is DiagnosticSeverityPolicyChange & {
        direction: "weakening";
      } => change.direction === "weakening",
    )
    .map((change) => ({
      id: DIAGNOSTIC_SEVERITY_CI_MATCH_IDS.SEVERITY_POLICY_WEAKENED,
      summary: "A repository diagnostic severity policy was weakened.",
      change,
    }));
  const matches = [...modeMatches, ...severityMatches];

  return {
    schemaVersion: DIAGNOSTIC_SEVERITY_CI_POLICY_SCHEMA_VERSION,
    configured: { ...configured, effective },
    modeTransition,
    severityChanges: {
      weakenings: severityMatches.length,
      tightenings: diff.changes.length - severityMatches.length,
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
