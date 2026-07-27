import assert from "node:assert/strict";
import test from "node:test";

import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import {
  BODY_POLICY_0244_GOLDEN_CASES,
  BODY_POLICY_0244_GOLDEN_SOURCE,
  type LegacyBodyPolicyFindingProjection,
} from "./fixtures/body-policy-0244-golden.js";

interface IntentionalCompatibilityChange {
  readonly reason: string;
  readonly current: readonly LegacyBodyPolicyFindingProjection[];
}

const INTENTIONAL_COMPATIBILITY_CHANGES: Readonly<
  Record<string, IntentionalCompatibilityChange>
> = {
  "pairwise-01-ordinary-one-line": findingChange(
    "This workflow validates inputs and is deterministic, yet must not use the network.",
    "Statement groups intentionally retain the explicit workflow subject through a supported copular middle predicate.",
  ),
  "pairwise-05-modified-ordinary-one-line": findingChange(
    "The operation requires external uploads and also may write local logs, yet must not upload files.",
    "Statement groups intentionally retain the explicit operation subject through a supported auxiliary middle predicate.",
  ),
  "pairwise-09-but-one-line": findingChange(
    "This run does not require credential access but audits logs, yet must not use credentials.",
    "Statement groups intentionally retain the explicit run subject through a supported ordinary middle predicate.",
  ),
  "pairwise-13-yet-one-line": findingChange(
    "The process must not upload files during local setup, yet checks configuration, yet must not use the network.",
    "A local first predicate no longer discards the grammatical process subject before a complete later workflow prohibition.",
  ),
  "pairwise-17-however-one-line": findingChange(
    "This task must not access credentials from production; however, it is deterministic, yet must not upload files.",
    "A specific-source first predicate no longer discards the grammatical task subject through a supported copular predicate.",
  ),
  "pairwise-21-semicolon-one-line": compatibilityChange(
    [
      finding("This workflow must not use the network"),
      finding(
        "This workflow must not use the network; may write local logs, yet must not use credentials.",
      ),
    ],
    "Strict semicolon compatibility preserves the first-domain finding while statement-group continuation adds the independently supported later domain.",
  ),
  "pairwise-22-semicolon-soft-wrap": findingChange(
    "This task must not upload files;",
    "Physical-line evidence intentionally retains the visible semicolon before an ordinary Markdown soft wrap.",
  ),
  "pairwise-23-semicolon-hard-break": findingChange(
    "The process must not upload files; may write local logs, yet audits logs but",
    "An independently complete first-domain prohibition remains reportable with evidence bounded to the physical line before a Markdown hard break.",
  ),
  "pairwise-25-then-one-line": findingChange(
    "The operation validates inputs then audits logs, yet must not use the network.",
    "Strict then compatibility carries the explicit operation subject through the supported ordinary middle predicate.",
  ),
  "descriptive-says-helper-one-line": noFindingChange(
    "Precision tightening rejects a descriptive bridge that assigns the prohibition to a helper rather than the workflow.",
  ),
  "descriptive-says-helper-soft-wrap": noFindingChange(
    "The descriptive changed-subject precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "descriptive-says-helper-heading": noFindingChange(
    "Fallback headings use the same descriptive changed-subject precision boundary as prepared prose.",
  ),
  "descriptive-documents-helper-one-line": noFindingChange(
    "Precision tightening rejects documentation about a helper prohibition as a workflow-wide instruction.",
  ),
  "descriptive-documents-helper-soft-wrap": noFindingChange(
    "The descriptive helper precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "descriptive-documents-helper-heading": noFindingChange(
    "Fallback headings use the same descriptive helper precision boundary as prepared prose.",
  ),
  "conditional-subject-bridge-one-line": noFindingChange(
    "A conditional subject-to-predicate bridge is not treated as an unconditional workflow prohibition.",
  ),
  "conditional-subject-bridge-soft-wrap": noFindingChange(
    "The conditional bridge precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "conditional-subject-bridge-heading": noFindingChange(
    "Fallback headings use the same conditional bridge precision boundary as prepared prose.",
  ),
  "changed-subject-bridge-one-line": noFindingChange(
    "A helper introduced between the workflow subject and prohibition is an explicit changed subject.",
  ),
  "changed-subject-bridge-soft-wrap": noFindingChange(
    "The direct changed-subject precision boundary is identical for ordinary Markdown soft wrapping.",
  ),
  "changed-subject-bridge-heading": noFindingChange(
    "Fallback headings use the same direct changed-subject precision boundary as prepared prose.",
  ),
  "changed-middle-helper-one-line": noFindingChange(
    "An explicit helper subject clears inherited workflow scope before the later implicit predicate.",
  ),
  "precision-unexpected-modifier": noFindingChange(
    "An unrecognized adverb is unsupported bridge syntax rather than evidence of workflow-subject inheritance.",
  ),
  "precision-changed-helper": noFindingChange(
    "An explicit helper subject prevents the later prohibition from inheriting workflow scope.",
  ),
  "precision-unsupported-although": noFindingChange(
    "An unsupported subordinate connector does not inherit workflow scope.",
  ),
  "precision-offline-helper": noFindingChange(
    "An explicit offline-helper subject prevents workflow-subject inheritance.",
  ),
  "precision-specific-upload-target": noFindingChange(
    "A destination-specific upload restriction does not contradict workflow-wide permissive upload metadata.",
  ),
  "precision-unsupported-network-remainder": noFindingChange(
    "An exception clause leaves the prohibition incomplete and therefore non-emitting.",
  ),
  "precision-semicolon-however-without-comma": noFindingChange(
    "The malformed semicolon-however boundary is unsupported syntax and does not inherit workflow scope.",
  ),
  "precision-changed-helper-chain": noFindingChange(
    "A changed helper subject clears subject state across the remainder of a contrastive chain.",
  ),
  "independent-earlier-network-prohibition": findingChange(
    "No network access and this workflow requires network access",
    "Independent same-domain facts retain the earlier complete prohibition instead of allowing the later requirement to suppress it.",
  ),
  "stabilization-unrelated-workflow": findingChange(
    "This workflow validates inputs but must not use credentials.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier domain-free predicate.",
  ),
  "stabilization-unrelated-task": findingChange(
    "This task prepares the report, yet must not upload files.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier domain-free task predicate.",
  ),
  "stabilization-unrelated-process": findingChange(
    "The process checks configuration; however, it must not use the network.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier domain-free process predicate.",
  ),
  "stabilization-specific-network": findingChange(
    "This workflow must not use network access to production systems but must not use credentials.",
    "A specific-target first predicate no longer prevents an independent later-domain workflow prohibition.",
  ),
  "stabilization-specific-secret": findingChange(
    "This workflow must not access credentials from production yet must not upload files.",
    "A specific-source first predicate no longer prevents an independent later-domain workflow prohibition.",
  ),
  "stabilization-three-secrets": findingChange(
    "This workflow requires network access but checks logs, yet must not use credentials.",
    "Statement-group subject state and evidence intentionally span three supported predicates.",
  ),
  "stabilization-three-upload": findingChange(
    "This workflow requires network access, but may write local logs, yet must not upload files.",
    "Statement-group subject state intentionally spans an auxiliary middle predicate beyond the legacy matcher distance.",
  ),
  "stabilization-modifier-still": findingChange(
    "This workflow requires network access but still must not use credentials.",
    "Evidence includes the supported bounded modifier and inherited prohibition.",
  ),
  "stabilization-modifier-also": findingChange(
    "This workflow requires credentials yet also must not upload files.",
    "Evidence includes the supported bounded modifier and inherited cross-domain prohibition.",
  ),
  "stabilization-modifier-therefore": findingChange(
    "This workflow requires external uploads; however, it therefore must not use the network.",
    "The bounded statement modifier grammar intentionally supports therefore across a contrastive boundary.",
  ),
  "stabilization-heading": findingChange(
    "## This workflow requires network access but must not use credentials",
    "Fallback heading evidence includes the supported inherited prohibition.",
  ),
  "stabilization-bare-semicolon": findingChange(
    "This workflow requires network access; must not use credentials.",
    "Strict semicolon compatibility retains the finding while evidence includes its prohibition.",
  ),
  "stabilization-then": findingChange(
    "This workflow requires network access then must not use credentials.",
    "Strict then compatibility retains the finding while evidence includes its prohibition.",
  ),
  "stabilization-middle-copular": findingChange(
    "This workflow validates inputs but is deterministic, yet must not use credentials.",
    "Statement groups intentionally retain the explicit subject through a supported copular middle predicate.",
  ),
  "stabilization-middle-audits": findingChange(
    "This workflow validates inputs but audits logs, yet must not upload files.",
    "Statement groups intentionally retain the explicit subject through a curated ordinary middle predicate.",
  ),
  "stabilization-middle-reviews": findingChange(
    "This task runs but reviews results, yet must not use the network.",
    "Statement groups intentionally retain the explicit task subject through a curated ordinary middle predicate.",
  ),
  "scope-proof-descriptive-lists-upload": noFindingChange(
    "A descriptive lists bridge does not turn quoted or summarized upload policy text into a workflow prohibition.",
  ),
  "scope-proof-changed-helper-network": noFindingChange(
    "A supported subjectless network prohibition cannot borrow workflow scope after an explicit helper subject.",
  ),
  "scope-proof-changed-helper-upload": noFindingChange(
    "A supported subjectless upload prohibition remains attached to its explicit helper subject.",
  ),
  "scope-proof-conditional-network": noFindingChange(
    "A conditional predicate segment cannot receive the clause-facts standalone workflow default.",
  ),
  "bridge-parenthetical-deterministic-validation": noFindingChange(
    "During deterministic validation establishes phase-local scope just as other bounded validation phases do.",
  ),
  "bridge-parenthetical-local-network": noFindingChange(
    "Local setup scope inside a subject bridge is preserved instead of erased before fact classification.",
  ),
  "bridge-parenthetical-validation-upload": noFindingChange(
    "A validation-step-only bridge is local and therefore does not contradict workflow-wide upload permission.",
  ),
  "bridge-parenthetical-exception-network": noFindingChange(
    "An exception inside a subject bridge prevents classification as a complete workflow prohibition.",
  ),
  "bridge-parenthetical-target-upload": noFindingChange(
    "A destination inside a subject bridge preserves specific-target upload scope.",
  ),
  "middle-inflected-uploads": findingChange(
    "This workflow checks inputs but uploads files, yet must not use credentials.",
    "The third-person upload predicate retains the grammatical workflow subject and bounds evidence through the final prohibition.",
  ),
  "middle-inflected-operates": findingChange(
    "This workflow validates inputs but operates offline, yet must not use credentials.",
    "The third-person operates predicate retains the grammatical workflow subject and bounds evidence through the final prohibition.",
  ),
  "middle-changed-audit-jobs": noFindingChange(
    "Audit jobs is a strong noun phrase with its own modal predicate, so it clears workflow-subject state.",
  ),
  "middle-changed-review-tasks": noFindingChange(
    "Review tasks is a strong changed subject rather than the subjectless verb reviews.",
  ),
  "middle-changed-log-processors": noFindingChange(
    "Log processors is a strong changed subject rather than the subjectless verb logs.",
  ),
};

