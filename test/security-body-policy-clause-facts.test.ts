import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyPolicyStatementGroupFacts,
  type BodyPolicyClauseFacts,
  type BodyPolicyModality,
  type BodyPolicyScope,
} from "../src/security-body-policy/clause-facts.js";
import { disclosureClauseRangesIntersectingRange } from "../src/security-command/guards.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Finding } from "../src/types/diagnostics.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

type PolicyDomain = "network" | "upload" | "secrets";

interface CharacterizationCase {
  readonly name: string;
  readonly domain: PolicyDomain;
  readonly body: string;
  readonly modality: BodyPolicyModality;
  readonly scope: BodyPolicyScope;
  readonly completeness: BodyPolicyClauseFacts["completeness"];
  readonly expectedFinding: boolean;
}

interface SameClauseRegressionCase {
  readonly name: string;
  readonly domain: PolicyDomain;
  readonly prefix: string;
  readonly connector: " and " | ", and ";
  readonly laterProhibition: string;
  readonly wrappedLaterProhibition: string;
  readonly prefixEvidence: string;
  readonly prefixModality: BodyPolicyModality;
  readonly prefixScope: BodyPolicyScope;
  readonly prefixCompleteness: BodyPolicyClauseFacts["completeness"];
}

interface SharedSubjectRegressionCase {
  readonly name: string;
  readonly domain: PolicyDomain;
  readonly firstPredicate: string;
  readonly firstModality: BodyPolicyModality;
  readonly firstScope: BodyPolicyScope;
  readonly laterPredicate: string;
}

interface ModifiedSharedSubjectRegressionCase extends SharedSubjectRegressionCase {
  readonly connector:
    | " and also "
    | ", and also "
    | " and still "
    | ", "
    | " and therefore ";
}

interface ContrastiveSharedSubjectRegressionCase extends SharedSubjectRegressionCase {
  readonly connector:
    | " but "
    | ", but "
    | " yet "
    | ", yet "
    | " however, "
    | "; however, ";
  readonly laterSubject: "" | "it ";
}

interface CrossDomainContrastiveRegressionCase {
  readonly name: string;
  readonly earlierDomain: PolicyDomain;
  readonly laterDomain: PolicyDomain;
  readonly firstPredicate: string;
  readonly firstModality: BodyPolicyModality;
  readonly connector: " but " | ", yet " | "; however, ";
  readonly laterSubject: "" | "it ";
  readonly laterPredicate: string;
}

const BODY_POLICY_MATRIX: readonly CharacterizationCase[] = [
  {
    name: "network prohibited workflow complete",
    domain: "network",
    body: "This workflow must not use the network.",
    modality: "prohibited",
    scope: "workflow",
    completeness: "complete",
    expectedFinding: true,
  },
  {
    name: "network prohibited local step complete",
    domain: "network",
    body: "Do not use network access during local setup.",
    modality: "prohibited",
    scope: "local-step",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "network not required workflow complete",
    domain: "network",
    body: "Network access is not required for this workflow.",
    modality: "not-required",
    scope: "workflow",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "network prohibited unknown scope complete",
    domain: "network",
    body: "Do not use network access during maintenance.",
    modality: "prohibited",
    scope: "unknown",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "network prohibited workflow unsupported remainder",
    domain: "network",
    body: "No network access except to approved domains.",
    modality: "prohibited",
    scope: "workflow",
    completeness: "unsupported-remainder",
    expectedFinding: false,
  },
  {
    name: "upload prohibited workflow complete",
    domain: "upload",
    body: "External uploads are forbidden for this workflow.",
    modality: "prohibited",
    scope: "workflow",
    completeness: "complete",
    expectedFinding: true,
  },
  {
    name: "upload prohibited specific target complete",
    domain: "upload",
    body: "Never upload debug logs to a public bucket.",
    modality: "prohibited",
    scope: "specific-target",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "upload local safeguard specific target complete",
    domain: "upload",
    body: "Do not upload secrets to third-party services.",
    modality: "local-safeguard",
    scope: "specific-target",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "upload prohibited workflow unsupported remainder",
    domain: "upload",
    body: "No external uploads unless explicitly approved.",
    modality: "prohibited",
    scope: "workflow",
    completeness: "unsupported-remainder",
    expectedFinding: false,
  },
  {
    name: "secrets prohibited workflow complete",
    domain: "secrets",
    body: "Credentials must not be used in this workflow.",
    modality: "prohibited",
    scope: "workflow",
    completeness: "complete",
    expectedFinding: true,
  },
  {
    name: "secrets dot-env vocabulary prohibited workflow complete",
    domain: "secrets",
    body: "This workflow must not use .env files.",
    modality: "prohibited",
    scope: "workflow",
    completeness: "complete",
    expectedFinding: true,
  },
  {
    name: "secrets prohibited local step complete",
    domain: "secrets",
    body: "Never access credentials during local setup.",
    modality: "prohibited",
    scope: "local-step",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "secrets prohibited specific source complete",
    domain: "secrets",
    body: "This workflow must not access credentials from production.",
    modality: "prohibited",
    scope: "specific-source",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "secrets not required workflow complete",
    domain: "secrets",
    body: "No secret access should be needed for this task.",
    modality: "not-required",
    scope: "workflow",
    completeness: "complete",
    expectedFinding: false,
  },
  {
    name: "secrets unknown modality and scope complete",
    domain: "secrets",
    body: "Credential handling deserves careful review.",
    modality: "unknown",
    scope: "unknown",
    completeness: "complete",
    expectedFinding: false,
  },
] as const;

