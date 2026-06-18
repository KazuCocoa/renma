import type { ArtifactKind, Evidence } from "./types.js";

/** Lifecycle state for a skill or context asset. */
export type AssetStatus = "experimental" | "stable" | "deprecated" | "archived";

/** Artifact kinds Renma keeps in the normalized model. */
export type AssetKind = Exclude<ArtifactKind, "unknown">;

/** Relationship kinds used by graph and future resolution work. */
export type DependencyKind =
  | "requires"
  | "optional"
  | "conflicts"
  | "extends"
  | "routes_to"
  | "covered_by";

/** Normalized shared metadata for cataloged assets. */
export interface AssetMetadata {
  id?: string;
  version?: string;
  owner?: string;
  status?: AssetStatus;
  tags: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  requiresContext: string[];
  optionalContext: string[];
  conflicts: string[];
}

/** Repository object Renma can catalog, validate, reference, or compose. */
export interface Asset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  contentHash: string;
  metadata: AssetMetadata;
}

export interface Skill extends Asset {
  kind: "skill";
  /** Routing declarations extracted from skill metadata. */
  routes: string[];
  requiredContext: string[];
  optionalContext: string[];
  conflicts: string[];
}

export interface ContextUnit extends Asset {
  kind: Exclude<AssetKind, "skill" | "agent" | "config">;
}

/** Backwards-compatible catalog entry name for callers already using catalog output. */
export type CatalogEntry = Skill | ContextUnit;

export interface Dependency {
  /** Asset ID declaring the relationship. */
  from: string;
  /** Asset ID or unresolved target named by the relationship. */
  to: string;
  kind: DependencyKind;
  sourcePath: string;
  evidence?: Evidence;
}

export interface Composition {
  selectedSkill: string;
  selectedAssets: string[];
  rejectedAssets: Array<{ id: string; reason: string }>;
  dependencies: Dependency[];
}

/** Deterministic catalog of normalized repository assets and their declared edges. */
export interface Catalog {
  entries: CatalogEntry[];
  assets: Asset[];
  dependencies: Dependency[];
}
