import type { ArtifactKind } from "./artifact.js";

/** Repository governance boundary determined from a normalized asset path. */
export type AssetScope =
  | "independent"
  | "skill-local"
  | "repository-support"
  | "unknown";

/** Stable registry of deterministic asset-classification rules. */
export const ASSET_CLASSIFICATION_RULES = [
  "skill-entrypoint",
  "skill-local-support",
  "context-root",
  "context-root-legacy",
  "lens-root",
  "agent-root",
  "repository-tool",
  "config-file",
  "generic-profile",
  "generic-reference",
  "generic-example",
  "unknown",
] as const;
export type AssetClassificationRule =
  (typeof ASSET_CLASSIFICATION_RULES)[number];

/** Stable registry of positive and competing asset-classification reasons. */
export const ASSET_CLASSIFICATION_REASON_CODES = [
  "under-canonical-skill-root",
  "under-skill-support-directory",
  "outside-recognized-asset-boundary",
  "unsupported-skill-local-directory",
  "under-recognized-context-root",
  "under-legacy-context-root",
  "under-recognized-lens-root",
  "under-recognized-agent-root",
  "repository-tool-not-context",
  "recognized-config-file",
  "under-generic-support-directory",
  "outside-recognized-skill-boundary",
  "outside-recognized-context-root",
] as const;
export type AssetClassificationReasonCode =
  (typeof ASSET_CLASSIFICATION_REASON_CODES)[number];

/** Resolution state for the structurally implied parent of Skill-local support. */
export type ParentAssetResolution =
  | "structural-candidate"
  | "resolved"
  | "missing"
  | "ambiguous";

/** Stable negative evidence for a nearby classification rule. */
export interface AssetCompetingRuleEvidence {
  rule: AssetClassificationRule;
  matched: false;
  reasonCode: AssetClassificationReasonCode;
  reason: string;
}

/** Deterministic, machine-readable evidence explaining one path classification. */
export interface AssetClassificationEvidence {
  kind: ArtifactKind;
  scope: AssetScope;
  matchedRule: AssetClassificationRule;
  reasonCode: AssetClassificationReasonCode;
  reason: string;
  recognizedRoot?: string;
  /** Structural path candidate; it does not prove that a parent asset exists. */
  parentAssetCandidatePath?: string;
  /** Resolved parent source path; present only for one unambiguous parent. */
  parentAssetPath?: string;
  parentResolution?: ParentAssetResolution;
  parentAssetCandidates?: string[];
  supportDirectory?: string;
  ignoredNestedSegments?: string[];
  competingRules?: AssetCompetingRuleEvidence[];
}
