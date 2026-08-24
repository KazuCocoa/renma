import {
  summarizeSecurityPosture,
  type SecurityPostureSummary,
} from "./security-posture.js";
import {
  zeroSecurityPolicyInventorySummary,
  type ExternalUploadGovernanceCounts,
  type PolicyBooleanCounts,
  type SecurityPolicyInventorySummary,
} from "./security-policy-inventory.js";
import {
  buildSecurityPolicyChanges,
  type SecurityPolicyAssetChange,
  type SecurityPolicyDiffInput,
  type SecurityPolicyTransition,
  type SharedSecurityPolicyChange,
} from "./security-policy-diff.js";

interface SecurityPostureDelta {
  added: SecurityPostureSummary;
  resolved: SecurityPostureSummary;
}

interface PolicyBooleanDelta {
  true: number;
  false: number;
  unspecified: number;
}

type ExternalUploadGovernanceDelta = ExternalUploadGovernanceCounts;

interface SecurityPolicyInventoryDelta {
  totalPolicyAssets: number;
  assetsWithLocalPolicyMetadata: number;
  assetsWithInheritedPolicy: number;
  assetsWithEffectivePolicy: number;
  assetsWithoutEffectivePolicy: number;
  policySources: Record<
    keyof SecurityPolicyInventorySummary["policySources"],
    number
  >;
  networkAllowed: PolicyBooleanDelta;
  externalUploadAllowed: PolicyBooleanDelta;
  externalUploadGovernance: ExternalUploadGovernanceDelta;
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
  policyChanges: SecurityPolicyAssetChange[];
  policyTransitions: SecurityPolicyTransition[];
  sharedPolicyChanges: SharedSecurityPolicyChange[];
}

export function buildSecurityDiffSummary(
  input: {
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
  } & SecurityPolicyDiffInput,
): SecurityDiffSummary {
  const fromPolicyInventory =
    input.fromPolicyInventory ?? zeroSecurityPolicyInventorySummary();
  const toPolicyInventory =
    input.toPolicyInventory ?? zeroSecurityPolicyInventorySummary();

  const policyDetails = buildSecurityPolicyChanges(input);
  return {
    posture: {
      added: summarizeSecurityPosture(input.addedFindings),
      resolved: summarizeSecurityPosture(input.removedFindings),
    },
    policyInventory: deltaSecurityPolicyInventory(
      toPolicyInventory,
      fromPolicyInventory,
    ),
    ...policyDetails,
  };
}

function deltaNumber(to: number, from: number): number {
  return to - from;
}

function deltaPolicyBoolean(
  to: PolicyBooleanCounts,
  from: PolicyBooleanCounts,
): PolicyBooleanDelta {
  return {
    true: deltaNumber(to.true, from.true),
    false: deltaNumber(to.false, from.false),
    unspecified: deltaNumber(to.unspecified, from.unspecified),
  };
}

function deltaProfileCounts(
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
    assetsWithLocalPolicyMetadata: 0,
    assetsWithInheritedPolicy: 0,
    assetsWithEffectivePolicy: 0,
    assetsWithoutEffectivePolicy: 0,
    policySources: {
      local: 0,
      security_profile: 0,
      repository_config: 0,
      owning_skill: 0,
    },
    networkAllowed: zeroPolicyBooleanDelta(),
    externalUploadAllowed: zeroPolicyBooleanDelta(),
    externalUploadGovernance: zeroExternalUploadGovernanceDelta(),
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
    assetsWithLocalPolicyMetadata: deltaNumber(
      to.assetsWithLocalPolicyMetadata,
      from.assetsWithLocalPolicyMetadata,
    ),
    assetsWithInheritedPolicy: deltaNumber(
      to.assetsWithInheritedPolicy,
      from.assetsWithInheritedPolicy,
    ),
    assetsWithEffectivePolicy: deltaNumber(
      to.assetsWithEffectivePolicy,
      from.assetsWithEffectivePolicy,
    ),
    assetsWithoutEffectivePolicy: deltaNumber(
      to.assetsWithoutEffectivePolicy,
      from.assetsWithoutEffectivePolicy,
    ),
    policySources: {
      local: deltaNumber(to.policySources.local, from.policySources.local),
      security_profile: deltaNumber(
        to.policySources.security_profile,
        from.policySources.security_profile,
      ),
      repository_config: deltaNumber(
        to.policySources.repository_config,
        from.policySources.repository_config,
      ),
      owning_skill: deltaNumber(
        to.policySources.owning_skill,
        from.policySources.owning_skill,
      ),
    },
    networkAllowed: deltaPolicyBoolean(to.networkAllowed, from.networkAllowed),
    externalUploadAllowed: deltaPolicyBoolean(
      to.externalUploadAllowed,
      from.externalUploadAllowed,
    ),
    externalUploadGovernance: deltaExternalUploadGovernance(
      to.externalUploadGovernance,
      from.externalUploadGovernance,
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

function zeroExternalUploadGovernanceDelta(): ExternalUploadGovernanceDelta {
  return {
    denied: 0,
    allowedApprovalRequired: 0,
    allowedNoApprovalRequired: 0,
    allowedApprovalUnspecified: 0,
    unspecified: 0,
  };
}

function deltaExternalUploadGovernance(
  to: ExternalUploadGovernanceCounts,
  from: ExternalUploadGovernanceCounts,
): ExternalUploadGovernanceDelta {
  return {
    denied: deltaNumber(to.denied, from.denied),
    allowedApprovalRequired: deltaNumber(
      to.allowedApprovalRequired,
      from.allowedApprovalRequired,
    ),
    allowedNoApprovalRequired: deltaNumber(
      to.allowedNoApprovalRequired,
      from.allowedNoApprovalRequired,
    ),
    allowedApprovalUnspecified: deltaNumber(
      to.allowedApprovalUnspecified,
      from.allowedApprovalUnspecified,
    ),
    unspecified: deltaNumber(to.unspecified, from.unspecified),
  };
}
