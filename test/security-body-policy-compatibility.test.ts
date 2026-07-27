import assert from "node:assert/strict";
import test from "node:test";

import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import {
  BODY_POLICY_0244_FINDINGS_BY_CASE,
  BODY_POLICY_0244_GOLDEN_SOURCE,
  type LegacyBodyPolicyFindingProjection,
} from "./fixtures/body-policy-0244-golden.js";

type PolicyDomain = "network" | "upload" | "secrets";
type FirstPredicateKind =
  | "unrelated"
  | "requirement"
  | "not-required"
  | "local"
  | "specific"
  | "workflow-prohibition";
type LaterScope = "workflow" | "local" | "specific" | "unsupported";
type CorpusLayout = "one-line" | "soft-wrap" | "hard-break" | "heading";

interface CompatibilityCorpusCase {
  readonly name: string;
  readonly body: string;
  readonly coverage: {
    readonly subject: string;
    readonly firstKind: string;
    readonly connector: string;
    readonly laterDomain: string;
    readonly scope: string;
    readonly layout: string;
    readonly domainRelationship: string;
    readonly predicateCount: number;
  };
}

interface IntentionalCompatibilityChange {
  readonly reason: string;
  readonly current: readonly LegacyBodyPolicyFindingProjection[];
}

const SUBJECTS = [
  "This workflow",
  "This task",
  "The process",
  "This run",
  "The operation",
] as const;
const DOMAINS = ["network", "upload", "secrets"] as const;
const FIRST_KINDS: readonly FirstPredicateKind[] = [
  "unrelated",
  "requirement",
  "not-required",
  "local",
  "specific",
  "workflow-prohibition",
];
const CONNECTORS = [
  " and ",
  " and also ",
  " but ",
  ", yet ",
  "; however, it ",
  "; ",
  " then ",
  ". ",
] as const;
const LATER_SCOPES: readonly LaterScope[] = [
  "workflow",
  "local",
  "specific",
  "unsupported",
];
const LAYOUTS: readonly CorpusLayout[] = [
  "one-line",
  "soft-wrap",
  "hard-break",
  "heading",
];

const INTENTIONAL_COMPATIBILITY_CHANGES: Readonly<
  Record<string, IntentionalCompatibilityChange>
