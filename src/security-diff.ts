import {
  summarizeSecurityPosture,
  type SecurityPostureSummary,
} from "./security-posture.js";
import {
  zeroSecurityPolicyInventorySummary,
  type PolicyBooleanCounts,
  type SecurityPolicyInventorySummary,
} from "./security-policy-inventory.js";

export interface SecurityPostureDelta {
  added: SecurityPostureSummary;
  resolved: SecurityPostureSummary;
}

export interface PolicyBooleanDelta {
  true: number;
  false: number;
  unspecified: number;
}

export interface SecurityPolicyInventoryDelta {
  totalPolicyAssets: number;
  assetsWithPolicyMetadata: number;
  assetsMissingPolicyMetadata: number;
  networkAllowed: PolicyBooleanDelta;
  externalUploadAllowed: PolicyBooleanDelta;
  secretsAllowed: PolicyBooleanDelta;
  humanApprovalRequired: PolicyBooleanDelta;
  approvedNetworkDestinationCount: number;
  approvedUploadDestinationCount: number;
  forbiddenInputCount: number;
  disallowedCommandCount: number;
  securityProfiles: {
    referenced: number;
    resolved: number;
    missing: number;
    cyclic: number;
    none: number;
  };
}

export interface SecurityDiffSummary {
  posture: SecurityPostureDelta;
  policyInventory: SecurityPolicyInventoryDelta;
}

export function buildSecurityDiffSummary(input: {
  addedFindings: Array<{
    id: string;
    severity: string;
    riskClass?: string | undefined;
  }>;
  removedFindings: Array<{
    id: string;
    severity: string;
    riskClass?: string | undefined;
  }>;
  fromPolicyInventory?: SecurityPolicyInventorySummary | undefined;
  toPolicyInventory?: SecurityPolicyInventorySummary | undefined;
}): SecurityDiffSummary {
  const fromPolicyInventory =
    input.fromPolicyInventory ?? zeroSecurityPolicyInventorySummary();
  const toPolicyInventory =
    input.toPolicyInventory ?? zeroSecurityPolicyInventorySummary();

  return {
    posture: {
      added: summarizeSecurityPosture(input.addedFindings),
      resolved: summarizeSecurityPosture(input.removedFindings),
    },
    policyInventory: deltaSecurityPolicyInventory(
      toPolicyInventory,
      fromPolicyInventory,
    ),
  };
}

export function deltaNumber(to: number, from: number): number {
  return to - from;
}

export function deltaPolicyBoolean(
  to: PolicyBooleanCounts,
  from: PolicyBooleanCounts,
): PolicyBooleanDelta {
  return {
    true: deltaNumber(to.true, from.true),
    false: deltaNumber(to.false, from.false),
    unspecified: deltaNumber(to.unspecified, from.unspecified),
  };
}

export function deltaProfileCounts(
  to: SecurityPolicyInventorySummary["securityProfiles"],
  from: SecurityPolicyInventorySummary["securityProfiles"],
): SecurityPolicyInventoryDelta["securityProfiles"] {
  return {
    referenced: deltaNumber(to.referenced, from.referenced),
    resolved: deltaNumber(to.resolved, from.resolved),
    missing: deltaNumber(to.missing, from.missing),
    cyclic: deltaNumber(to.cyclic, from.cyclic),
    none: deltaNumber(to.none, from.none),
  };
}

export function zeroSecurityPolicyInventoryDelta(): SecurityPolicyInventoryDelta {
  return {
    totalPolicyAssets: 0,
    assetsWithPolicyMetadata: 0,
    assetsMissingPolicyMetadata: 0,
    networkAllowed: zeroPolicyBooleanDelta(),
    externalUploadAllowed: zeroPolicyBooleanDelta(),
    secretsAllowed: zeroPolicyBooleanDelta(),
    humanApprovalRequired: zeroPolicyBooleanDelta(),
    approvedNetworkDestinationCount: 0,
    approvedUploadDestinationCount: 0,
    forbiddenInputCount: 0,
    disallowedCommandCount: 0,
    securityProfiles: {
      referenced: 0,
      resolved: 0,
      missing: 0,
      cyclic: 0,
      none: 0,
    },
  };
}

function deltaSecurityPolicyInventory(
  to: SecurityPolicyInventorySummary,
  from: SecurityPolicyInventorySummary,
): SecurityPolicyInventoryDelta {
  return {
    totalPolicyAssets: deltaNumber(
      to.totalPolicyAssets,
      from.totalPolicyAssets,
    ),
    assetsWithPolicyMetadata: deltaNumber(
      to.assetsWithPolicyMetadata,
      from.assetsWithPolicyMetadata,
    ),
    assetsMissingPolicyMetadata: deltaNumber(
      to.assetsMissingPolicyMetadata,
      from.assetsMissingPolicyMetadata,
    ),
    networkAllowed: deltaPolicyBoolean(to.networkAllowed, from.networkAllowed),
    externalUploadAllowed: deltaPolicyBoolean(
      to.externalUploadAllowed,
      from.externalUploadAllowed,
    ),
    secretsAllowed: deltaPolicyBoolean(to.secretsAllowed, from.secretsAllowed),
    humanApprovalRequired: deltaPolicyBoolean(
      to.humanApprovalRequired,
      from.humanApprovalRequired,
    ),
    approvedNetworkDestinationCount: deltaNumber(
      to.approvedNetworkDestinationCount,
      from.approvedNetworkDestinationCount,
    ),
    approvedUploadDestinationCount: deltaNumber(
      to.approvedUploadDestinationCount,
      from.approvedUploadDestinationCount,
    ),
    forbiddenInputCount: deltaNumber(
      to.forbiddenInputCount,
      from.forbiddenInputCount,
    ),
    disallowedCommandCount: deltaNumber(
      to.disallowedCommandCount,
      from.disallowedCommandCount,
    ),
    securityProfiles: deltaProfileCounts(
      to.securityProfiles,
      from.securityProfiles,
    ),
  };
}

function zeroPolicyBooleanDelta(): PolicyBooleanDelta {
  return {
    true: 0,
    false: 0,
    unspecified: 0,
  };
}
