import type {
  DeclaredSecurityPolicyEvidence,
  EffectiveSecurityPolicyEvidence,
  SecurityPolicyAssetEvidence,
  SecurityPolicySource,
} from "./security-policy-inventory.js";
import type { ArtifactKind } from "./types/artifact.js";
import type {
  SecurityConfig,
  SecurityProfileConfig,
} from "./types/configuration.js";

export const REVIEWABLE_SECURITY_POLICY_FIELDS = [
  "networkAllowed",
  "approvedNetworkDestinations",
  "externalUploadAllowed",
  "approvedUploadDestinations",
  "allowedData",
  "forbiddenInputs",
  "secretsAllowed",
  "humanApprovalRequired",
  "disallowedCommands",
] as const;

export type ReviewableSecurityPolicyField =
  (typeof REVIEWABLE_SECURITY_POLICY_FIELDS)[number];

type ScalarSecurityPolicyField =
  | "networkAllowed"
  | "externalUploadAllowed"
  | "secretsAllowed"
  | "humanApprovalRequired";

type ListSecurityPolicyField = Exclude<
  ReviewableSecurityPolicyField,
  ScalarSecurityPolicyField
>;

export interface SecurityPolicyAffectedAsset {
  id: string;
  path: string;
  kind: ArtifactKind;
}

export interface SecurityPolicyChangeSource {
  type: "asset" | "owning_skill" | "security_profile" | "repository_config";
  id: string;
  path?: string;
}

export interface SecurityPolicyChangeProvenance {
  mode: "direct" | "inherited" | "mixed";
  sources: SecurityPolicyChangeSource[];
}

export interface SecurityPolicyScalarChange {
  kind: "scalar";
  field: ScalarSecurityPolicyField;
  before: boolean | null;
  after: boolean | null;
  provenance: SecurityPolicyChangeProvenance;
}

export interface SecurityPolicyListChange {
  kind: "list";
  field: ListSecurityPolicyField;
  added: string[];
  removed: string[];
  provenance: SecurityPolicyChangeProvenance;
}

export type SecurityPolicyFieldChange =
  SecurityPolicyScalarChange | SecurityPolicyListChange;

