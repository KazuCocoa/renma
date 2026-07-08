import { createHash } from "node:crypto";
import {
  applySecurityConfig,
  effectiveAllowedDataClass,
  effectiveAllowedDataList,
  parseSecurityPolicy,
  securityProfileChain,
  type SecurityPolicy,
} from "./security-policy.js";
import type {
  Artifact,
  ArtifactKind,
  Evidence,
  SecurityConfig,
} from "./types.js";

type InventoryArtifactKind = ArtifactKind;

export interface PolicyBooleanCounts {
  true: number;
  false: number;
  unspecified: number;
}

export interface SecurityPolicyInventorySummary {
  totalPolicyAssets: number;
  assetsWithPolicyMetadata: number;
  assetsMissingPolicyMetadata: number;
  assetKinds: Record<InventoryArtifactKind, number>;
  networkAllowed: PolicyBooleanCounts;
  externalUploadAllowed: PolicyBooleanCounts;
  secretsAllowed: PolicyBooleanCounts;
  humanApprovalRequired: PolicyBooleanCounts;
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
    names: Array<{ name: string; count: number }>;
  };
  topApprovedNetworkDestinations: Array<{ destination: string; count: number }>;
  topApprovedUploadDestinations: Array<{ destination: string; count: number }>;
  topForbiddenInputs: Array<{ input: string; count: number }>;
  missingPolicyAssets: Array<{
    path: string;
    kind: ArtifactKind;
  }>;
}

export interface EffectiveSecurityPolicyEvidence {
  fingerprint: string;
  allowedData: string[];
  forbiddenInputs: string[];
  networkAllowed: boolean | null;
  externalUploadAllowed: boolean | null;
  secretsAllowed: boolean | null;
  humanApprovalRequired: boolean | null;
  approvedNetworkDestinations: string[];
  approvedUploadDestinations: string[];
  disallowedCommands: string[];
}

export type SecurityProfileResolution =
  | "none"
  | "resolved"
  | "missing"
  | "cyclic";

export interface SecurityPolicyAssetEvidence {
  path: string;
  kind: ArtifactKind;
  hasLocalPolicyMetadata: boolean;
  selectedSecurityProfile?: string;
  profileResolution: SecurityProfileResolution;
  profileChain: string[];
  effectivePolicy: EffectiveSecurityPolicyEvidence;
  evidence: {
    selectedSecurityProfile?: Evidence;
    policyFields: Evidence[];
  };
}

const POLICY_INVENTORY_KINDS = new Set<ArtifactKind>([
  "skill",
  "context",
  "agent",
  "profile",
  "reference",
  "example",
  "config",
]);

const ASSET_KINDS: InventoryArtifactKind[] = [
  "skill",
  "context",
  "agent",
  "profile",
  "reference",
  "example",
  "config",
  "unknown",
];

const LOCAL_POLICY_METADATA_FIELDS = new Set([
  "allowedData",
  "networkAllowed",
  "externalUploadAllowed",
  "secretsAllowed",
  "humanApprovalRequired",
  "securityProfile",
  "forbiddenInputs",
  "approvedNetworkDestinations",
  "approvedUploadDestinations",
]);

export function summarizeSecurityPolicyInventory(
  artifacts: Artifact[],
  config?: SecurityConfig,
): SecurityPolicyInventorySummary {
  const summary = zeroSecurityPolicyInventorySummary();
  const networkDestinations = new Map<string, number>();
  const uploadDestinations = new Map<string, number>();
  const forbiddenInputs = new Map<string, number>();
  const profileNames = new Map<string, number>();

  for (const artifact of artifacts) {
    const parsedPolicy = parseSecurityPolicy(artifact.content);
    const hasMetadata = hasLocalSecurityPolicyMetadata(parsedPolicy);
    if (!isPolicyInventoryArtifact(artifact, hasMetadata)) continue;

    const policy = applySecurityConfig(parsedPolicy, config);
    summary.totalPolicyAssets += 1;
    summary.assetKinds[artifact.kind] += 1;

    if (hasMetadata) {
      summary.assetsWithPolicyMetadata += 1;
    }
    if (isMissingPolicyMetadataAsset(artifact, parsedPolicy, policy)) {
      summary.assetsMissingPolicyMetadata += 1;
      summary.missingPolicyAssets.push({
        path: artifact.path,
        kind: artifact.kind,
      });
    }

    countPolicyBoolean(summary.networkAllowed, policy.networkAllowed);
    countPolicyBoolean(
      summary.externalUploadAllowed,
      policy.externalUploadAllowed,
    );
    countPolicyBoolean(summary.secretsAllowed, policy.secretsAllowed);
    countPolicyBoolean(
      summary.humanApprovalRequired,
      policy.humanApprovalRequired,
    );

    summary.approvedNetworkDestinationCount += addUniqueCounts(
      networkDestinations,
      policy.approvedNetworkDestinations,
    );
    summary.approvedUploadDestinationCount += addUniqueCounts(
      uploadDestinations,
      policy.approvedUploadDestinations,
    );
    summary.forbiddenInputCount += addUniqueCounts(
      forbiddenInputs,
      policy.forbiddenInputs,
    );
    summary.disallowedCommandCount += uniqueStrings(
      policy.disallowedCommands,
    ).length;

    countSecurityProfile(summary, profileNames, parsedPolicy, config);
  }

  summary.securityProfiles.names = topCounts(profileNames, "name");
  summary.topApprovedNetworkDestinations = topCounts(
    networkDestinations,
    "destination",
  );
  summary.topApprovedUploadDestinations = topCounts(
    uploadDestinations,
    "destination",
  );
  summary.topForbiddenInputs = topCounts(forbiddenInputs, "input");
  summary.missingPolicyAssets.sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  return summary;
}