const PAIRWISE_CASES = BODY_POLICY_0244_GOLDEN_CASES.filter(
  ({ coverage }) => coverage.group === "pairwise",
);

const CURRENT_BODY_POLICY_PRECISION_MATRIX = [
  {
    name: "standalone subjectless default",
    body: "Do not use the network.",
    expected: [finding("Do not use the network.")],
    coverage: {
      predicateStart: "supported-subjectless",
      provenance: "supported-subjectless",
      subjectProof: "standalone-default",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "explicit workflow qualifier",
    body: "Network access is forbidden for this workflow.",
    expected: [finding("Network access is forbidden for this workflow.")],
    coverage: {
      predicateStart: "unsupported",
      provenance: "supported-domain-subject",
      subjectProof: "explicit-workflow-qualifier",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "composed direct punctuation and modifier",
    body: "This workflow: always must not use the network.",
    expected: [finding("This workflow: always must not use the network.")],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "explicit-workflow-subject",
      bridgeSequence: "punctuation-plus-modifier",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "bounded direct relative",
    body: "This workflow that validates inputs must not use credentials.",
    expected: [
      finding("This workflow that validates inputs must not use credentials."),
    ],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "explicit-workflow-subject",
      bridgeSequence: "bounded-relative",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "base middle policy verb",
    body: "This workflow checks inputs but upload reports, yet must not use the network.",
    expected: [
      finding(
        "This workflow checks inputs but upload reports, yet must not use the network.",
      ),
    ],
    coverage: {
      predicateStart: "supported-subjectless",
      provenance: "projected-supported",
      subjectProof: "inherited-workflow-subject",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "base",
      layout: "one-line",
      domainBehavior: "single",
    },
  },
  {
    name: "third-person middle policy verb soft wrap",
    body: "This workflow validates inputs\nbut uploads files,\nyet must not use credentials.",
    expected: [
      finding(
        "This workflow validates inputs\nbut uploads files,\nyet must not use credentials.",
        13,
      ),
    ],
    coverage: {
      predicateStart: "supported-subjectless",
      provenance: "projected-supported",
      subjectProof: "inherited-workflow-subject",
      bridgeSequence: "immediate",
      bridgeQualification: "none",
      verbForm: "third-person",
      layout: "soft-wrap",
      domainBehavior: "single",
    },
  },
  {
    name: "heading fallback direct bridge",
    body: "## This task — explicitly cannot upload files.",
    expected: [finding("## This task — explicitly cannot upload files.")],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "explicit-workflow-subject",
      bridgeSequence: "punctuation-plus-modifier",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "heading",
      domainBehavior: "single",
    },
  },
  {
    name: "descriptive direct bridge",
    body: "This workflow lists no external uploads.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "descriptive",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "explicit changed subject",
    body: "This workflow checks inputs but audit jobs must never use the network, yet must not upload files.",
    expected: [],
    coverage: {
      predicateStart: "explicit-changed-subject",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "changed-subject",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "conditional predicate segment",
    body: "This workflow validates inputs\nbut if offline, never use the network.",
    expected: [],
    coverage: {
      predicateStart: "conditional-or-subordinate",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "conditional",
      verbForm: "none",
      layout: "soft-wrap",
      domainBehavior: "clean",
    },
  },
  {
    name: "unsupported predicate start",
    body: "This workflow unexpectedly must not use credentials.",
    expected: [],
    coverage: {
      predicateStart: "unsupported",
      provenance: "supported-subjectless",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "unsupported",
      bridgeQualification: "unsupported",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "parenthetical local scope",
    body: "This workflow (during local setup) must not use the network.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "bounded-parenthetical",
      bridgeQualification: "local-step",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "parenthetical exception",
    body: "This workflow (except for approved domains) must not use the network.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "bounded-parenthetical",
      bridgeQualification: "exception",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "parenthetical specific target",
    body: "This workflow (to a public bucket) must not upload files.",
    expected: [],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-workflow-prefix",
      subjectProof: "no-workflow-proof",
      bridgeSequence: "bounded-parenthetical",
      bridgeQualification: "specific-target",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "clean",
    },
  },
  {
    name: "domain ordering and deduplication",
    body: "This workflow must not use the network and also must not use the network, must not upload files, yet must not use credentials.",
    expected: [
      finding(
        "This workflow must not use the network and also must not use the network, must not upload files,",
      ),
      finding(
        "This workflow must not use the network and also must not use the network, must not upload files,",
      ),
      finding(
        "This workflow must not use the network and also must not use the network, must not upload files, yet must not use credentials.",
      ),
    ],
    coverage: {
      predicateStart: "explicit-workflow-subject",
      provenance: "mixed-supported",
      subjectProof: "inherited-workflow-subject",
      bridgeSequence: "modifier",
      bridgeQualification: "none",
      verbForm: "none",
      layout: "one-line",
      domainBehavior: "ordered-deduplicated",
    },
  },
] as const;

test("0.24.4 body-policy golden cases are self-contained and immutable", () => {
  assert.equal(BODY_POLICY_0244_GOLDEN_SOURCE.tag, "v0.24.4");
  assert.equal(
    BODY_POLICY_0244_GOLDEN_SOURCE.commit,
    "9e72e1adddd588ea72cba1c3e06ed1d07de330d9",
  );
  assert.match(
    BODY_POLICY_0244_GOLDEN_SOURCE.generatedBy,
    /securityDiagnosticFindings/u,
  );
  assert.equal(BODY_POLICY_0244_GOLDEN_CASES.length, 116);
  assert.equal(
    new Set(BODY_POLICY_0244_GOLDEN_CASES.map(({ name }) => name)).size,
    BODY_POLICY_0244_GOLDEN_CASES.length,
  );
  assert.ok(Object.isFrozen(BODY_POLICY_0244_GOLDEN_SOURCE));
  assert.ok(Object.isFrozen(BODY_POLICY_0244_GOLDEN_CASES));

  for (const fixture of BODY_POLICY_0244_GOLDEN_CASES) {
    assert.ok(fixture.name.length > 0);
    assert.ok(fixture.body.length > 0);
    assert.ok(Object.isFrozen(fixture), fixture.name);
    assert.ok(Object.isFrozen(fixture.coverage), fixture.name);
    assert.ok(Object.isFrozen(fixture.expected), fixture.name);
    for (const findingProjection of fixture.expected) {
      assert.ok(Object.isFrozen(findingProjection), fixture.name);
    }
  }
});

test("frozen 0.24.4 cases cover every required pairwise interaction", () => {
  assert.equal(PAIRWISE_CASES.length, 32);
  assertPairwiseCoverage(
    "first predicate kind × later scope",
    PAIRWISE_CASES,
    "firstKind",
    [
      "unrelated",
      "requirement",
      "not-required",
      "local",
      "specific",
      "workflow-prohibition",
    ],
    "laterScope",
    ["workflow", "local", "specific", "unsupported"],
  );
  assertPairwiseCoverage(
    "earlier domain × later domain",
    PAIRWISE_CASES,
    "earlierDomain",
    ["network", "upload", "secrets"],
    "laterDomain",
    ["network", "upload", "secrets"],
  );
  assertPairwiseCoverage(
    "connector × layout",
    PAIRWISE_CASES,
    "connector",
    [
      "ordinary",
      "modified-ordinary",
      "but",
      "yet",
      "however",
      "semicolon",
      "then",
      "sentence",
    ],
    "layout",
    ["one-line", "soft-wrap", "hard-break", "heading"],
  );
  assertPairwiseCoverage(
    "connector × implicit or changed subject",
    PAIRWISE_CASES,
    "connector",
    [
      "ordinary",
      "modified-ordinary",
      "but",
      "yet",
      "however",
      "semicolon",
      "then",
      "sentence",
    ],
    "subjectMode",
    ["implicit", "changed"],
  );
  assertPairwiseCoverage(
    "predicate count × middle predicate category",
    PAIRWISE_CASES,
    "predicateCount",
    [3, 4],
    "middleCategory",
    ["copular", "auxiliary", "ordinary", "established"],
  );
});

test("public body-policy findings match each frozen 0.24.4 body except explicit changes", () => {
  const corpusNames = new Set(
    BODY_POLICY_0244_GOLDEN_CASES.map(({ name }) => name),
  );
  for (const allowlistedName of Object.keys(
    INTENTIONAL_COMPATIBILITY_CHANGES,
  )) {
    assert.ok(
      corpusNames.has(allowlistedName),
      `orphaned compatibility allowlist case ${allowlistedName}`,
    );
  }

  for (const fixture of BODY_POLICY_0244_GOLDEN_CASES) {
    const current = bodyPolicyFindingProjections(fixture.body);
    const intentional = INTENTIONAL_COMPATIBILITY_CHANGES[fixture.name];
    if (intentional === undefined) {
      assert.deepEqual(current, fixture.expected, fixture.name);
      continue;
    }
    assert.ok(intentional.reason.trim().length > 0, fixture.name);
    assert.notDeepEqual(intentional.current, fixture.expected, fixture.name);
    assert.deepEqual(current, intentional.current, fixture.name);
  }
});

test("current body-policy precision matrix has exact bounded public output", () => {
  for (const fixture of CURRENT_BODY_POLICY_PRECISION_MATRIX) {
    assert.deepEqual(
      bodyPolicyFindingProjections(fixture.body),
      fixture.expected,
      fixture.name,
    );
  }

  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.predicateStart,
      ),
    ),
    new Set([
      "supported-subjectless",
      "explicit-workflow-subject",
      "explicit-changed-subject",
      "conditional-or-subordinate",
      "unsupported",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.subjectProof,
      ),
    ),
    new Set([
      "standalone-default",
      "explicit-workflow-subject",
      "inherited-workflow-subject",
      "explicit-workflow-qualifier",
      "no-workflow-proof",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.provenance,
      ),
    ),
    new Set([
      "supported-subjectless",
      "supported-domain-subject",
      "supported-workflow-prefix",
      "projected-supported",
      "mixed-supported",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.bridgeSequence,
      ),
    ),
    new Set([
      "immediate",
      "punctuation-plus-modifier",
      "bounded-relative",
      "bounded-parenthetical",
      "modifier",
      "unsupported",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.bridgeQualification,
      ),
    ),
    new Set([
      "none",
      "descriptive",
      "changed-subject",
      "conditional",
      "unsupported",
      "local-step",
      "exception",
      "specific-target",
    ]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.verbForm,
      ),
    ),
    new Set(["none", "base", "third-person"]),
  );
  assert.deepEqual(
    new Set(
      CURRENT_BODY_POLICY_PRECISION_MATRIX.map(
        ({ coverage }) => coverage.layout,
      ),
    ),
    new Set(["one-line", "soft-wrap", "heading"]),
  );
  assert.equal(
    CURRENT_BODY_POLICY_PRECISION_MATRIX.at(-1)?.expected.length,
    3,
    "one public finding remains for each enabled domain after same-domain deduplication",
  );
});

