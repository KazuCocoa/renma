import type { ArtifactKind } from "./types.js";

/** Lifecycle state for a skill or context asset. */
export type AssetStatus = "experimental" | "stable" | "deprecated" | "archived";

/** Normalized metadata shared by skill and context assets. */
export interface AssetMetadata {
  id?: string;
  version?: string;
  owner?: string;
  status?: AssetStatus;
  whenToUse: string[];
  whenNotToUse: string[];
  requiresContext: string[];
  optionalContext: string[];
  conflicts: string[];
}

/** Normalized model for a skill entrypoint. */
export interface SkillModel {
  id: string;
  kind: "skill";
  sourcePath: string;
  metadata: AssetMetadata;
  requiredContext: string[];
  optionalContext: string[];
}

/** Normalized model for a context asset referenced by skills. */
export interface ContextModel {
  id: string;
  kind: Exclude<ArtifactKind, "skill" | "agent" | "config" | "unknown">;
  sourcePath: string;
  metadata: AssetMetadata;
}

/** Catalog entry emitted from a normalized skill or context asset. */
export type CatalogEntry = SkillModel | ContextModel;

/** Deterministic index of skills and context assets in a repository. */
export interface Catalog {
  entries: CatalogEntry[];
}