export function collectSecurityPolicyAssetEvidence(
  artifacts: Artifact[],
  config?: SecurityConfig,
): SecurityPolicyAssetEvidence[] {
  return artifacts
    .map((artifact): SecurityPolicyAssetEvidence | undefined => {
      const parsedPolicy = parseSecurityPolicy(artifact.content);
      const hasMetadata = hasLocalSecurityPolicyMetadata(parsedPolicy);
      if (!isPolicyInventoryArtifact(artifact, hasMetadata)) return undefined;

      const policy = applySecurityConfig(parsedPolicy, config);
      const chain = securityProfileChain(parsedPolicy.securityProfile, config);
      const selectedSecurityProfile = parsedPolicy.securityProfile;
      const selectedSecurityProfileEvidence = policyFieldEvidence(
        artifact,
        parsedPolicy,
        "securityProfile",
      );
      const row: SecurityPolicyAssetEvidence = {
        path: artifact.path,
        kind: artifact.kind,
        hasLocalPolicyMetadata: hasMetadata,
        ...(selectedSecurityProfile ? { selectedSecurityProfile } : {}),
        profileResolution: profileResolution(selectedSecurityProfile, chain),
        profileChain: chain.profiles.map((item) => item.name),
        effectivePolicy: normalizeEffectivePolicy(policy),
        evidence: {
          ...(selectedSecurityProfileEvidence
            ? { selectedSecurityProfile: selectedSecurityProfileEvidence }
            : {}),
          policyFields: policyFieldEvidenceList(artifact, parsedPolicy),
        },
      };
      return row;
    })
    .filter((row): row is SecurityPolicyAssetEvidence => row !== undefined)
    .sort((left, right) => {
      const byPath = left.path.localeCompare(right.path);
      if (byPath !== 0) return byPath;
      return left.kind.localeCompare(right.kind);
    });
}

export function zeroSecurityPolicyInventorySummary(): SecurityPolicyInventorySummary {
  return {
    totalPolicyAssets: 0,
    assetsWithPolicyMetadata: 0,
    assetsMissingPolicyMetadata: 0,
    assetKinds: zeroAssetKinds(),
    networkAllowed: zeroPolicyBooleanCounts(),
    externalUploadAllowed: zeroPolicyBooleanCounts(),
    secretsAllowed: zeroPolicyBooleanCounts(),
    humanApprovalRequired: zeroPolicyBooleanCounts(),
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
      names: [],
    },
    topApprovedNetworkDestinations: [],
    topApprovedUploadDestinations: [],
    topForbiddenInputs: [],
    missingPolicyAssets: [],
  };
}

export function isPolicyInventoryArtifact(
  artifact: Artifact,
  hasLocalMetadata = hasLocalSecurityPolicyMetadata(
    parseSecurityPolicy(artifact.content),
  ),
): boolean {
  return POLICY_INVENTORY_KINDS.has(artifact.kind) || hasLocalMetadata;
}

export function hasLocalSecurityPolicyMetadata(
  policy: SecurityPolicy,
): boolean {
  return [...LOCAL_POLICY_METADATA_FIELDS].some((field) =>
    policy.declared.has(field),
  );
}

function isMissingPolicyMetadataAsset(
  artifact: Artifact,
  parsedPolicy: SecurityPolicy,
  effectivePolicy: SecurityPolicy,
): boolean {
  return (
    (artifact.kind === "skill" || artifact.kind === "context") &&
    effectiveAllowedDataClass(effectivePolicy) === undefined &&
    effectiveAllowedDataList(effectivePolicy).length === 0 &&
    !hasLocalSecurityPolicyMetadata(parsedPolicy)
  );
}