export interface ReviewableEffectiveSecurityPolicy {
  hasEffectivePolicy: boolean;
  policySources: SecurityPolicySource[];
  selectedSecurityProfile: string | null;
  profileChain: string[];
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

export interface SecurityPolicyAssetChange {
  asset: SecurityPolicyAffectedAsset;
  before: ReviewableEffectiveSecurityPolicy | null;
  after: ReviewableEffectiveSecurityPolicy | null;
  fields: SecurityPolicyFieldChange[];
}

export interface SharedSecurityPolicyChange {
  source: SecurityPolicyChangeSource & {
    type: "security_profile" | "repository_config";
  };
  changedFields: ReviewableSecurityPolicyField[];
  affectedAssets: SecurityPolicyAffectedAsset[];
}

export interface SecurityPolicyDiffInput {
  fromAssets?: readonly SecurityPolicyAssetEvidence[] | undefined;
  toAssets?: readonly SecurityPolicyAssetEvidence[] | undefined;
  fromConfig?: SecurityConfig | undefined;
  toConfig?: SecurityConfig | undefined;
  fromConfigPath?: string | undefined;
  toConfigPath?: string | undefined;
  fromAssetIdsByPath?: ReadonlyMap<string, string> | undefined;
  toAssetIdsByPath?: ReadonlyMap<string, string> | undefined;
}

interface PreparedAsset {
  evidence: SecurityPolicyAssetEvidence;
  identity: SecurityPolicyAffectedAsset;
}

interface FieldProvenanceResult {
  provenance: SecurityPolicyChangeProvenance;
  changedSharedSources: SecurityPolicyChangeSource[];
}

const SCALAR_FIELDS = new Set<ReviewableSecurityPolicyField>([
  "networkAllowed",
  "externalUploadAllowed",
  "secretsAllowed",
  "humanApprovalRequired",
]);

const EMPTY_DECLARED_POLICY: DeclaredSecurityPolicyEvidence = {
  fields: [],
  allowedData: [],
  forbiddenInputs: [],
  networkAllowed: null,
  externalUploadAllowed: null,
  secretsAllowed: null,
  humanApprovalRequired: null,
  approvedNetworkDestinations: [],
  approvedUploadDestinations: [],
  disallowedCommands: [],
};

export function buildSecurityPolicyChanges(input: SecurityPolicyDiffInput): {
  policyChanges: SecurityPolicyAssetChange[];
  sharedPolicyChanges: SharedSecurityPolicyChange[];
} {
  const fromPrepared = prepareAssets(
    input.fromAssets ?? [],
    input.fromAssetIdsByPath,
  );
  const toPrepared = prepareAssets(
    input.toAssets ?? [],
    input.toAssetIdsByPath,
  );
  const fromIdCounts = countAssetIds(fromPrepared);
  const toIdCounts = countAssetIds(toPrepared);
  const fromAssets = keyedAssets(fromPrepared, fromIdCounts, toIdCounts);
  const toAssets = keyedAssets(toPrepared, toIdCounts, fromIdCounts);
  const keys = [...new Set([...fromAssets.keys(), ...toAssets.keys()])].sort(
    (left, right) => left.localeCompare(right),
  );
  const sharedImpacts = new Map<
    string,
    {
      source: SharedSecurityPolicyChange["source"];
      fields: Set<ReviewableSecurityPolicyField>;
      assets: Map<string, SecurityPolicyAffectedAsset>;
    }
  >();

  const policyChanges = keys.flatMap((key) => {
    const before = fromAssets.get(key);
    const after = toAssets.get(key);
    const fields = changedFields(before?.evidence, after?.evidence).map(
      (change): SecurityPolicyFieldChange => {
        const result = fieldProvenance(input, before, after, change.field);
        for (const source of result.changedSharedSources) {
          recordSharedImpact(
            sharedImpacts,
            source as SharedSecurityPolicyChange["source"],
            change.field,
            (after ?? before)!.identity,
          );
        }
        return { ...change, provenance: result.provenance };
      },
    );
    if (fields.length === 0) return [];
    const current = after ?? before;
    if (!current) return [];
    return [
      {
        asset: current.identity,
        before: before ? reviewablePolicy(before.evidence) : null,
        after: after ? reviewablePolicy(after.evidence) : null,
        fields,
      },
    ];
  });

  return {
    policyChanges: policyChanges.sort(compareAssetChanges),
    sharedPolicyChanges: [...sharedImpacts.values()]
      .map(({ source, fields, assets }) => ({
        source,
        changedFields: REVIEWABLE_SECURITY_POLICY_FIELDS.filter((field) =>
          fields.has(field),
        ),
        affectedAssets: [...assets.values()].sort(compareAssets),
      }))
      .sort((left, right) => compareSources(left.source, right.source)),
  };
}

function prepareAssets(
  assets: readonly SecurityPolicyAssetEvidence[],
  idsByPath: ReadonlyMap<string, string> | undefined,
): PreparedAsset[] {
  return assets.map((evidence) => {
    const id = idsByPath?.get(evidence.path) ?? evidence.path;
    return {
      evidence,
      identity: { id, path: evidence.path, kind: evidence.kind },
    };
  });
}

function countAssetIds(assets: readonly PreparedAsset[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    counts.set(asset.identity.id, (counts.get(asset.identity.id) ?? 0) + 1);
  }
  return counts;
}

function keyedAssets(
  assets: readonly PreparedAsset[],
  ownIdCounts: ReadonlyMap<string, number>,
  otherIdCounts: ReadonlyMap<string, number>,
): Map<string, PreparedAsset> {
  return new Map(
    assets.map((asset) => {
      const uniqueAcrossEndpoints =
        ownIdCounts.get(asset.identity.id) === 1 &&
        otherIdCounts.get(asset.identity.id) === 1;
      const key = uniqueAcrossEndpoints
        ? `id\0${asset.identity.id}`
        : `path\0${asset.identity.path}`;
      return [key, asset];
    }),
  );
}

function changedFields(
  before: SecurityPolicyAssetEvidence | undefined,
  after: SecurityPolicyAssetEvidence | undefined,
): Array<
  | Omit<SecurityPolicyScalarChange, "provenance">
  | Omit<SecurityPolicyListChange, "provenance">
> {
  const changes: Array<
    | Omit<SecurityPolicyScalarChange, "provenance">
    | Omit<SecurityPolicyListChange, "provenance">
  > = [];
  for (const field of REVIEWABLE_SECURITY_POLICY_FIELDS) {
    if (SCALAR_FIELDS.has(field)) {
      const scalarField = field as ScalarSecurityPolicyField;
      const beforeValue = before?.effectivePolicy[scalarField] ?? null;
      const afterValue = after?.effectivePolicy[scalarField] ?? null;
      if (beforeValue !== afterValue) {
        changes.push({
          kind: "scalar",
          field: scalarField,
          before: beforeValue,
          after: afterValue,
        });
      }
      continue;
    }
    const listField = field as ListSecurityPolicyField;
    const beforeValues = before?.effectivePolicy[listField] ?? [];
    const afterValues = after?.effectivePolicy[listField] ?? [];
    const added = difference(afterValues, beforeValues);
    const removed = difference(beforeValues, afterValues);
    if (added.length > 0 || removed.length > 0) {
      changes.push({ kind: "list", field: listField, added, removed });
    }
  }
  return changes;
}

function fieldProvenance(
  input: SecurityPolicyDiffInput,
  before: PreparedAsset | undefined,
  after: PreparedAsset | undefined,
  field: ReviewableSecurityPolicyField,
): FieldProvenanceResult {
  const sources: SecurityPolicyChangeSource[] = [];
  const changedSharedSources: SecurityPolicyChangeSource[] = [];
  const inheritedValueSources: SecurityPolicyChangeSource[] = [];
  const current = after ?? before;
  if (!current) {
    throw new Error("Security policy change has no affected asset evidence.");
  }

  const owningSources = uniqueOwningSources(input, before, after);
  sources.push(...owningSources);

  const direct =
    owningSources.length === 0 &&
    directDeclarationChanged(before?.evidence, after?.evidence, field);
  if (direct) {
    sources.push({
      type: "asset",
      id: current.identity.id,
      path: current.identity.path,
    });
  }

  const selectedProfileChanged =
    (before?.evidence.selectedSecurityProfile ?? null) !==
    (after?.evidence.selectedSecurityProfile ?? null);
  if (
    selectedProfileChanged ||
    localDeclarationPresenceChanged(before?.evidence, after?.evidence, field)
  ) {
    for (const profile of uniqueStrings([
      ...(before?.evidence.profileChain ?? []),
      ...(after?.evidence.profileChain ?? []),
    ])) {
      if (!profileSuppliesFieldValue(input, profile, field)) continue;
      const source = profileSource(profile, input);
      sources.push(source);
      inheritedValueSources.push(source);
    }
  }

  for (const profile of uniqueStrings([
    ...(before?.evidence.profileChain ?? []),
    ...(after?.evidence.profileChain ?? []),
  ])) {
    if (!profileFieldChanged(input, profile, field)) continue;
    const source = profileSource(profile, input);
    sources.push(source);
    changedSharedSources.push(source);
  }

  if (repositoryFieldChanged(input, field)) {
    const source = repositorySource(input);
    sources.push(source);
    changedSharedSources.push(source);
  }

  if (sources.length === 0) {
    sources.push(...fallbackSources(input, current, before, after));
  }

  const inherited =
    owningSources.length > 0 ||
    changedSharedSources.length > 0 ||
    inheritedValueSources.length > 0 ||
    !direct;
  return {
    provenance: {
      mode: direct && inherited ? "mixed" : direct ? "direct" : "inherited",
      sources: uniqueSources(sources),
    },
    changedSharedSources: uniqueSources(changedSharedSources),
  };
}

function localDeclarationPresenceChanged(
  before: SecurityPolicyAssetEvidence | undefined,
  after: SecurityPolicyAssetEvidence | undefined,
  field: ReviewableSecurityPolicyField,
): boolean {
  if (!before || !after) return false;
  return (
    (before.declaredPolicy ?? EMPTY_DECLARED_POLICY).fields.includes(field) !==
    (after.declaredPolicy ?? EMPTY_DECLARED_POLICY).fields.includes(field)
  );
}

function profileSuppliesFieldValue(
  input: SecurityPolicyDiffInput,
  profile: string,
  field: ReviewableSecurityPolicyField,
): boolean {
  return [
    profileValue(input.fromConfig?.profiles?.[profile], field),
    profileValue(input.toConfig?.profiles?.[profile], field),
  ].some((value) => (Array.isArray(value) ? value.length > 0 : value !== null));
}

function directDeclarationChanged(
  before: SecurityPolicyAssetEvidence | undefined,
  after: SecurityPolicyAssetEvidence | undefined,
  field: ReviewableSecurityPolicyField,
): boolean {
  if (!before || !after) return true;
  if (
    (before.selectedSecurityProfile ?? null) !==
    (after.selectedSecurityProfile ?? null)
  ) {
    return true;
  }
  const beforeDeclared = before.declaredPolicy ?? EMPTY_DECLARED_POLICY;
  const afterDeclared = after.declaredPolicy ?? EMPTY_DECLARED_POLICY;
  if (
    beforeDeclared.fields.includes(field) !==
    afterDeclared.fields.includes(field)
  ) {
    return true;
  }
  return !samePolicyValue(beforeDeclared[field], afterDeclared[field]);
}

function uniqueOwningSources(
  input: SecurityPolicyDiffInput,
  before: PreparedAsset | undefined,
  after: PreparedAsset | undefined,
): SecurityPolicyChangeSource[] {
  return uniqueSources(
    [before, after].flatMap((asset) => {
      const inherited = asset?.evidence.inheritedFrom;
      if (!inherited) return [];
      return [
        {
          type: "owning_skill" as const,
          id:
            input.toAssetIdsByPath?.get(inherited.sourcePath) ??
            input.fromAssetIdsByPath?.get(inherited.sourcePath) ??
            inherited.id,
          path: inherited.sourcePath,
        },
      ];
    }),
  );
}

function fallbackSources(
  input: SecurityPolicyDiffInput,
  current: PreparedAsset,
  before: PreparedAsset | undefined,
  after: PreparedAsset | undefined,
): SecurityPolicyChangeSource[] {
  const policySources = uniqueStrings([
    ...(before?.evidence.policySources ?? []),
    ...(after?.evidence.policySources ?? []),
  ]) as SecurityPolicySource[];
  return policySources.flatMap((source) => {
    if (source === "owning_skill") {
      return uniqueOwningSources(input, before, after);
    }
    if (source === "security_profile") {
      const profiles = uniqueStrings([
        ...(before?.evidence.profileChain ?? []),
        ...(after?.evidence.profileChain ?? []),
      ]);
      return profiles.length > 0
        ? profiles.map((profile) => profileSource(profile, input))
        : [{ type: "security_profile" as const, id: "unknown" }];
    }
    if (source === "repository_config") return [repositorySource(input)];
    return [
      {
        type: "asset" as const,
        id: current.identity.id,
        path: current.identity.path,
      },
    ];
  });
}

function profileFieldChanged(
  input: SecurityPolicyDiffInput,
  profile: string,
  field: ReviewableSecurityPolicyField,
): boolean {
  const before = input.fromConfig?.profiles?.[profile];
  const after = input.toConfig?.profiles?.[profile];
  if ((before?.securityProfile ?? null) !== (after?.securityProfile ?? null)) {
    return true;
  }
  return !samePolicyValue(
    profileValue(before, field),
    profileValue(after, field),
  );
}

function profileValue(
  profile: SecurityProfileConfig | undefined,
  field: ReviewableSecurityPolicyField,
): boolean | null | string[] {
  if (SCALAR_FIELDS.has(field)) {
    return profile?.[field as ScalarSecurityPolicyField] ?? null;
  }
  switch (field as ListSecurityPolicyField) {
    case "allowedData":
      return uniqueStrings([
        ...(profile?.allowedDataClass ? [profile.allowedDataClass] : []),
        ...(profile?.allowedData ?? []),
      ]);
    case "forbiddenInputs":
      return uniqueStrings(profile?.forbiddenInputs ?? []);
    case "approvedNetworkDestinations":
      return uniqueStrings(profile?.approvedDomains ?? []);
    case "approvedUploadDestinations":
      return uniqueStrings(profile?.approvedUploadDomains ?? []);
    case "disallowedCommands":
      return uniqueStrings(profile?.disallowedCommands ?? []);
  }
}

function repositoryFieldChanged(
  input: SecurityPolicyDiffInput,
  field: ReviewableSecurityPolicyField,
): boolean {
  const key = repositoryConfigKey(field);
  if (!key) return false;
  return !samePolicyValue(
    uniqueStrings(input.fromConfig?.[key] ?? []),
    uniqueStrings(input.toConfig?.[key] ?? []),
  );
}

function repositoryConfigKey(
  field: ReviewableSecurityPolicyField,
):
  | "approvedDomains"
  | "approvedUploadDomains"
  | "disallowedCommands"
  | undefined {
  if (field === "approvedNetworkDestinations") return "approvedDomains";
  if (field === "approvedUploadDestinations") return "approvedUploadDomains";
  if (field === "disallowedCommands") return "disallowedCommands";
  return undefined;
}

function profileSource(
  profile: string,
  input: SecurityPolicyDiffInput,
): SecurityPolicyChangeSource {
  const path = input.toConfigPath ?? input.fromConfigPath;
  return {
    type: "security_profile",
    id: profile,
    ...(path ? { path } : {}),
  };
}

function repositorySource(
  input: SecurityPolicyDiffInput,
): SecurityPolicyChangeSource {
  const path = input.toConfigPath ?? input.fromConfigPath;
  return {
    type: "repository_config",
    id: "security",
    ...(path ? { path } : {}),
  };
}

function recordSharedImpact(
  impacts: Map<
    string,
    {
      source: SharedSecurityPolicyChange["source"];
      fields: Set<ReviewableSecurityPolicyField>;
      assets: Map<string, SecurityPolicyAffectedAsset>;
    }
  >,
  source: SharedSecurityPolicyChange["source"],
  field: ReviewableSecurityPolicyField,
  asset: SecurityPolicyAffectedAsset,
): void {
  const key = sourceKey(source);
  const existing = impacts.get(key) ?? {
    source,
    fields: new Set<ReviewableSecurityPolicyField>(),
    assets: new Map<string, SecurityPolicyAffectedAsset>(),
  };
  existing.fields.add(field);
  existing.assets.set(`${asset.id}\0${asset.path}`, asset);
  impacts.set(key, existing);
}

function reviewablePolicy(
  asset: SecurityPolicyAssetEvidence,
): ReviewableEffectiveSecurityPolicy {
  const { fingerprint: _fingerprint, ...policy } = asset.effectivePolicy;
  void _fingerprint;
  return {
    hasEffectivePolicy: asset.hasEffectivePolicy,
    policySources: [...asset.policySources],
    selectedSecurityProfile: asset.selectedSecurityProfile ?? null,
    profileChain: [...asset.profileChain],
    ...copyPolicy(policy),
  };
}

function copyPolicy(
  policy: Omit<EffectiveSecurityPolicyEvidence, "fingerprint">,
): Omit<EffectiveSecurityPolicyEvidence, "fingerprint"> {
  return {
    ...policy,
    allowedData: [...policy.allowedData],
    forbiddenInputs: [...policy.forbiddenInputs],
    approvedNetworkDestinations: [...policy.approvedNetworkDestinations],
    approvedUploadDestinations: [...policy.approvedUploadDestinations],
    disallowedCommands: [...policy.disallowedCommands],
  };
}

function difference(values: readonly string[], excluded: readonly string[]) {
  const excludedSet = new Set(excluded);
  return uniqueStrings(values.filter((value) => !excludedSet.has(value)));
}

function samePolicyValue(
  before: boolean | null | string[],
  after: boolean | null | string[],
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function uniqueSources(
  sources: readonly SecurityPolicyChangeSource[],
): SecurityPolicyChangeSource[] {
  return [
    ...new Map(sources.map((source) => [sourceKey(source), source])).values(),
  ].sort(compareSources);
}

function sourceKey(source: SecurityPolicyChangeSource): string {
  return `${source.type}\0${source.id}\0${source.path ?? ""}`;
}

function compareSources(
  left: SecurityPolicyChangeSource,
  right: SecurityPolicyChangeSource,
): number {
  return sourceKey(left).localeCompare(sourceKey(right));
}

function compareAssets(
  left: SecurityPolicyAffectedAsset,
  right: SecurityPolicyAffectedAsset,
): number {
  return (
    left.id.localeCompare(right.id) ||
    left.path.localeCompare(right.path) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareAssetChanges(
  left: SecurityPolicyAssetChange,
  right: SecurityPolicyAssetChange,
): number {
  return compareAssets(left.asset, right.asset);
}
