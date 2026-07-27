import type { BodyPolicyClauseFacts, BodyPolicyDomain } from "./model.js";

export const BODY_POLICY_DOMAIN_ORDER: readonly BodyPolicyDomain[] = [
  "network",
  "upload",
  "secrets",
];

/** @internal Own final fact identity and deterministic source/domain order. */
export function deduplicateBodyPolicyFacts(
  facts: readonly BodyPolicyClauseFacts[],
): readonly BodyPolicyClauseFacts[] {
  const selected = new Map<string, BodyPolicyClauseFacts>();
  for (const fact of facts) {
    const key = [
      fact.domain ?? "",
      fact.modality,
      fact.scope,
      fact.completeness,
      fact.evidenceStart,
      fact.evidenceEnd,
    ].join(":");
    selected.set(key, fact);
  }
  return [...selected.values()].sort(compareBodyPolicyFacts);
}

/** @internal Compare facts in their public projection order. */
export function compareBodyPolicyFacts(
  left: BodyPolicyClauseFacts,
  right: BodyPolicyClauseFacts,
): number {
  return (
    left.evidenceStart - right.evidenceStart ||
    left.evidenceEnd - right.evidenceEnd ||
    bodyPolicyDomainOrder(left.domain) - bodyPolicyDomainOrder(right.domain)
  );
}

function bodyPolicyDomainOrder(domain: BodyPolicyDomain | undefined): number {
  return domain === undefined
    ? BODY_POLICY_DOMAIN_ORDER.length
    : BODY_POLICY_DOMAIN_ORDER.indexOf(domain);
}