function zeroAssetKinds(): Record<InventoryArtifactKind, number> {
  return Object.fromEntries(ASSET_KINDS.map((kind) => [kind, 0])) as Record<
    InventoryArtifactKind,
    number
  >;
}

function zeroPolicyBooleanCounts(): PolicyBooleanCounts {
  return {
    true: 0,
    false: 0,
    unspecified: 0,
  };
}

function countPolicyBoolean(
  counts: PolicyBooleanCounts,
  value: boolean | undefined,
): void {
  if (value === true) {
    counts.true += 1;
  } else if (value === false) {
    counts.false += 1;
  } else {
    counts.unspecified += 1;
  }
}

function addUniqueCounts(
  counts: Map<string, number>,
  values: string[],
): number {
  const uniqueValues = uniqueStrings(values);
  for (const value of uniqueValues) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return uniqueValues.length;
}

function countSecurityProfile(
  summary: SecurityPolicyInventorySummary,
  profileNames: Map<string, number>,
  policy: SecurityPolicy,
  config: SecurityConfig | undefined,
): void {
  if (policy.securityProfile === undefined) {
    summary.securityProfiles.none += 1;
    return;
  }

  summary.securityProfiles.referenced += 1;
  profileNames.set(
    policy.securityProfile,
    (profileNames.get(policy.securityProfile) ?? 0) + 1,
  );

  const chain = securityProfileChain(policy.securityProfile, config);
  if (chain.missingProfile !== undefined) {
    summary.securityProfiles.missing += 1;
  } else if (chain.cycle !== undefined) {
    summary.securityProfiles.cyclic += 1;
  } else {
    summary.securityProfiles.resolved += 1;
  }
}

function normalizeEffectivePolicy(
  policy: SecurityPolicy,
): EffectiveSecurityPolicyEvidence {
  const summary = {
    allowedData: normalizeStringList([
      ...(policy.allowedDataClass ? [policy.allowedDataClass] : []),
      ...policy.allowedData,
    ]),
    forbiddenInputs: normalizeStringList(policy.forbiddenInputs),
    networkAllowed: policy.networkAllowed ?? null,
    externalUploadAllowed: policy.externalUploadAllowed ?? null,
    secretsAllowed: policy.secretsAllowed ?? null,
    humanApprovalRequired: policy.humanApprovalRequired ?? null,
    approvedNetworkDestinations: normalizeStringList(
      policy.approvedNetworkDestinations,
    ),
    approvedUploadDestinations: normalizeStringList(
      policy.approvedUploadDestinations,
    ),
    disallowedCommands: normalizeStringList(policy.disallowedCommands),
  };
  return {
    fingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(summary))
      .digest("hex")}`,
    ...summary,
  };
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function profileResolution(
  selectedSecurityProfile: string | undefined,
  chain: ReturnType<typeof securityProfileChain>,
): SecurityProfileResolution {
  if (selectedSecurityProfile === undefined) return "none";
  if (chain.missingProfile !== undefined) return "missing";
  if (chain.cycle !== undefined) return "cyclic";
  return "resolved";
}

function policyFieldEvidenceList(
  artifact: Artifact,
  policy: SecurityPolicy,
): Evidence[] {
  return [
    "allowedData",
    "forbiddenInputs",
    "networkAllowed",
    "externalUploadAllowed",
    "secretsAllowed",
    "humanApprovalRequired",
    "securityProfile",
    "approvedNetworkDestinations",
    "approvedUploadDestinations",
  ]
    .map((field) => policyFieldEvidence(artifact, policy, field))
    .filter((evidence): evidence is Evidence => evidence !== undefined)
    .sort((left, right) => {
      const byStart = left.startLine - right.startLine;
      if (byStart !== 0) return byStart;
      return left.snippet.localeCompare(right.snippet);
    });
}

function policyFieldEvidence(
  artifact: Artifact,
  policy: SecurityPolicy,
  field: string,
): Evidence | undefined {
  const startLine = policy.lineByField.get(field);
  if (startLine === undefined) return undefined;
  const line = artifact.content.split(/\r?\n/)[startLine - 1] ?? "";
  return {
    path: artifact.path,
    startLine,
    endLine: startLine,
    snippet: line.trim(),
  };
}

function topCounts<Key extends string>(
  counts: Map<string, number>,
  key: Key,
): Array<Record<Key, string> & { count: number }> {
  return [...counts.entries()]
    .map(
      ([name, count]) =>
        ({ [key]: name, count }) as Record<Key, string> & {
          count: number;
        },
    )
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left[key].localeCompare(right[key]);
    })
    .slice(0, 10);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