> = {
  "two-03-one-line-requirement-same-secrets": compatibilityChange(
    "The process requires credentials but must not use credentials.",
    "Statement-group evidence includes the inherited prohibition instead of ending at the earlier subject-bearing predicate.",
  ),
  "two-13-soft-wrap-unrelated-same-network": compatibilityChange(
    "The process validates inputs; however, it\nmust not use the network.",
    "Ordinary Markdown soft wrapping now uses the same statement-group subject inheritance as one-line prose.",
    12,
  ),
  "two-14-soft-wrap-unrelated-cross-upload": compatibilityChange(
    "This run validates inputs;\nmust not upload files.",
    "Strict semicolon compatibility now applies consistently after ordinary Markdown soft wrapping.",
    12,
  ),
  "two-15-soft-wrap-requirement-same-secrets": compatibilityChange(
    "The operation requires credentials then\nmust not use credentials.",
    "Strict then-boundary compatibility now applies consistently after ordinary Markdown soft wrapping.",
    12,
  ),
  "two-23-soft-wrap-workflow-prohibition-same-upload": compatibilityChange(
    "The process must not upload files then",
    "Physical-line evidence retains the visible connector on the occupied source line.",
  ),
  "two-35-hard-break-workflow-prohibition-same-upload": compatibilityChange(
    "The operation must not upload files but",
    "Physical-line evidence retains the visible connector before the Markdown hard break.",
  ),
  "two-36-hard-break-workflow-prohibition-cross-secrets": compatibilityChange(
    "This workflow must not use the network, yet",
    "An independently complete prohibition before a Markdown hard break remains reportable even though its subject is not inherited afterward.",
  ),
  "two-37-heading-unrelated-same-network": compatibilityChange(
    "## This task validates inputs; however, it must not use the network.",
    "Fallback heading evidence now includes the supported inherited prohibition.",
  ),
  "two-38-heading-unrelated-cross-upload": compatibilityChange(
    "## The process validates inputs; must not upload files.",
    "Strict semicolon compatibility is shared by fallback headings and prose paragraphs.",
  ),
  "two-39-heading-requirement-same-secrets": compatibilityChange(
    "## This run requires credentials then must not use credentials.",
    "Strict then-boundary compatibility is shared by fallback headings and prose paragraphs.",
  ),
  "three-01-one-line-unrelated-network": compatibilityChange(
    "This workflow validates inputs but checks local logs, yet must not use the network.",
    "Statement-group subject state intentionally spans three supported predicates.",
  ),
  "three-05-one-line-specific-upload": compatibilityChange(
    "The operation must not access credentials from production but checks local logs yet must not upload files.",
    "A specific-source first predicate no longer prevents three-predicate subject inheritance.",
  ),
  "three-06-soft-wrap-workflow-prohibition-secrets": compatibilityChange(
    "This workflow must not use the network, but",
    "An independently complete first-domain prohibition remains reportable before later soft-wrapped predicates.",
  ),
  "three-09-one-line-not-required-secrets": compatibilityChange(
    "This run does not require network access but checks local logs yet must not use credentials.",
    "A not-required first predicate no longer prevents three-predicate subject inheritance.",
  ),
  "three-12-heading-workflow-prohibition-secrets": compatibilityChange(
    "## This task must not use the network,",
    "Fallback statement segmentation preserves an independently supported first-domain prohibition.",
  ),
  "three-13-one-line-unrelated-network": compatibilityChange(
    "The process validates inputs but checks local logs, yet must not use the network.",
    "Statement-group subject state intentionally spans three supported predicates.",
  ),
  "stabilization-unrelated-workflow": compatibilityChange(
    "This workflow validates inputs but must not use credentials.",
    "Evidence now includes the inherited prohibition for a domain-free first predicate.",
  ),
  "stabilization-unrelated-task": compatibilityChange(
    "This task prepares the report, yet must not upload files.",
    "Evidence now includes the inherited prohibition for a domain-free first predicate.",
  ),
  "stabilization-unrelated-process": compatibilityChange(
    "The process checks configuration; however, it must not use the network.",
    "Evidence now includes the inherited prohibition for a domain-free first predicate.",
  ),
  "stabilization-specific-network": compatibilityChange(
    "This workflow must not use network access to production systems but must not use credentials.",
    "Subject proof is intentionally independent of a specific-target first fact.",
  ),
  "stabilization-specific-secret": compatibilityChange(
    "This workflow must not access credentials from production yet must not upload files.",
    "Subject proof is intentionally independent of a specific-source first fact.",
  ),
  "stabilization-three-secrets": compatibilityChange(
    "This workflow requires network access but checks logs, yet must not use credentials.",
    "Evidence now spans the complete three-predicate statement group.",
  ),
  "stabilization-three-upload": compatibilityChange(
    "This workflow requires network access, but may write local logs, yet must not upload files.",
    "Statement-group subject state intentionally spans three supported predicates beyond the legacy regex distance.",
  ),
  "stabilization-modifier-still": compatibilityChange(
    "This workflow requires network access but still must not use credentials.",
    "Evidence includes the supported bounded modifier and inherited prohibition.",
  ),
  "stabilization-modifier-also": compatibilityChange(
    "This workflow requires credentials yet also must not upload files.",
    "Evidence includes the supported bounded modifier and inherited prohibition.",
  ),
  "stabilization-modifier-therefore": compatibilityChange(
    "This workflow requires external uploads; however, it therefore must not use the network.",
    "The bounded statement modifier grammar intentionally supports therefore without enumerating arbitrary adverbs.",
  ),
  "stabilization-heading": compatibilityChange(
    "## This workflow requires network access but must not use credentials",
    "Fallback heading evidence now includes the inherited prohibition.",
  ),
  "stabilization-bare-semicolon": compatibilityChange(
    "This workflow requires network access; must not use credentials.",
    "Strict semicolon compatibility retains the finding while evidence now includes its prohibition.",
  ),
  "stabilization-then": compatibilityChange(
    "This workflow requires network access then must not use credentials.",
    "Strict then-boundary compatibility retains the finding while evidence now includes its prohibition.",
  ),
};

const COMPATIBILITY_CORPUS = bodyPolicyCompatibilityCorpus();