function assertPairwiseCoverage(
  label: string,
  fixtures: typeof PAIRWISE_CASES,
  leftKey: string,
  leftValues: readonly (string | number)[],
  rightKey: string,
  rightValues: readonly (string | number)[],
): void {
  const actual = new Set(
    fixtures.map(
      ({ coverage }) =>
        `${String(coverage[leftKey])}:${String(coverage[rightKey])}`,
    ),
  );
  const expected = new Set(
    leftValues.flatMap((left) =>
      rightValues.map((right) => `${String(left)}:${String(right)}`),
    ),
  );
  assert.deepEqual(actual, expected, label);
}

function compatibilityChange(
  current: readonly LegacyBodyPolicyFindingProjection[],
  reason: string,
): IntentionalCompatibilityChange {
  return { reason, current };
}

function findingChange(
  snippet: string,
  reason: string,
  endLine = 11,
): IntentionalCompatibilityChange {
  return compatibilityChange([finding(snippet, endLine)], reason);
}

function noFindingChange(reason: string): IntentionalCompatibilityChange {
  return compatibilityChange([], reason);
}

function finding(
  snippet: string,
  endLine = 11,
): LegacyBodyPolicyFindingProjection {
  return {
    id: "SEC-BODY-POLICY-CONTRADICTION",
    severity: "high",
    startLine: 11,
    endLine,
    snippet,
  };
}

function bodyPolicyFindingProjections(
  body: string,
): readonly LegacyBodyPolicyFindingProjection[] {
  const content = [
    "---",
    "name: security",
    "description: Use this deterministic security fixture to verify stable body-policy compatibility behavior.",
    "metadata:",
    "  renma.allowed-data: '[\"disclosed\"]'",
    "  renma.network-allowed: 'true'",
    "  renma.external-upload-allowed: 'true'",
    "  renma.secrets-allowed: 'true'",
    "---",
    "",
    body,
    "",
  ].join("\n");
  return securityDiagnosticFindings([
    {
      path: "skills/security/SKILL.md",
      absolutePath: "/repo/skills/security/SKILL.md",
      kind: "skill",
      sizeBytes: Buffer.byteLength(content),
      contentClassification: "text",
      markdownParserEligible: true,
      content,
    },
  ])
    .filter(({ id }) => id === "SEC-BODY-POLICY-CONTRADICTION")
    .map((findingProjection) => ({
      id: findingProjection.id,
      severity: findingProjection.severity,
      startLine: findingProjection.evidence.startLine,
      endLine:
        findingProjection.evidence.endLine ??
        findingProjection.evidence.startLine,
      snippet: findingProjection.evidence.snippet,
    }));
}
