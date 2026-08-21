import type {
  AssetClassificationEvidence,
  AssetCompetingRuleEvidence,
  KnownAssetClassificationReasonCode,
  KnownAssetClassificationRule,
} from "./classification.js";

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