test("0.24.4 body-policy golden corpus spans the supported compatibility axes", () => {
  assert.equal(BODY_POLICY_0244_GOLDEN_SOURCE.tag, "v0.24.4");
  assert.equal(BODY_POLICY_0244_GOLDEN_SOURCE.commit, "9e72e1a");
  assert.equal(COMPATIBILITY_CORPUS.length, 79);
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.flatMap(({ coverage }) =>
        SUBJECTS.includes(coverage.subject as (typeof SUBJECTS)[number])
          ? [coverage.subject]
          : [],
      ),
    ),
    new Set(SUBJECTS),
  );
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.flatMap(({ coverage }) =>
        FIRST_KINDS.includes(coverage.firstKind as FirstPredicateKind)
          ? [coverage.firstKind]
          : [],
      ),
    ),
    new Set(FIRST_KINDS),
  );
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.flatMap(({ coverage }) =>
        DOMAINS.includes(coverage.laterDomain as PolicyDomain)
          ? [coverage.laterDomain]
          : [],
      ),
    ),
    new Set(DOMAINS),
  );
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.flatMap(({ coverage }) =>
        LATER_SCOPES.includes(coverage.scope as LaterScope)
          ? [coverage.scope]
          : [],
      ),
    ),
    new Set(LATER_SCOPES),
  );
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.flatMap(({ coverage }) =>
        LAYOUTS.includes(coverage.layout as CorpusLayout)
          ? [coverage.layout]
          : [],
      ),
    ),
    new Set(LAYOUTS),
  );
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.map(
        ({ coverage }) => coverage.domainRelationship,
      ).filter(
        (relationship) => relationship === "same" || relationship === "cross",
      ),
    ),
    new Set(["same", "cross"]),
  );
  assert.deepEqual(
    new Set(
      COMPATIBILITY_CORPUS.map(
        ({ coverage }) => coverage.predicateCount,
      ).filter((count) => count === 2 || count === 3),
    ),
    new Set([2, 3]),
  );
  assert.ok(
    COMPATIBILITY_CORPUS.some(({ coverage }) =>
      coverage.connector.includes("+"),
    ),
  );
  assert.ok(
    COMPATIBILITY_CORPUS.some(
      ({ coverage }) =>
        coverage.connector === "." ||
        coverage.layout === "hard-break" ||
        coverage.layout === "hard-boundary",
    ),
  );
});

test("public body-policy findings match 0.24.4 except explicit allowlisted changes", () => {
  const corpusNames = new Set(COMPATIBILITY_CORPUS.map(({ name }) => name));
  for (const goldenName of Object.keys(BODY_POLICY_0244_FINDINGS_BY_CASE)) {
    assert.ok(
      corpusNames.has(goldenName),
      `orphaned golden case ${goldenName}`,
    );
  }
  for (const allowlistedName of Object.keys(
    INTENTIONAL_COMPATIBILITY_CHANGES,
  )) {
    assert.ok(
      corpusNames.has(allowlistedName),
      `orphaned compatibility allowlist case ${allowlistedName}`,
    );
  }

  for (const fixture of COMPATIBILITY_CORPUS) {
    const legacy = BODY_POLICY_0244_FINDINGS_BY_CASE[fixture.name] ?? [];
    const current = bodyPolicyFindingProjections(fixture.body);
    const intentional = INTENTIONAL_COMPATIBILITY_CHANGES[fixture.name];
    if (intentional === undefined) {
      assert.deepEqual(current, legacy, fixture.name);
      continue;
    }
    assert.ok(intentional.reason.trim().length > 0, fixture.name);
    assert.deepEqual(current, intentional.current, fixture.name);
  }
});