const SAME_CLAUSE_REGRESSIONS: readonly SameClauseRegressionCase[] = [
  ...sameClauseDomainCases(
    "network",
    "this workflow must not use the network",
    "this workflow must not use\nthe network",
    {
      notRequired: "Network access is not required",
      affirmativeRequirement: "Network access is required",
      localProhibition: "Do not use network access during local setup",
      unsupportedProhibition: "No network access except to approved domains",
      unsupportedEvidence: "No network access",
      localSafeguard:
        "Do not allow npx to download a missing package from the internet",
      localSafeguardScope: "specific-source",
    },
  ),
  ...sameClauseDomainCases(
    "upload",
    "this workflow must not upload files",
    "this workflow must not upload\nfiles",
    {
      notRequired: "External uploads are not required",
      affirmativeRequirement: "External uploads are required",
      localProhibition:
        "Never perform external uploads during local validation",
      unsupportedProhibition: "No external uploads unless explicitly approved",
      unsupportedEvidence: "No external uploads",
      localSafeguard: "Do not upload secrets to third-party services",
      localSafeguardScope: "specific-target",
    },
  ),
  ...sameClauseDomainCases(
    "secrets",
    "credentials must not be used in this workflow",
    "credentials must not be used\nin this workflow",
    {
      notRequired: "Secret access is not required",
      affirmativeRequirement: "Secret access is required",
      localProhibition: "Never access credentials during local setup",
      unsupportedProhibition:
        "No secret access except through the approved vault",
      unsupportedEvidence: "No secret access",
      localSafeguard: "Never print secrets to logs",
      localSafeguardScope: "specific-target",
    },
  ),
];

const SHARED_SUBJECT_REGRESSIONS: readonly SharedSubjectRegressionCase[] = [
  ...sharedSubjectDomainCases("network", "must not use the network", {
    affirmativeRequirement: "requires network access",
    negativeRequirement: "does not require network access",
    specificRestriction: "must not use network access to production systems",
    specificScope: "specific-target",
    specificModality: "local-safeguard",
    localSafeguard:
      "must not allow npx to download a missing package from the internet",
    localSafeguardScope: "specific-source",
  }),
  ...sharedSubjectDomainCases("upload", "must not upload files", {
    affirmativeRequirement: "requires external uploads",
    negativeRequirement: "does not require external uploads",
    specificRestriction: "must not upload logs to a public bucket",
    specificScope: "specific-target",
    specificModality: "prohibited",
    localSafeguard: "must not upload secrets to third-party services",
    localSafeguardScope: "specific-target",
  }),
  ...sharedSubjectDomainCases("secrets", "must not use credentials", {
    affirmativeRequirement: "requires credentials",
    negativeRequirement: "does not require credentials",
    specificRestriction: "must not access credentials from production",
    specificScope: "specific-source",
    specificModality: "prohibited",
    localSafeguard: "must not print secrets to logs",
    localSafeguardScope: "specific-target",
  }),
];

const MODIFIED_SHARED_SUBJECT_REGRESSIONS: readonly ModifiedSharedSubjectRegressionCase[] =
  [
    ...modifiedSharedSubjectDomainCases(
      "network",
      "must not use the network",
      "requires network access",
      "does not require network access",
    ),
    ...modifiedSharedSubjectDomainCases(
      "upload",
      "must not upload files",
      "requires external uploads",
      "does not require external uploads",
    ),
    ...modifiedSharedSubjectDomainCases(
      "secrets",
      "must not use credentials",
      "requires credentials",
      "does not require credentials",
    ),
  ];

const CONTRASTIVE_SHARED_SUBJECT_REGRESSIONS: readonly ContrastiveSharedSubjectRegressionCase[] =
  [
    ...contrastiveSharedSubjectDomainCases(
      "network",
      "must not use the network",
      "requires network access",
      "does not require network access",
    ),
    ...contrastiveSharedSubjectDomainCases(
      "upload",
      "must not upload files",
      "requires external uploads",
      "does not require external uploads",
    ),
    ...contrastiveSharedSubjectDomainCases(
      "secrets",
      "must not use credentials",
      "requires credentials",
      "does not require credentials",
    ),
  ];

const CROSS_DOMAIN_CONTRASTIVE_REGRESSIONS: readonly CrossDomainContrastiveRegressionCase[] =
  [
    {
      name: "network to secrets",
      earlierDomain: "network",
      laterDomain: "secrets",
      firstPredicate: "requires network access",
      firstModality: "unknown",
      connector: " but ",
      laterSubject: "",
      laterPredicate: "must not use credentials",
    },
    {
      name: "network to upload",
      earlierDomain: "network",
      laterDomain: "upload",
      firstPredicate: "requires network access",
      firstModality: "unknown",
      connector: ", yet ",
      laterSubject: "",
      laterPredicate: "must not upload files",
    },
    {
      name: "secrets to network",
      earlierDomain: "secrets",
      laterDomain: "network",
      firstPredicate: "requires credentials",
      firstModality: "unknown",
      connector: " but ",
      laterSubject: "",
      laterPredicate: "must not use the network",
    },
    {
      name: "secrets to upload",
      earlierDomain: "secrets",
      laterDomain: "upload",
      firstPredicate: "requires credentials",
      firstModality: "unknown",
      connector: "; however, ",
      laterSubject: "it ",
      laterPredicate: "must not upload files",
    },
    {
      name: "upload to secrets",
      earlierDomain: "upload",
      laterDomain: "secrets",
      firstPredicate: "requires external uploads",
      firstModality: "unknown",
      connector: " but ",
      laterSubject: "",
      laterPredicate: "must not use credentials",
    },
    {
      name: "upload to network",
      earlierDomain: "upload",
      laterDomain: "network",
      firstPredicate: "requires external uploads",
      firstModality: "unknown",
      connector: ", yet ",
      laterSubject: "",
      laterPredicate: "must not use the network",
    },
    {
      name: "negative network requirement to upload",
      earlierDomain: "network",
      laterDomain: "upload",
      firstPredicate: "does not require network access",
      firstModality: "not-required",
      connector: ", yet ",
      laterSubject: "",
      laterPredicate: "must not upload files",
    },
  ];

