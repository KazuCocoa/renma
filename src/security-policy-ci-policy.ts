import type { SecurityDiffSummary } from "./security-diff.js";
import type {
  ListSecurityPolicyField,
  ScalarSecurityPolicyField,
  SecurityPolicyAffectedAsset,
  SecurityPolicyBooleanState,
  SecurityPolicyChangeProvenance,
  SecurityPolicyTransition,
} from "./security-policy-diff.js";
import type { SecurityCiPolicyMode } from "./types/configuration.js";

export const SECURITY_POLICY_CI_MATCH_IDS = {
  NETWORK_RELAXED: "security_policy_ci.network_relaxed",
  APPROVED_NETWORK_DESTINATION_ADDED:
    "security_policy_ci.approved_network_destination_added",
  EXTERNAL_UPLOAD_RELAXED: "security_policy_ci.external_upload_relaxed",
  APPROVED_UPLOAD_DESTINATION_ADDED:
    "security_policy_ci.approved_upload_destination_added",
  ALLOWED_DATA_ADDED: "security_policy_ci.allowed_data_added",
  FORBIDDEN_INPUT_REMOVED: "security_policy_ci.forbidden_input_removed",
  SECRETS_RELAXED: "security_policy_ci.secrets_relaxed",
  HUMAN_APPROVAL_REMOVED: "security_policy_ci.human_approval_removed",
  DISALLOWED_COMMAND_REMOVED: "security_policy_ci.disallowed_command_removed",
} as const;

export type SecurityPolicyCiMatchId =
  (typeof SECURITY_POLICY_CI_MATCH_IDS)[keyof typeof SECURITY_POLICY_CI_MATCH_IDS];

type AllowedValueListProperty =
  "approvedNetworkDestinations" | "approvedUploadDestinations" | "allowedData";

type RestrictedValueListProperty = Extract<
  ListSecurityPolicyField,
  "forbiddenInputs" | "disallowedCommands"
>;

interface SecurityPolicyRelaxationBase {
  asset: SecurityPolicyAffectedAsset;
  provenance: SecurityPolicyChangeProvenance;
}

export interface SecurityPolicyScalarRelaxation extends SecurityPolicyRelaxationBase {
  kind: "scalar";
  property: ScalarSecurityPolicyField;
  direction: "restrictive_state_removed";
  fromState: SecurityPolicyBooleanState;
  toState: SecurityPolicyBooleanState;
}

export interface SecurityPolicyAllowedValueRelaxation extends SecurityPolicyRelaxationBase {
  kind: "list";
  property: AllowedValueListProperty;
  direction: "allowed_value_added";
  addedValues: string[];
}

export interface SecurityPolicyRestrictedValueRelaxation extends SecurityPolicyRelaxationBase {
  kind: "list";
  property: RestrictedValueListProperty;
  direction: "restricted_value_removed";
  removedValues: string[];
}

export type SecurityPolicyRelaxation =
  | SecurityPolicyScalarRelaxation
  | SecurityPolicyAllowedValueRelaxation
  | SecurityPolicyRestrictedValueRelaxation;

export type SecurityPolicyCiMatch = SecurityPolicyRelaxation & {
  id: SecurityPolicyCiMatchId;
  summary: string;
};

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
  approvedNetworkDestinations:
    SECURITY_POLICY_CI_MATCH_IDS.APPROVED_NETWORK_DESTINATION_ADDED,
  externalUploadAllowed: SECURITY_POLICY_CI_MATCH_IDS.EXTERNAL_UPLOAD_RELAXED,
  approvedUploadDestinations:
    SECURITY_POLICY_CI_MATCH_IDS.APPROVED_UPLOAD_DESTINATION_ADDED,
  allowedData: SECURITY_POLICY_CI_MATCH_IDS.ALLOWED_DATA_ADDED,
  forbiddenInputs: SECURITY_POLICY_CI_MATCH_IDS.FORBIDDEN_INPUT_REMOVED,
  secretsAllowed: SECURITY_POLICY_CI_MATCH_IDS.SECRETS_RELAXED,
  humanApprovalRequired: SECURITY_POLICY_CI_MATCH_IDS.HUMAN_APPROVAL_REMOVED,
  disallowedCommands: SECURITY_POLICY_CI_MATCH_IDS.DISALLOWED_COMMAND_REMOVED,
};

const MATCH_SUMMARY_BY_PROPERTY: Record<
  SecurityPolicyTransition["property"],
  string
> = {
  networkAllowed: "Effective network policy was relaxed.",
  approvedNetworkDestinations:
    "Effective approved network destinations were expanded.",
  externalUploadAllowed: "Effective external-upload policy was relaxed.",
  approvedUploadDestinations:
    "Effective approved upload destinations were expanded.",
  allowedData: "Effective allowed-data boundary was expanded.",
  forbiddenInputs: "Effective forbidden-input restrictions were removed.",
  secretsAllowed: "Effective secret-handling policy was relaxed.",
  humanApprovalRequired: "Effective human-approval requirement was removed.",
  disallowedCommands: "Effective disallowed-command restrictions were removed.",
};

