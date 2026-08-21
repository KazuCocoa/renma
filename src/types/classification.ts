import type { ArtifactKind } from "./artifact.js";

/** Repository governance boundary determined from a normalized asset path. */
export type AssetScope =
  "independent" | "skill-local" | "repository-support" | "unknown";

/** Stable registry of deterministic asset-classification rules. */
export const ASSET_CLASSIFICATION_RULES = [
  "skill-entrypoint",
  "skill-local-support",
  "context-root",
  "lens-root",
  "agent-root",
  "repository-tool",
  "config-file",
  "generic-profile",
  "generic-reference",
  "generic-example",
  "unknown",
] as const;
export type KnownAssetClassificationRule =
  (typeof ASSET_CLASSIFICATION_RULES)[number];

/**
 * Open wire value for classification rules.
 *
 * Consumers must retain unfamiliar future values and fail closed. Internal
 * classifiers use `KnownAssetClassificationRule` for exhaustiveness.
 */
export type AssetClassificationRule =
  KnownAssetClassificationRule | (string & Record<never, never>);

/** Stable registry of positive and competing asset-classification reasons. */
export const ASSET_CLASSIFICATION_REASON_CODES = [
  "under-canonical-skill-root",
  "under-skill-support-directory",
  "outside-recognized-asset-boundary",
  "unsupported-skill-local-directory",
  "under-recognized-context-root",
  "under-recognized-lens-root",
  "under-recognized-agent-root",
  "repository-tool-not-context",
  "recognized-config-file",
  "under-generic-support-directory",
  "outside-recognized-skill-boundary",
  "outside-recognized-context-root",
] as const;
export type KnownAssetClassificationReasonCode =
  (typeof ASSET_CLASSIFICATION_REASON_CODES)[number];

/** Open wire value for classification reason codes. */
export type AssetClassificationReasonCode =
  KnownAssetClassificationReasonCode | (string & Record<never, never>);

/** Resolution state for the structurally implied parent of Skill-local support. */
export type ParentAssetResolution =
  "structural-candidate" | "resolved" | "missing" | "ambiguous";

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

/** Closed internal classification evidence produced by Renma's classifier. */
export interface KnownAssetClassificationEvidence extends Omit<
  AssetClassificationEvidence,
  "matchedRule" | "reasonCode" | "competingRules"
> {
  matchedRule: KnownAssetClassificationRule;
  reasonCode: KnownAssetClassificationReasonCode;
  competingRules?: KnownAssetCompetingRuleEvidence[];
}

/** Closed internal competing-rule evidence. */
export interface KnownAssetCompetingRuleEvidence extends Omit<
  AssetCompetingRuleEvidence,
  "rule" | "reasonCode"
> {
  rule: KnownAssetClassificationRule;
  reasonCode: KnownAssetClassificationReasonCode;
}