test("body-policy characterization matrix documents representative fact dimensions", () => {
  for (const fixture of BODY_POLICY_MATRIX) {
    const findings = bodyPolicyFindings(fixture.body, fixture.domain);
    assert.equal(
      findings.length,
      fixture.expectedFinding ? 1 : 0,
      fixture.name,
    );
  }
});

test("private clause facts express each characterization dimension independently", () => {
  for (const fixture of BODY_POLICY_MATRIX) {
    const fact = statementGroupFacts(fixture.body).find(
      ({ domain }) => domain === fixture.domain,
    );
    assert.ok(fact, fixture.name);
    assert.deepEqual(
      {
        domain: fact.domain,
        modality: fact.modality,
        scope: fact.scope,
        completeness: fact.completeness,
      },
      {
        domain: fixture.domain,
        modality: fixture.modality,
        scope: fixture.scope,
        completeness: fixture.completeness,
      },
      fixture.name,
    );
    assert.ok(fact.evidenceStart >= 0, fixture.name);
    assert.ok(fact.evidenceEnd > fact.evidenceStart, fixture.name);
    assert.ok(fact.evidenceEnd <= fixture.body.length, fixture.name);
  }
});

test("one clause derives independent facts for every supported domain", () => {
  assert.deepEqual(
    statementGroupFacts("Do not upload secrets to third-party services.").map(
      ({ domain, modality, scope, completeness }) => ({
        domain,
        modality,
        scope,
        completeness,
      }),
    ),
    [
      {
        domain: "upload",
        modality: "local-safeguard",
        scope: "specific-target",
        completeness: "complete",
      },
      {
        domain: "secrets",
        modality: "local-safeguard",
        scope: "specific-target",
        completeness: "complete",
      },
    ],
  );
});

test("same-domain candidates remain independent before later workflow prohibitions", () => {
  for (const fixture of SAME_CLAUSE_REGRESSIONS) {
    for (const variant of [
      {
        name: "one line",
        body: `${fixture.prefix}${fixture.connector}${fixture.laterProhibition}.`,
        expectedSnippet: `${fixture.laterProhibition}.`,
      },
      {
        name: "soft wrapped",
        body: `${fixture.prefix}${fixture.connector}${fixture.wrappedLaterProhibition}.`,
        expectedSnippet: `${fixture.wrappedLaterProhibition}.`,
      },
    ]) {
      const normalizedClause = variant.body.replaceAll("\n", " ");
      const normalizedLater = fixture.laterProhibition;
      const facts = statementGroupFacts(normalizedClause).filter(
        ({ domain }) => domain === fixture.domain,
      );
      assert.equal(facts.length, 2, `${fixture.name}, ${variant.name}`);
      assertFactEvidence(
        facts[0],
        normalizedClause,
        fixture.prefixEvidence,
        {
          modality: fixture.prefixModality,
          scope: fixture.prefixScope,
          completeness: fixture.prefixCompleteness,
        },
        `${fixture.name}, ${variant.name}, prefix`,
      );
      assertFactEvidence(
        facts[1],
        normalizedClause,
        normalizedLater,
        {
          modality: "prohibited",
          scope: "workflow",
          completeness: "complete",
        },
        `${fixture.name}, ${variant.name}, later prohibition`,
      );

      const findings = bodyPolicyFindings(variant.body, fixture.domain);
      assert.equal(findings.length, 1, `${fixture.name}, ${variant.name}`);
      assert.equal(
        findings[0]?.evidence.snippet,
        variant.expectedSnippet,
        `${fixture.name}, ${variant.name}`,
      );
    }
  }
});

test("shared workflow subjects retain independent coordinated predicate facts", () => {
  for (const fixture of SHARED_SUBJECT_REGRESSIONS) {
    for (const variant of [
      {
        name: "and",
        body: `This workflow ${fixture.firstPredicate} and ${fixture.laterPredicate}.`,
      },
      {
        name: "comma and",
        body: `This workflow ${fixture.firstPredicate}, and ${fixture.laterPredicate}.`,
      },
      {
        name: "soft wrapped",
        body: `This workflow ${fixture.firstPredicate}, and\n${fixture.laterPredicate}.`,
      },
    ]) {
      const normalizedClause = variant.body.replaceAll("\n", " ");
      const firstEvidence = `This workflow ${fixture.firstPredicate}`;
      const laterEvidence = normalizedClause.slice(0, -1);
      const facts = statementGroupFacts(normalizedClause).filter(
        ({ domain }) => domain === fixture.domain,
      );
      assert.equal(facts.length, 2, `${fixture.name}, ${variant.name}`);
      assertFactEvidence(
        facts[0],
        normalizedClause,
        firstEvidence,
        {
          modality: fixture.firstModality,
          scope: fixture.firstScope,
          completeness: "complete",
        },
        `${fixture.name}, ${variant.name}, first predicate`,
      );
      assertFactEvidence(
        facts[1],
        normalizedClause,
        laterEvidence,
        {
          modality: "prohibited",
          scope: "workflow",
          completeness: "complete",
        },
        `${fixture.name}, ${variant.name}, later predicate`,
      );

      const findings = bodyPolicyFindings(variant.body, fixture.domain);
      assert.equal(findings.length, 1, `${fixture.name}, ${variant.name}`);
      assert.equal(
        findings[0]?.evidence.snippet,
        variant.body,
        `${fixture.name}, ${variant.name}`,
      );
    }
  }
});