const MATCH_ID_ORDER = new Map<SecurityPolicyCiMatchId, number>(
  Object.values(SECURITY_POLICY_CI_MATCH_IDS).map((id, index) => [id, index]),
);

const ALLOWED_VALUE_PROPERTIES = new Set<SecurityPolicyTransition["property"]>([
  "approvedNetworkDestinations",
  "approvedUploadDestinations",
  "allowedData",
]);

/** Select the stricter archived-ref mode so a target-only change cannot bypass review. */
export function effectiveSecurityPolicyCiPolicy(
  configured: SecurityPolicyCiConfiguration,
): SecurityCiPolicyMode {
  return MODE_RANK[configured.from] >= MODE_RANK[configured.to]
    ? configured.from
    : configured.to;
}

/** Classify whether a canonical scalar or list transition weakens policy. */
export function isSecurityPolicyRelaxation(
  transition: SecurityPolicyTransition,
): boolean {
  return classifySecurityPolicyRelaxation(transition) !== null;
}

function classifySecurityPolicyRelaxation(
  transition: SecurityPolicyTransition,
): SecurityPolicyRelaxation | null {
  if (transition.kind === "scalar") {
    const relaxed =
      transition.property === "humanApprovalRequired"
        ? transition.fromState === true && transition.toState !== true
        : transition.fromState === false && transition.toState !== false;
    if (!relaxed) return null;
    return {
      kind: "scalar",
      asset: transition.asset,
      property: transition.property,
      direction: "restrictive_state_removed",
      fromState: transition.fromState,
      toState: transition.toState,
      provenance: transition.provenance,
    };
  }

  if (ALLOWED_VALUE_PROPERTIES.has(transition.property)) {
    if (transition.added.length === 0) return null;
    return {
      kind: "list",
      asset: transition.asset,
      property: transition.property as AllowedValueListProperty,
      direction: "allowed_value_added",
      addedValues: transition.added,
      provenance: transition.provenance,
    };
  }

  if (transition.removed.length === 0) return null;
  return {
    kind: "list",
    asset: transition.asset,
    property: transition.property as RestrictedValueListProperty,
    direction: "restricted_value_removed",
    removedValues: transition.removed,
    provenance: transition.provenance,
  };
}

/** Return every independently auditable relaxation in deterministic order. */
export function securityPolicyRelaxations(security: {
  policyTransitions?: readonly SecurityPolicyTransition[];
}): SecurityPolicyRelaxation[] {
  return (security.policyTransitions ?? [])
    .map(classifySecurityPolicyRelaxation)
    .filter((item): item is SecurityPolicyRelaxation => item !== null)
    .sort(compareRelaxations);
}

/** Evaluate policy relaxations over canonical matched-asset transitions. */
export function evaluateSecurityPolicyCiPolicy(
  security: Pick<SecurityDiffSummary, "policyTransitions">,
  configured: SecurityPolicyCiConfiguration,
): SecurityPolicyCiEvaluation {
  const effective = effectiveSecurityPolicyCiPolicy(configured);
  const configuredResult = { ...configured, effective };
  const matches = securityPolicyRelaxations(security)
    .map((relaxation): SecurityPolicyCiMatch => ({
      ...relaxation,
      id: MATCH_ID_BY_PROPERTY[relaxation.property],
      summary: MATCH_SUMMARY_BY_PROPERTY[relaxation.property],
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

function compareRelaxations(
  left: SecurityPolicyRelaxation,
  right: SecurityPolicyRelaxation,
): number {
  return (
    compareMatchIds(
      MATCH_ID_BY_PROPERTY[left.property],
      MATCH_ID_BY_PROPERTY[right.property],
    ) ||
    left.asset.path.localeCompare(right.asset.path) ||
    left.asset.id.localeCompare(right.asset.id) ||
    left.asset.kind.localeCompare(right.asset.kind) ||
    relaxationValue(left).localeCompare(relaxationValue(right))
  );
}

function compareMatches(
  left: SecurityPolicyCiMatch,
  right: SecurityPolicyCiMatch,
): number {
  return (
    compareMatchIds(left.id, right.id) ||
    left.asset.path.localeCompare(right.asset.path) ||
    left.asset.id.localeCompare(right.asset.id) ||
    left.asset.kind.localeCompare(right.asset.kind) ||
    relaxationValue(left).localeCompare(relaxationValue(right))
  );
}

function compareMatchIds(
  left: SecurityPolicyCiMatchId,
  right: SecurityPolicyCiMatchId,
): number {
  return (
    (MATCH_ID_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (MATCH_ID_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

function relaxationValue(relaxation: SecurityPolicyRelaxation): string {
  if (relaxation.kind === "scalar") {
    return `${String(relaxation.fromState)}\0${String(relaxation.toState)}`;
  }
  return relaxation.direction === "allowed_value_added"
    ? relaxation.addedValues.join("\0")
    : relaxation.removedValues.join("\0");
}
