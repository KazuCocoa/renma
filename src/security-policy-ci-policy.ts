import type { SecurityDiffSummary } from "./security-diff.js";
import type {
  SecurityPolicyAffectedAsset,
  SecurityPolicyBooleanState,
  SecurityPolicyChangeProvenance,
  SecurityPolicyTransition,
} from "./security-policy-diff.js";
import type { SecurityCiPolicyMode } from "./types/configuration.js";

export const SECURITY_POLICY_CI_MATCH_IDS = {
  NETWORK_RELAXED: "security_policy_ci.network_relaxed",
  EXTERNAL_UPLOAD_RELAXED: "security_policy_ci.external_upload_relaxed",
  SECRETS_RELAXED: "security_policy_ci.secrets_relaxed",
  HUMAN_APPROVAL_REMOVED: "security_policy_ci.human_approval_removed",
} as const;

export type SecurityPolicyCiMatchId =
  (typeof SECURITY_POLICY_CI_MATCH_IDS)[keyof typeof SECURITY_POLICY_CI_MATCH_IDS];

export interface SecurityPolicyCiMatch {
  id: SecurityPolicyCiMatchId;
  summary: string;
  asset: SecurityPolicyAffectedAsset;
  property: SecurityPolicyTransition["property"];
  fromState: SecurityPolicyBooleanState;
  toState: SecurityPolicyBooleanState;
  provenance: SecurityPolicyChangeProvenance;
}

export interface SecurityPolicyCiConfiguration {
  from: SecurityCiPolicyMode;
  to: SecurityCiPolicyMode;
}

export interface SecurityPolicyCiEvaluation {
  schemaVersion: "renma.security-policy-ci-policy.v1";
  configured: SecurityPolicyCiConfiguration & {
    effective: SecurityCiPolicyMode;
  };
  outcome: "pass" | "warn" | "fail";
  matchCount: number;
  matches: SecurityPolicyCiMatch[];
}

const MODE_RANK: Record<SecurityCiPolicyMode, number> = {
  off: 0,
  warn: 1,
  fail: 2,
};

const MATCH_ID_BY_PROPERTY: Record<
  SecurityPolicyTransition["property"],
  SecurityPolicyCiMatchId
> = {
  networkAllowed: SECURITY_POLICY_CI_MATCH_IDS.NETWORK_RELAXED,
  externalUploadAllowed: SECURITY_POLICY_CI_MATCH_IDS.EXTERNAL_UPLOAD_RELAXED,
  secretsAllowed: SECURITY_POLICY_CI_MATCH_IDS.SECRETS_RELAXED,
  humanApprovalRequired: SECURITY_POLICY_CI_MATCH_IDS.HUMAN_APPROVAL_REMOVED,
};

const MATCH_SUMMARY_BY_PROPERTY: Record<
  SecurityPolicyTransition["property"],
  string
> = {
  networkAllowed: "Effective network policy was relaxed.",
  externalUploadAllowed: "Effective external-upload policy was relaxed.",
  secretsAllowed: "Effective secret-handling policy was relaxed.",
  humanApprovalRequired: "Effective human-approval requirement was removed.",
};

const MATCH_ID_ORDER = new Map<SecurityPolicyCiMatchId, number>(
  Object.values(SECURITY_POLICY_CI_MATCH_IDS).map((id, index) => [id, index]),
);

/** Select the stricter archived-ref mode so a target-only change cannot bypass review. */
export function effectiveSecurityPolicyCiPolicy(
  configured: SecurityPolicyCiConfiguration,
): SecurityCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

/**
 * Classify relaxation from Renma's effective diagnostic semantics.
 * Permission fields are restrictive only when false; approval is restrictive
 * only when true. Unspecified therefore shares the non-restrictive tier.
 */
export function isSecurityPolicyRelaxation(
  transition: SecurityPolicyTransition,
): boolean {
  if (transition.property === "humanApprovalRequired") {
    return transition.fromState === true && transition.toState !== true;
  }
  return transition.fromState === false && transition.toState !== false;
}

/** Return every independently auditable relaxation in deterministic order. */
export function securityPolicyRelaxations(security: {
  policyTransitions?: readonly SecurityPolicyTransition[];
}): SecurityPolicyTransition[] {
  return [...(security.policyTransitions ?? [])]
    .filter(isSecurityPolicyRelaxation)
    .sort(compareTransitions);
}

/** Evaluate policy relaxations over canonical matched-asset transitions. */
export function evaluateSecurityPolicyCiPolicy(
  security: Pick<SecurityDiffSummary, "policyTransitions">,
  configured: SecurityPolicyCiConfiguration,
): SecurityPolicyCiEvaluation {
  const effective = effectiveSecurityPolicyCiPolicy(configured);
  const configuredResult = { ...configured, effective };
  const matches = securityPolicyRelaxations(security)
    .map((transition): SecurityPolicyCiMatch => ({
      id: MATCH_ID_BY_PROPERTY[transition.property],
      summary: MATCH_SUMMARY_BY_PROPERTY[transition.property],
      asset: transition.asset,
      property: transition.property,
      fromState: transition.fromState,
      toState: transition.toState,
      provenance: transition.provenance,
    }))
    .sort(compareMatches);

  if (effective === "off") {
    return {
      schemaVersion: "renma.security-policy-ci-policy.v1",
      configured: configuredResult,
      outcome: "pass",
      matchCount: matches.length,
      matches,
    };
  }

  return {
    schemaVersion: "renma.security-policy-ci-policy.v1",
    configured: configuredResult,
    outcome:
      matches.length === 0 ? "pass" : effective === "fail" ? "fail" : "warn",
    matchCount: matches.length,
    matches,
  };
}

function compareTransitions(
  left: SecurityPolicyTransition,
  right: SecurityPolicyTransition,
): number {
  return (
    (MATCH_ID_ORDER.get(MATCH_ID_BY_PROPERTY[left.property]) ??
      Number.MAX_SAFE_INTEGER) -
      (MATCH_ID_ORDER.get(MATCH_ID_BY_PROPERTY[right.property]) ??
        Number.MAX_SAFE_INTEGER) ||
    left.asset.path.localeCompare(right.asset.path) ||
    left.asset.id.localeCompare(right.asset.id) ||
    left.asset.kind.localeCompare(right.asset.kind) ||
    String(left.fromState).localeCompare(String(right.fromState)) ||
    String(left.toState).localeCompare(String(right.toState))
  );
}

function compareMatches(
  left: SecurityPolicyCiMatch,
  right: SecurityPolicyCiMatch,
): number {
  return (
    (MATCH_ID_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (MATCH_ID_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    left.asset.path.localeCompare(right.asset.path) ||
    left.asset.id.localeCompare(right.asset.id) ||
    left.asset.kind.localeCompare(right.asset.kind) ||
    String(left.fromState).localeCompare(String(right.fromState)) ||
    String(left.toState).localeCompare(String(right.toState))
  );
}