test("direct workflow-prefix matches retain modified shared-subject predicates", () => {
  for (const fixture of MODIFIED_SHARED_SUBJECT_REGRESSIONS) {
    for (const softWrapped of [false, true]) {
      const body = softWrapped
        ? `This workflow ${fixture.firstPredicate}${fixture.connector.trimEnd()}\n${fixture.laterPredicate}.`
        : `This workflow ${fixture.firstPredicate}${fixture.connector}${fixture.laterPredicate}.`;
      const variant = softWrapped ? "soft wrapped" : "one line";
      const message = `${fixture.name}, ${variant}`;
      const normalizedClause = body.replaceAll("\n", " ");
      const firstEvidence = `This workflow ${fixture.firstPredicate}`;
      const laterEvidence = normalizedClause.slice(0, -1);
      const facts = statementGroupFacts(normalizedClause).filter(
        ({ domain }) => domain === fixture.domain,
      );

      assert.equal(facts.length, 2, message);
      assertFactEvidence(
        facts[0],
        normalizedClause,
        firstEvidence,
        {
          modality: fixture.firstModality,
          scope: fixture.firstScope,
          completeness: "complete",
        },
        `${message}, first predicate`,
      );
      assertFactEvidence(
        facts[1],
        normalizedClause,
        laterEvidence,
        {
          modality: "prohibited",
          scope: "workflow",
          completeness: "complete",
        },
        `${message}, later predicate`,
      );

      const findings = bodyPolicyFindings(body, fixture.domain);
      assert.equal(findings.length, 1, message);
      assert.equal(findings[0]?.evidence.snippet, body, message);
    }
  }
});