function bodyPolicyCompatibilityCorpus(): readonly CompatibilityCorpusCase[] {
  const cases: CompatibilityCorpusCase[] = [];
  for (let index = 0; index < 48; index += 1) {
    const laterDomain = DOMAINS[index % DOMAINS.length];
    assert.ok(laterDomain);
    const sameDomain = index % 2 === 0;
    const earlierDomain = sameDomain
      ? laterDomain
      : DOMAINS[(index + 1) % DOMAINS.length];
    const subject = SUBJECTS[index % SUBJECTS.length];
    const firstKind = FIRST_KINDS[Math.floor(index / 2) % FIRST_KINDS.length];
    const connector = CONNECTORS[index % CONNECTORS.length];
    const scope = LATER_SCOPES[Math.floor(index / 3) % LATER_SCOPES.length];
    const layout = LAYOUTS[Math.floor(index / 12) % LAYOUTS.length];
    assert.ok(
      earlierDomain && subject && firstKind && connector && scope && layout,
    );
    cases.push({
      name: `two-${String(index + 1).padStart(2, "0")}-${layout}-${firstKind}-${sameDomain ? "same" : "cross"}-${laterDomain}`,
      coverage: {
        subject,
        firstKind,
        connector: connector.trim(),
        laterDomain,
        scope,
        layout,
        domainRelationship: sameDomain ? "same" : "cross",
        predicateCount: 2,
      },
      body: renderBody({
        subject,
        firstPredicate: firstPredicate(firstKind, earlierDomain),
        connector,
        laterPredicate: laterPredicate(laterDomain, scope),
        layout,
      }),
    });
  }

  for (let index = 0; index < 15; index += 1) {
    const subject = SUBJECTS[index % SUBJECTS.length];
    const laterDomain = DOMAINS[index % DOMAINS.length];
    const earlierDomain = DOMAINS[(index + 1) % DOMAINS.length];
    const firstKind = FIRST_KINDS[index % FIRST_KINDS.length];
    const scope = LATER_SCOPES[index % LATER_SCOPES.length];
    const layout = LAYOUTS[index % LAYOUTS.length];
    assert.ok(
      subject && laterDomain && earlierDomain && firstKind && scope && layout,
    );
    const firstConnector = index % 2 === 0 ? " but " : ", but ";
    const secondConnector = index % 3 === 0 ? ", yet " : " yet ";
    cases.push({
      name: `three-${String(index + 1).padStart(2, "0")}-${layout}-${firstKind}-${laterDomain}`,
      coverage: {
        subject,
        firstKind,
        connector: `${firstConnector.trim()} + ${secondConnector.trim()}`,
        laterDomain,
        scope,
        layout,
        domainRelationship: "cross",
        predicateCount: 3,
      },
      body: renderThreePredicateBody({
        subject,
        firstPredicate: firstPredicate(firstKind, earlierDomain),
        firstConnector,
        middlePredicate:
          index % 2 === 0 ? "checks local logs" : "may write local logs",
        secondConnector,
        laterPredicate: laterPredicate(laterDomain, scope),
        layout,
      }),
    });
  }

  cases.push(
    compatibilityCase(
      "domain-order-and-deduplication",
      [
        "This workflow must not use credentials.",
        "This workflow must not upload files.",
        "This workflow must not use the network.",
        "This workflow must not use credentials.",
        "This workflow must not use the network.",
      ].join(" "),
      5,
    ),
    compatibilityCase(
      "paragraph-boundary-isolation",
      "This workflow validates inputs.\n\nMust not use credentials.",
      2,
      "hard-boundary",
    ),
    compatibilityCase(
      "list-item-boundary-isolation",
      "- This task requires network access\n- Must not upload files.",
      2,
      "hard-boundary",
    ),
  );

  for (const [name, body] of Object.entries({
    "stabilization-unrelated-workflow":
      "This workflow validates inputs but must not use credentials.",
    "stabilization-unrelated-task":
      "This task prepares the report, yet must not upload files.",
    "stabilization-unrelated-process":
      "The process checks configuration; however, it must not use the network.",
    "stabilization-specific-network":
      "This workflow must not use network access to production systems but must not use credentials.",
    "stabilization-specific-secret":
      "This workflow must not access credentials from production yet must not upload files.",
    "stabilization-three-secrets":
      "This workflow requires network access but checks logs, yet must not use credentials.",
    "stabilization-three-upload":
      "This workflow requires network access, but may write local logs, yet must not upload files.",
    "stabilization-modifier-still":
      "This workflow requires network access but still must not use credentials.",
    "stabilization-modifier-also":
      "This workflow requires credentials yet also must not upload files.",
    "stabilization-modifier-therefore":
      "This workflow requires external uploads; however, it therefore must not use the network.",
    "stabilization-heading":
      "## This workflow requires network access but must not use credentials",
    "stabilization-bare-semicolon":
      "This workflow requires network access; must not use credentials.",
    "stabilization-then":
      "This workflow requires network access then must not use credentials.",
  })) {
    cases.push(
      compatibilityCase(
        name,
        body,
        name.includes("three") ? 3 : 2,
        name.endsWith("heading") ? "heading" : "one-line",
      ),
    );
  }
  return cases;
}

