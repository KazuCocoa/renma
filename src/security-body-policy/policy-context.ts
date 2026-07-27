import {
  DESCRIPTIVE_SUBJECT_BRIDGE_RE,
  SUPPORTED_COMPOSED_DIRECTIVE_PREFIX_RE,
  SUPPORTED_COMPOSED_PREFIX_RE,
  SUPPORTED_DIRECTIVE_PREFIX_RE,
  SUPPORTED_POLICY_LABEL_PREFIX_RE,
} from "./lexical-recognition.js";
import type { StandalonePolicyPrefixClassification } from "./model.js";

/** Bounded directive/label recognition never supplies a grammatical subject. */
export function standalonePolicyPrefixClassification(
  prefix: string,
): StandalonePolicyPrefixClassification {
  const normalized = prefix.trim();
  if (normalized.length === 0) return "plain-start";
  if (
    /["'“”‘’`]/u.test(normalized) ||
    DESCRIPTIVE_SUBJECT_BRIDGE_RE.test(normalized)
  ) {
    return "descriptive-prefix";
  }
  if (SUPPORTED_POLICY_LABEL_PREFIX_RE.test(normalized)) {
    return "policy-label";
  }
  if (
    SUPPORTED_DIRECTIVE_PREFIX_RE.test(normalized) ||
    SUPPORTED_COMPOSED_DIRECTIVE_PREFIX_RE.test(normalized)
  ) {
    return "directive-prefix";
  }
  const composed = SUPPORTED_COMPOSED_PREFIX_RE.exec(normalized);
  if (
    composed?.groups?.label !== undefined &&
    composed.groups.directive !== undefined
  ) {
    return "composed-policy-prefix";
  }
  if (
    /^(?:(?:the|a|an|this|that|these|those|each|every|another|offline|online|local|remote)[ \t]+)?[A-Za-z][A-Za-z0-9_-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_-]*){0,3}(?:[ \t]+(?:must|shall|should|will|would|may|might|can|could|does|do|did))?[ \t]*$/i.test(
      normalized,
    )
  ) {
    return "changed-subject-prefix";
  }
  return "unsupported-prefix";
}

export function standalonePolicyPrefixSupportsScope(
  classification: StandalonePolicyPrefixClassification,
): boolean {
  return (
    classification === "plain-start" ||
    classification === "directive-prefix" ||
    classification === "policy-label" ||
    classification === "composed-policy-prefix"
  );
}

export function outerPrefixSupportsEmbeddedWorkflowSubject(
  classification: StandalonePolicyPrefixClassification,
): boolean {
  return (
    classification === "directive-prefix" ||
    classification === "policy-label" ||
    classification === "composed-policy-prefix"
  );
}

export function prefixClassificationProvidesPolicyContext(
  classification: StandalonePolicyPrefixClassification,
): boolean {
  return (
    classification === "directive-prefix" ||
    classification === "policy-label" ||
    classification === "composed-policy-prefix"
  );
}