test("every workflow-prefix prohibition family retains a modified coordinated predicate", () => {
  for (const { domain, body } of [
    {
      domain: "network",
      body: "This workflow requires network access and also must run offline.",
    },
    {
      domain: "upload",
      body: "This workflow requires external uploads and also must not upload anything externally.",
    },
    {
      domain: "secrets",
      body: "This workflow requires credentials and also must run without secrets.",
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 2, body);
    assert.deepEqual(
      {
        modality: facts[1]?.modality,
        scope: facts[1]?.scope,
        completeness: facts[1]?.completeness,
      },
      {
        modality: "prohibited",
        scope: "workflow",
        completeness: "complete",
      },
      body,
    );
    assert.equal(bodyPolicyFindings(body, domain).length, 1, body);
  }
});

test("contrastive clause boundaries retain shared workflow-subject facts", () => {
  for (const fixture of CONTRASTIVE_SHARED_SUBJECT_REGRESSIONS) {
    for (const softWrapped of [false, true]) {
      const body = softWrapped
        ? `This workflow ${fixture.firstPredicate}${fixture.connector.trimEnd()}\n${fixture.laterSubject}${fixture.laterPredicate}.`
        : `This workflow ${fixture.firstPredicate}${fixture.connector}${fixture.laterSubject}${fixture.laterPredicate}.`;
      const variant = softWrapped ? "soft wrapped" : "one line";
      const message = `${fixture.name}, ${variant}`;
      const normalizedBody = body.replaceAll("\n", " ");
      const firstEvidence = `This workflow ${fixture.firstPredicate}`;
      const laterEvidence = normalizedBody.slice(0, -1);
      const facts = contrastiveClauseFacts(normalizedBody).filter(
        ({ domain }) => domain === fixture.domain,
      );

      assert.equal(facts.length, 2, message);
      assertFactEvidence(
        facts[0],
        normalizedBody,
        firstEvidence,
        {
          modality: fixture.firstModality,
          scope: "workflow",
          completeness: "complete",
        },
        `${message}, first predicate`,
      );
      assertFactEvidence(
        facts[1],
        normalizedBody,
        laterEvidence,
        {
          modality: "prohibited",
          scope: "workflow",
          completeness: "complete",
        },
        `${message}, later predicate`,
      );

      const findings = bodyPolicyFindings(body, fixture.domain);
      assert.equal(findings.length, 1, message);
      assert.equal(findings[0]?.evidence.snippet, body, message);
    }
  }
});

test("contrastive findings retain domain order and one finding per domain", () => {
  const snippets = {
    secrets: "This workflow requires credentials but must not use credentials.",
    upload:
      "This workflow requires external uploads but must not upload files.",
    network:
      "This workflow requires network access but must not use the network.",
    duplicateNetwork:
      "This workflow does not require network access, yet must not use the network.",
  } as const;
  const body = [
    snippets.secrets,
    snippets.upload,
    snippets.network,
    snippets.duplicateNetwork,
  ].join(" ");
  const path = "skills/security/SKILL.md";
  const content = canonicalSkillFixture(
    path,
    `---
metadata:
  renma.allowed-data: '["disclosed"]'
  renma.network-allowed: 'true'
  renma.external-upload-allowed: 'true'
  renma.secrets-allowed: 'true'
---

${body}
`,
  );
  const findings = securityDiagnosticFindings([
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

  assert.deepEqual(
    findings.map((finding) => finding.evidence.snippet),
    [snippets.network, snippets.upload, snippets.secrets],
  );
});

test("contrastive workflow subjects project across body-policy domains", () => {
  for (const fixture of CROSS_DOMAIN_CONTRASTIVE_REGRESSIONS) {
    for (const softWrapped of [false, true]) {
      const body = softWrapped
        ? `This workflow ${fixture.firstPredicate}${fixture.connector.trimEnd()}\n${fixture.laterSubject}${fixture.laterPredicate}.`
        : `This workflow ${fixture.firstPredicate}${fixture.connector}${fixture.laterSubject}${fixture.laterPredicate}.`;
      const normalizedBody = body.replaceAll("\n", " ");
      const variant = softWrapped ? "soft wrapped" : "one line";
      const message = `${fixture.name}, ${variant}`;
      const firstEvidence = `This workflow ${fixture.firstPredicate}`;
      const laterEvidence = normalizedBody.slice(0, -1);
      const facts = contrastiveClauseFacts(normalizedBody);
      const earlierFact = facts.find(
        (fact) =>
          fact.domain === fixture.earlierDomain &&
          fact.evidenceEnd <= firstEvidence.length,
      );
      const laterFact = facts.find(
        (fact) =>
          fact.domain === fixture.laterDomain && fact.modality === "prohibited",
      );

      assertFactEvidence(
        earlierFact,
        normalizedBody,
        firstEvidence,
        {
          modality: fixture.firstModality,
          scope: "workflow",
          completeness: "complete",
        },
        `${message}, earlier domain`,
      );
      assertFactEvidence(
        laterFact,
        normalizedBody,
        laterEvidence,
        {
          modality: "prohibited",
          scope: "workflow",
          completeness: "complete",
        },
        `${message}, later domain`,
      );

      const findings = bodyPolicyFindings(body, fixture.laterDomain);
      assert.equal(findings.length, 1, message);
      assert.equal(findings[0]?.evidence.snippet, body, message);
    }
  }
});

test("contrastive subject proof skips earlier facts without explicit subjects", () => {
  const body =
    "No network access and this workflow requires network access but must not use the network.";
  const normalizedBody = body.replaceAll("\n", " ");
  const facts = contrastiveClauseFacts(normalizedBody).filter(
    (fact) => fact.domain === "network",
  );

  assert.equal(facts.length, 3, body);
  assertFactEvidence(
    facts[2],
    normalizedBody,
    "this workflow requires network access but must not use the network",
    {
      modality: "prohibited",
      scope: "workflow",
      completeness: "complete",
    },
    body,
  );
  const findings = bodyPolicyFindings(body, "network");
  assert.equal(findings.length, 1, body);
  assert.equal(
    findings[0]?.evidence.snippet,
    "No network access and this workflow requires network access",
    body,
  );
});

test("contrastive projection deduplicates a subject proven by multiple facts", () => {
  const body =
    "This workflow requires network access and must run offline but must not use credentials.";
  const facts = contrastiveClauseFacts(body).filter(
    (fact) => fact.domain === "secrets",
  );

  assert.equal(facts.length, 1, body);
  assertFactEvidence(
    facts[0],
    body,
    body.slice(0, -1),
    {
      modality: "prohibited",
      scope: "workflow",
      completeness: "complete",
    },
    body,
  );
  assert.equal(bodyPolicyFindings(body, "secrets").length, 1, body);
});

test("statement groups preserve subjects independently of earlier body-policy facts", () => {
  for (const { name, domain, body } of [
    {
      name: "unrelated workflow predicate",
      domain: "secrets",
      body: "This workflow validates inputs but must not use credentials.",
    },
    {
      name: "unrelated task predicate",
      domain: "upload",
      body: "This task prepares the report, yet must not upload files.",
    },
    {
      name: "unrelated process predicate",
      domain: "network",
      body: "The process checks configuration; however, it must not use the network.",
    },
    {
      name: "specific network predicate",
      domain: "secrets",
      body: "This workflow must not use network access to production systems but must not use credentials.",
    },
    {
      name: "specific secret predicate",
      domain: "upload",
      body: "This workflow must not access credentials from production yet must not upload files.",
    },
  ] as const) {
    for (const softWrapped of [false, true]) {
      const renderedBody = softWrapped
        ? softWrapBeforeStatementConnector(body)
        : body;
      const normalizedBody = renderedBody.replaceAll("\n", " ");
      const facts = statementGroupFacts(normalizedBody).filter(
        (fact) =>
          fact.domain === domain &&
          fact.modality === "prohibited" &&
          fact.scope === "workflow" &&
          fact.completeness === "complete",
      );
      const message = `${name}, ${softWrapped ? "soft wrapped" : "one line"}`;

      assert.equal(facts.length, 1, message);
      assert.equal(
        normalizedBody.slice(facts[0]?.evidenceStart, facts[0]?.evidenceEnd),
        normalizedBody.slice(0, -1),
        message,
      );
      const findings = bodyPolicyFindings(renderedBody, domain);
      assert.equal(findings.length, 1, message);
      assert.equal(findings[0]?.evidence.snippet, renderedBody, message);
    }
  }
});

test("statement-group subject inheritance spans consecutive supported predicates", () => {
  for (const { domain, body } of [
    {
      domain: "secrets",
      body: "This workflow requires network access but checks logs, yet must not use credentials.",
    },
    {
      domain: "upload",
      body: "This workflow requires network access, but may write local logs, yet must not upload files.",
    },
  ] as const) {
    for (const softWrapped of [false, true]) {
      const renderedBody = softWrapped
        ? body.replaceAll(/ (but|yet) /gu, "\n$1 ")
        : body;
      const normalizedBody = renderedBody.replaceAll("\n", " ");
      const facts = statementGroupFacts(normalizedBody).filter(
        (fact) =>
          fact.domain === domain &&
          fact.modality === "prohibited" &&
          fact.scope === "workflow" &&
          fact.completeness === "complete",
      );
      const message = `${domain}, ${softWrapped ? "soft wrapped" : "one line"}`;

      assert.equal(facts.length, 1, message);
      assert.equal(
        normalizedBody.slice(facts[0]?.evidenceStart, facts[0]?.evidenceEnd),
        normalizedBody.slice(0, -1),
        message,
      );
      const findings = bodyPolicyFindings(renderedBody, domain);
      assert.equal(findings.length, 1, message);
      assert.equal(findings[0]?.evidence.snippet, renderedBody, message);
    }
  }
});

test("statement groups accept only the bounded predicate modifier grammar", () => {
  for (const { domain, body } of [
    {
      domain: "secrets",
      body: "This workflow requires network access but still must not use credentials.",
    },
    {
      domain: "upload",
      body: "This workflow requires credentials yet also must not upload files.",
    },
    {
      domain: "network",
      body: "This workflow requires external uploads; however, it still must not use the network.",
    },
  ] as const) {
    for (const softWrapped of [false, true]) {
      const renderedBody = softWrapped
        ? softWrapBeforeStatementConnector(body)
        : body;
      const normalizedBody = renderedBody.replaceAll("\n", " ");
      const facts = statementGroupFacts(normalizedBody).filter(
        (fact) =>
          fact.domain === domain &&
          fact.modality === "prohibited" &&
          fact.scope === "workflow" &&
          fact.completeness === "complete",
      );
      const message = `${domain}, ${softWrapped ? "soft wrapped" : "one line"}`;

      assert.equal(facts.length, 1, message);
      assert.equal(
        normalizedBody.slice(facts[0]?.evidenceStart, facts[0]?.evidenceEnd),
        normalizedBody.slice(0, -1),
        message,
      );
      const findings = bodyPolicyFindings(renderedBody, domain);
      assert.equal(findings.length, 1, message);
      assert.equal(findings[0]?.evidence.snippet, renderedBody, message);
    }
  }
  assert.equal(
    bodyPolicyFindings(
      "This workflow requires network access but unexpectedly must not use credentials.",
      "secrets",
    ).length,
    0,
  );
});

test("fallback visible lines use the statement-group analyzer", () => {
  const body =
    "## This workflow requires network access but must not use credentials";
  const findings = bodyPolicyFindings(body, "secrets");

  assert.equal(findings.length, 1, body);
  assert.equal(findings[0]?.id, "SEC-BODY-POLICY-CONTRADICTION", body);
  assert.equal(
    findings[0]?.evidence.snippet,
    "## This workflow requires network access but must not use credentials",
    body,
  );
});

test("bare semicolons and then retain the strict 0.24.4 decision boundary", () => {
  for (const { domain, body } of [
    {
      domain: "secrets",
      body: "This workflow requires network access; must not use credentials.",
    },
    {
      domain: "upload",
      body: "This workflow requires network access then must not upload files.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 1, body);
  }
});

test("shared workflow-subject negative controls remain clean", () => {
  for (const { domain, body, expected } of [
    {
      domain: "network",
      body: "This workflow requires network access.",
      expected: { modality: "unknown", scope: "workflow" },
    },
    {
      domain: "network",
      body: "This workflow does not require network access.",
      expected: { modality: "not-required", scope: "workflow" },
    },
    {
      domain: "network",
      body: "This workflow must not use network access to production systems.",
      expected: { modality: "local-safeguard", scope: "specific-target" },
    },
    {
      domain: "upload",
      body: "This workflow must not upload logs to a public bucket.",
      expected: { modality: "prohibited", scope: "specific-target" },
    },
    {
      domain: "secrets",
      body: "This workflow must not access credentials from production.",
      expected: { modality: "prohibited", scope: "specific-source" },
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assert.deepEqual(
      {
        modality: facts[0]?.modality,
        scope: facts[0]?.scope,
        completeness: facts[0]?.completeness,
      },
      { ...expected, completeness: "complete" },
      body,
    );
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("modified shared-subject text retains body-policy suppression boundaries", () => {
  for (const { name, domain, body } of [
    {
      name: "quoted example",
      domain: "network",
      body: 'This workflow requires network access and also "must not use the network" is example wording.',
    },
    {
      name: "descriptive text",
      domain: "upload",
      body: "This workflow requires external uploads and also documents a prohibition on uploads.",
    },
    {
      name: "conditional prohibition",
      domain: "secrets",
      body: "This workflow requires credentials and also must not use credentials if offline mode is selected.",
    },
    {
      name: "local prohibition",
      domain: "network",
      body: "This workflow requires network access and also must not use the network during local setup.",
    },
    {
      name: "specific target",
      domain: "upload",
      body: "This workflow requires external uploads and also must not upload files to a public bucket.",
    },
    {
      name: "specific source",
      domain: "secrets",
      body: "This workflow requires credentials and also must not access credentials from production.",
    },
    {
      name: "unsupported remainder",
      domain: "network",
      body: "This workflow requires network access and also must not use the network except for approved domains.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 0, name);
  }
});

test("unrelated workflow prose does not give generic prohibitions workflow scope", () => {
  const body =
    "This workflow documents deployment guidance, and also do not expose credentials.";
  const facts = statementGroupFacts(body).filter(
    (fact) => fact.domain === "secrets",
  );
  assert.equal(facts.length, 1, body);
  assertFactEvidence(
    facts[0],
    body,
    "do not expose credentials",
    {
      modality: "unknown",
      scope: "unknown",
      completeness: "complete",
    },
    body,
  );
  assert.equal(bodyPolicyFindings(body, "secrets").length, 0, body);
});

test("contrastive projection preserves body-policy precision boundaries", () => {
  for (const { name, domain, body } of [
    {
      name: "cross-domain changed helper subject",
      domain: "secrets",
      body: "This workflow requires network access but the helper must not use credentials.",
    },
    {
      name: "changed subject stops a later contrastive chain",
      domain: "secrets",
      body: "This workflow validates inputs but the helper checks logs, yet must not use credentials.",
    },
    {
      name: "unsupported ambiguous connector",
      domain: "secrets",
      body: "This workflow validates inputs although must not use credentials.",
    },
    {
      name: "cross-domain period",
      domain: "secrets",
      body: "This workflow requires network access. Must not use credentials.",
    },
    {
      name: "cross-domain local prohibition",
      domain: "secrets",
      body: "This workflow requires network access but must not use credentials during local setup.",
    },
    {
      name: "cross-domain specific upload target",
      domain: "upload",
      body: "This workflow requires network access, yet must not upload files to a public bucket.",
    },
    {
      name: "cross-domain specific secret source",
      domain: "secrets",
      body: "This workflow requires network access; however, must not access credentials from production.",
    },
    {
      name: "cross-domain hard break",
      domain: "secrets",
      body: "This workflow requires network access but  \nmust not use credentials.",
    },
    {
      name: "period and changed subject",
      domain: "network",
      body: "This workflow requires network access. The helper must not use the network.",
    },
    {
      name: "period and implicit subject",
      domain: "network",
      body: "This workflow requires network access. Must not use the network.",
    },
    {
      name: "but and changed local subject",
      domain: "network",
      body: "This workflow requires network access but the local setup must not use the network.",
    },
    {
      name: "bare semicolon and changed command subject",
      domain: "upload",
      body: "This workflow requires external uploads; the validation command must not upload files.",
    },
    {
      name: "semicolon however without comma",
      domain: "network",
      body: "This workflow requires network access; however must not use the network.",
    },
    {
      name: "yet and changed helper subject",
      domain: "secrets",
      body: "This workflow requires credentials, yet the offline helper must not use credentials.",
    },
    {
      name: "local prohibition",
      domain: "network",
      body: "This workflow requires network access but must not use the network during local setup.",
    },
    {
      name: "specific upload target",
      domain: "upload",
      body: "This workflow requires external uploads, yet must not upload files to a public bucket.",
    },
    {
      name: "specific secret source",
      domain: "secrets",
      body: "This workflow requires credentials; however, must not access credentials from production.",
    },
    {
      name: "unsupported remainder",
      domain: "network",
      body: "This workflow requires network access but must not use the network except for approved domains.",
    },
    {
      name: "Markdown hard break",
      domain: "network",
      body: "This workflow requires network access but  \nmust not use the network.",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, domain).length, 0, name);
  }
});

test("workflow subjects do not cross Markdown structural boundaries", () => {
  for (const { name, body } of [
    {
      name: "paragraphs",
      body: "This workflow requires network access.\n\nMust not use the network.",
    },
    {
      name: "list items",
      body: "- This workflow requires network access\n- Must not use the network.",
    },
    {
      name: "blockquotes",
      body: "> This workflow requires network access.\n>\n> Must not use the network.",
    },
    {
      name: "heading",
      body: "## This workflow requires network access\n\nMust not use the network.",
    },
    {
      name: "code block",
      body: "This workflow requires network access.\n\n```\nMust not use the network.\n```",
    },
  ] as const) {
    assert.equal(bodyPolicyFindings(body, "network").length, 0, name);
  }
});

test("affirmative requirements never become not-required facts or findings", () => {
  for (const { domain, body } of [
    { domain: "network", body: "Network access is required." },
    { domain: "upload", body: "External uploads are required." },
    { domain: "secrets", body: "Secret access is required." },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assert.equal(facts[0]?.modality, "unknown", body);
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

test("candidate scope and safeguard facts ignore coordinated unrelated text", () => {
  for (const { body, domain, evidence, completeness } of [
    {
      body: "Run npm validation and this workflow must not use the network.",
      domain: "network",
      evidence: "this workflow must not use the network",
      completeness: "complete",
    },
    {
      body: "This workflow must not upload files and run npm validation.",
      domain: "upload",
      evidence: "This workflow must not upload files",
      completeness: "unsupported-remainder",
    },
    {
      body: "Use npx locally and credentials must not be used in this workflow.",
      domain: "secrets",
      evidence: "credentials must not be used in this workflow",
      completeness: "complete",
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assertFactEvidence(
      facts[0],
      body,
      evidence,
      {
        modality: "prohibited",
        scope: "workflow",
        completeness,
      },
      body,
    );
    assert.equal(
      bodyPolicyFindings(body, domain).length,
      completeness === "complete" ? 1 : 0,
      body,
    );
  }

  const localText =
    "Do not use network access during maintenance and run npm validation.";
  const localFact = statementGroupFacts(localText).find(
    (fact) => fact.domain === "network",
  );
  assertFactEvidence(
    localFact,
    localText,
    "Do not use network access during maintenance",
    {
      modality: "prohibited",
      scope: "unknown",
      completeness: "unsupported-remainder",
    },
    localText,
  );
  assert.equal(bodyPolicyFindings(localText, "network").length, 0, localText);
});

test("unrelated coordinated remainders do not become completeness boundaries", () => {
  for (const { body, domain } of [
    {
      body: "No network access and only approved domains may be contacted.",
      domain: "network",
    },
    {
      body: "No external uploads and only approved transfers may proceed.",
      domain: "upload",
    },
    {
      body: "No secret access and use the approved vault when needed.",
      domain: "secrets",
    },
  ] as const) {
    const facts = statementGroupFacts(body).filter(
      (fact) => fact.domain === domain,
    );
    assert.equal(facts.length, 1, body);
    assert.equal(facts[0]?.completeness, "unsupported-remainder", body);
    assert.equal(bodyPolicyFindings(body, domain).length, 0, body);
  }
});

function sameClauseDomainCases(
  domain: PolicyDomain,
  laterProhibition: string,
  wrappedLaterProhibition: string,
  prefixes: {
    readonly notRequired: string;
    readonly affirmativeRequirement: string;
    readonly localProhibition: string;
    readonly unsupportedProhibition: string;
    readonly unsupportedEvidence: string;
    readonly localSafeguard: string;
    readonly localSafeguardScope: "specific-source" | "specific-target";
  },
): readonly SameClauseRegressionCase[] {
  return [
    {
      name: `${domain} not-required then workflow prohibition`,
      domain,
      prefix: prefixes.notRequired,
      connector: " and ",
      laterProhibition,
      wrappedLaterProhibition,
      prefixEvidence: prefixes.notRequired,
      prefixModality: "not-required",
      prefixScope: "unknown",
      prefixCompleteness: "complete",
    },
    {
      name: `${domain} affirmative requirement then workflow prohibition`,
      domain,
      prefix: prefixes.affirmativeRequirement,
      connector: " and ",
      laterProhibition,
      wrappedLaterProhibition,
      prefixEvidence: prefixes.affirmativeRequirement,
      prefixModality: "unknown",
      prefixScope: "unknown",
      prefixCompleteness: "complete",
    },
    {
      name: `${domain} local prohibition then workflow prohibition`,
      domain,
      prefix: prefixes.localProhibition,
      connector: ", and ",
      laterProhibition,
      wrappedLaterProhibition,
      prefixEvidence: prefixes.localProhibition,
      prefixModality: "prohibited",
      prefixScope: "local-step",
      prefixCompleteness: "complete",
    },
    {
      name: `${domain} unsupported prohibition then workflow prohibition`,
      domain,
      prefix: prefixes.unsupportedProhibition,
      connector: " and ",
      laterProhibition,
      wrappedLaterProhibition,
      prefixEvidence: prefixes.unsupportedEvidence,
      prefixModality: "prohibited",
      prefixScope: "workflow",
      prefixCompleteness: "unsupported-remainder",
    },
    {
      name: `${domain} local safeguard then workflow prohibition`,
      domain,
      prefix: prefixes.localSafeguard,
      connector: ", and ",
      laterProhibition,
      wrappedLaterProhibition,
      prefixEvidence: prefixes.localSafeguard,
      prefixModality: "local-safeguard",
      prefixScope: prefixes.localSafeguardScope,
      prefixCompleteness: "complete",
    },
  ];
}

function sharedSubjectDomainCases(
  domain: PolicyDomain,
  laterPredicate: string,
  predicates: {
    readonly affirmativeRequirement: string;
    readonly negativeRequirement: string;
    readonly specificRestriction: string;
    readonly specificScope: "specific-source" | "specific-target";
    readonly specificModality: "prohibited" | "local-safeguard";
    readonly localSafeguard: string;
    readonly localSafeguardScope: "specific-source" | "specific-target";
  },
): readonly SharedSubjectRegressionCase[] {
  return [
    {
      name: `${domain} shared-subject affirmative requirement`,
      domain,
      firstPredicate: predicates.affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject negative requirement`,
      domain,
      firstPredicate: predicates.negativeRequirement,
      firstModality: "not-required",
      firstScope: "workflow",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject specific restriction`,
      domain,
      firstPredicate: predicates.specificRestriction,
      firstModality: predicates.specificModality,
      firstScope: predicates.specificScope,
      laterPredicate,
    },
    {
      name: `${domain} shared-subject local safeguard`,
      domain,
      firstPredicate: predicates.localSafeguard,
      firstModality: "local-safeguard",
      firstScope: predicates.localSafeguardScope,
      laterPredicate,
    },
  ];
}

function modifiedSharedSubjectDomainCases(
  domain: PolicyDomain,
  laterPredicate: string,
  affirmativeRequirement: string,
  negativeRequirement: string,
): readonly ModifiedSharedSubjectRegressionCase[] {
  return [
    {
      name: `${domain} shared-subject and also`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: " and also ",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject comma and also`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: ", and also ",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject and still`,
      domain,
      firstPredicate: negativeRequirement,
      firstModality: "not-required",
      firstScope: "workflow",
      connector: " and still ",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject comma only`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: ", ",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject and therefore`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: " and therefore ",
      laterPredicate,
    },
  ];
}

function contrastiveSharedSubjectDomainCases(
  domain: PolicyDomain,
  laterPredicate: string,
  affirmativeRequirement: string,
  negativeRequirement: string,
): readonly ContrastiveSharedSubjectRegressionCase[] {
  return [
    {
      name: `${domain} shared-subject but`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: " but ",
      laterSubject: "",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject comma but`,
      domain,
      firstPredicate: negativeRequirement,
      firstModality: "not-required",
      firstScope: "workflow",
      connector: ", but ",
      laterSubject: "",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject yet`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: " yet ",
      laterSubject: "",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject comma yet`,
      domain,
      firstPredicate: negativeRequirement,
      firstModality: "not-required",
      firstScope: "workflow",
      connector: ", yet ",
      laterSubject: "",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject however`,
      domain,
      firstPredicate: affirmativeRequirement,
      firstModality: "unknown",
      firstScope: "workflow",
      connector: " however, ",
      laterSubject: "",
      laterPredicate,
    },
    {
      name: `${domain} shared-subject semicolon however`,
      domain,
      firstPredicate: negativeRequirement,
      firstModality: "not-required",
      firstScope: "workflow",
      connector: "; however, ",
      laterSubject: "it ",
      laterPredicate,
    },
  ];
}

function contrastiveClauseFacts(
  text: string,
): readonly BodyPolicyClauseFacts[] {
  const ranges = statementClauseRanges(text);
  assert.ok(ranges.length >= 2, text);
  return bodyPolicyStatementGroupFacts(text, ranges);
}

function softWrapBeforeStatementConnector(text: string): string {
  return text.includes("; however,")
    ? text.replace("; however,", ";\nhowever,")
    : text.replace(/ (?=(?:but|yet)\b)/u, "\n");
}

function statementGroupFacts(text: string): readonly BodyPolicyClauseFacts[] {
  return bodyPolicyStatementGroupFacts(text, statementClauseRanges(text));
}

function statementClauseRanges(
  text: string,
): readonly { start: number; end: number }[] {
  const ranges = disclosureClauseRangesIntersectingRange(
    text,
    0,
    text.length,
  ).filter(({ start, end }) => text.slice(start, end).trim().length > 0);
  assert.ok(ranges.length > 0, text);
  return ranges;
}

function assertFactEvidence(
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

function bodyPolicyFindings(body: string, domain: PolicyDomain): Finding[] {
  const policy = {
    network: "renma.network-allowed: 'true'",
    upload: "renma.external-upload-allowed: 'true'",
    secrets: "renma.secrets-allowed: 'true'",
  }[domain];
  const path = "skills/security/SKILL.md";
  const content = canonicalSkillFixture(
    path,
    `---
metadata:
  renma.allowed-data: '["disclosed"]'
  ${policy}
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