function compatibilityCase(
  name: string,
  body: string,
  predicateCount: number,
  layout = "one-line",
): CompatibilityCorpusCase {
  return {
    name,
    body,
    coverage: {
      subject: "stabilization",
      firstKind: "stabilization",
      connector: "stabilization",
      laterDomain: "stabilization",
      scope: "stabilization",
      layout,
      domainRelationship: "mixed",
      predicateCount,
    },
  };
}

function compatibilityChange(
  snippet: string,
  reason: string,
  endLine = 11,
): IntentionalCompatibilityChange {
  return {
    reason,
    current: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine,
        snippet,
      },
    ],
  };
}

function firstPredicate(
  kind: FirstPredicateKind,
  domain: PolicyDomain,
): string {
  if (kind === "unrelated") return "validates inputs";
  return {
    network: {
      requirement: "requires network access",
      "not-required": "does not require network access",
      local: "must not use the network during local setup",
      specific: "must not use network access to production systems",
      "workflow-prohibition": "must not use the network",
    },
    upload: {
      requirement: "requires external uploads",
      "not-required": "does not require external uploads",
      local: "must not upload files during local setup",
      specific: "must not upload files to a staging bucket",
      "workflow-prohibition": "must not upload files",
    },
    secrets: {
      requirement: "requires credentials",
      "not-required": "does not require credential access",
      local: "must not use credentials during local setup",
      specific: "must not access credentials from production",
      "workflow-prohibition": "must not use credentials",
    },
  }[domain][kind];
}

function laterPredicate(domain: PolicyDomain, scope: LaterScope): string {
  return {
    network: {
      workflow: "must not use the network",
      local: "must not use the network during local setup",
      specific: "must not use network access to production systems",
      unsupported: "must not use the network except for approved domains",
    },
    upload: {
      workflow: "must not upload files",
      local: "must not upload files during local setup",
      specific: "must not upload files to a public bucket",
      unsupported: "must not upload files except to approved storage",
    },
    secrets: {
      workflow: "must not use credentials",
      local: "must not use credentials during local setup",
      specific: "must not access credentials from production",
      unsupported: "must not use credentials unless explicitly approved",
    },
  }[domain][scope];
}

function renderBody(input: {
  readonly subject: string;
  readonly firstPredicate: string;
  readonly connector: string;
  readonly laterPredicate: string;
  readonly layout: CorpusLayout;
}): string {
  if (input.layout === "hard-break") {
    return `${input.subject} ${input.firstPredicate}${input.connector.trimEnd()}  \n${input.laterPredicate}.`;
  }
  const statement = `${input.subject} ${input.firstPredicate}${input.connector}${input.laterPredicate}.`;
  if (input.layout === "soft-wrap") {
    return statement.replace(input.connector, `${input.connector.trimEnd()}\n`);
  }
  return input.layout === "heading" ? `## ${statement}` : statement;
}

function renderThreePredicateBody(input: {
  readonly subject: string;
  readonly firstPredicate: string;
  readonly firstConnector: string;
  readonly middlePredicate: string;
  readonly secondConnector: string;
  readonly laterPredicate: string;
  readonly layout: CorpusLayout;
}): string {
  if (input.layout === "hard-break") {
    return `${input.subject} ${input.firstPredicate}${input.firstConnector}${input.middlePredicate}${input.secondConnector.trimEnd()}  \n${input.laterPredicate}.`;
  }
  const statement = `${input.subject} ${input.firstPredicate}${input.firstConnector}${input.middlePredicate}${input.secondConnector}${input.laterPredicate}.`;
  if (input.layout === "soft-wrap") {
    return statement
      .replace(input.firstConnector, `${input.firstConnector.trimEnd()}\n`)
      .replace(input.secondConnector, `${input.secondConnector.trimEnd()}\n`);
  }
  return input.layout === "heading" ? `## ${statement}` : statement;
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
    .map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      startLine: finding.evidence.startLine,
      endLine: finding.evidence.endLine ?? finding.evidence.startLine,
      snippet: finding.evidence.snippet,
    }));
}
