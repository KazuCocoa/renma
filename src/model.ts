import type { ArtifactKind, Evidence, MetadataFieldEvidence } from "./types.js";

/** Lifecycle state for a skill or context asset. */
export type AssetStatus = "experimental" | "stable" | "deprecated" | "archived";

/** Artifact kinds Renma keeps in the normalized model. */
export type AssetKind = Exclude<ArtifactKind, "unknown">;

/** Relationship kinds used by graph analysis and repository validation. */
export type DependencyKind =
  | "requires"
  | "optional"
  | "conflicts"
  | "extends"
  | "references"
  | "applies_to"
  | "covered_by";

/** Normalized shared metadata for cataloged assets. */
export interface AssetMetadata {
  id?: string;
  title?: string;
  type?: string;
  version?: string;
  owner?: string;
  status?: AssetStatus;
  purpose?: string;
  lastReviewedAt?: string;
  reviewCycle?: string;
  expiresAt?: string;
  tags: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  requiresContext: string[];
  optionalContext: string[];
  conflicts: string[];
  supersededBy: string[];
  appliesTo?: string[];
  focus?: string[];
  expectedOutputs?: string[];
  requiresLens?: string[];
  optionalLens?: string[];
}

/** Serialization-independent governance semantics for an Agent Skill. */
export interface SkillGovernance {
  id?: string | undefined;
  title?: string | undefined;
  owner?: string | undefined;
  lifecycle: {
    status?: string | undefined;
    version?: string | undefined;
    lastReviewedAt?: string | undefined;
    reviewCycle?: string | undefined;
    expiresAt?: string | undefined;
  };
  selection: {
    useWhen: string[];
    doNotUseWhen: string[];
  };
  dependencies: {
    requiredContext: string[];
    optionalContext: string[];
    requiredLens: string[];
    optionalLens: string[];
    conflicts: string[];
  };
  security: {
    networkAllowed?: boolean | undefined;
    externalUploadAllowed?: boolean | undefined;
    secretsAllowed?: boolean | undefined;
    humanApprovalRequired?: boolean | undefined;
    allowedData: string[];
    forbiddenInputs: string[];
    approvedNetworkDestinations: string[];
    approvedUploadDestinations: string[];
    profile?: string | undefined;
  };
  /** All valid Agent Skills metadata entries, including unknown vendors. */
  extensionMetadata: Record<string, string>;
}

/** Repository object Renma can catalog, validate, reference, or report on. */
export interface Asset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  contentHash: string;
  metadata: AssetMetadata;
  metadataFields: Record<string, MetadataFieldEvidence>;
  metadataListItems: Record<string, MetadataFieldEvidence[]>;
}

export interface Skill extends Asset {
  kind: "skill";
  requiredContext: string[];
  optionalContext: string[];
  requiredLens: string[];
  optionalLens: string[];
  conflicts: string[];
}

export interface SupportAsset extends Asset {
  kind: Exclude<AssetKind, "skill" | "agent" | "config">;
}

/** Backwards-compatible catalog entry name for callers already using catalog output. */
export type CatalogEntry = Skill | SupportAsset;

export interface Dependency {
  /** Asset ID declaring the relationship. */
  from: string;
  /** Asset ID or declared target named by the relationship. */
  to: string;
  kind: DependencyKind;
  sourcePath: string;
  evidence?: Evidence;
}

/** Deterministic catalog of normalized repository assets and their declared edges. */
export interface Catalog {
  entries: CatalogEntry[];
  assets: Asset[];
  dependencies: Dependency[];
}
