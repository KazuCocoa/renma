import assert from "node:assert/strict";

import { disclosureClauseRangesIntersectingRange } from "../src/security-command/guards.js";
import { WORKFLOW_SCOPE_TERMS } from "../src/security-prose-vocabulary.js";
import { bodyPolicyStatementGroupFacts } from "../src/security-body-policy/clause-facts.js";
import type {
  BodyPolicyClauseFacts,
  BodyPolicyModality,
  BodyPolicyScope,
} from "../src/security-body-policy/model.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Finding } from "../src/types/diagnostics.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

export type BodyPolicyTestDomain = "network" | "upload" | "secrets";

export function bodyPolicyClauseRanges(
  text: string,
): readonly { start: number; end: number }[] {
  const ranges = disclosureClauseRangesIntersectingRange(
    text,
    0,
    text.length,
  ).filter(({ start, end }) => text.slice(start, end).trim().length > 0);
  return ranges.length > 0 ? ranges : [{ start: 0, end: text.length }];
}

export function bodyPolicyFacts(
  text: string,
): readonly BodyPolicyClauseFacts[] {
  return bodyPolicyStatementGroupFacts(text, bodyPolicyClauseRanges(text));
}

export function bodyPolicyFindings(
  body: string,
  selectedDomains: BodyPolicyTestDomain | readonly BodyPolicyTestDomain[] = [
    "network",
    "upload",
    "secrets",
  ],
): Finding[] {
  const domains =
    typeof selectedDomains === "string" ? [selectedDomains] : selectedDomains;
  const policy = {
    network: "renma.network-allowed: 'true'",
    upload: "renma.external-upload-allowed: 'true'",
    secrets: "renma.secrets-allowed: 'true'",
  };
  const path = "skills/security/SKILL.md";
  const content = canonicalSkillFixture(
    path,
    `---
metadata:
  renma.allowed-data: '["disclosed"]'
  ${domains.map((domain) => policy[domain]).join("\n  ")}
---

${body}
`,
  );

  return securityDiagnosticFindings([
    {
      path,
      absolutePath: `/repo/${path}`,
      kind: "skill",
      sizeBytes: Buffer.byteLength(content),
      contentClassification: "text",
      markdownParserEligible: true,
      content,
    },
  ]).filter((finding) => finding.id === "SEC-BODY-POLICY-CONTRADICTION");
}

export function contrastiveClauseFacts(
  text: string,
): readonly BodyPolicyClauseFacts[] {
  const ranges = bodyPolicyClauseRanges(text);
  assert.ok(ranges.length >= 2, text);
  return bodyPolicyStatementGroupFacts(text, ranges);
}

export function softWrapBeforeStatementConnector(text: string): string {
  return text.includes("; however,")
    ? text.replace("; however,", ";\nhowever,")
    : text.replace(/ (?=(?:but|yet)\b)/u, "\n");
}

export function softWrapAfterWorkflowSubject(text: string): string {
  const subject = new RegExp(`^${WORKFLOW_SCOPE_TERMS}\\b`, "i").exec(text);
  assert.ok(subject, text);
  return `${subject[0]}\n${text.slice(subject[0].length).trimStart()}`;
}

export function softWrapAfterDirectivePrefix(text: string): string {
  const prefix =
    /^(?:please|for safety,|ensure|make sure|as a rule,|policy:|requirement:)\s+/iu.exec(
      text,
    );
  assert.ok(prefix, text);
  return `${prefix[0].trimEnd()}\n${text.slice(prefix[0].length)}`;
}

export function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function renderStatementPredicateChain(input: {
  readonly subject: string;
  readonly firstPredicate: string;
  readonly middles: readonly string[];
  readonly connectors: readonly string[];
  readonly laterPredicate: string;
}): string {
  const predicates = [
    input.firstPredicate,
    ...input.middles,
    input.laterPredicate,
  ];
  assert.equal(input.connectors.length, predicates.length - 1);
  return `${input.subject} ${predicates
    .map(
      (predicate, index) =>
        `${index === 0 ? "" : input.connectors[index - 1]}${predicate}`,
    )
    .join("")}.`;
}

export function softWrapStatementPredicateChain(
  body: string,
  connectors: readonly string[],
): string {
  return connectors.reduce(
    (rendered, connector) =>
      rendered.replace(connector, `${connector.trimEnd()}\n`),
    body,
  );
}

export function assertFactEvidence(
  fact: BodyPolicyClauseFacts | undefined,
  clause: string,
  evidence: string,
  expected: {
    readonly modality: BodyPolicyModality;
    readonly scope: BodyPolicyScope;
    readonly completeness: BodyPolicyClauseFacts["completeness"];
  },
  message: string,
): void {
  assert.ok(fact, message);
  const evidenceStart = clause.indexOf(evidence);
  assert.notEqual(evidenceStart, -1, message);
  assert.deepEqual(
    {
      modality: fact.modality,
      scope: fact.scope,
      completeness: fact.completeness,
      evidenceStart: fact.evidenceStart,
      evidenceEnd: fact.evidenceEnd,
    },
    {
      ...expected,
      evidenceStart,
      evidenceEnd: evidenceStart + evidence.length,
    },
    message,
  );
  assert.equal(
    clause.slice(fact.evidenceStart, fact.evidenceEnd),
    evidence,
    message,
  );
}

export function assertFactRangesWithinSource(
  source: string,
  facts: readonly BodyPolicyClauseFacts[],
): void {
  for (const fact of facts) {
    assert.ok(fact.evidenceStart >= 0);
    assert.ok(fact.evidenceEnd >= fact.evidenceStart);
    assert.ok(fact.evidenceEnd <= source.length);
  }
}
