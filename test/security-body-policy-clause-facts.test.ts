import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyPolicyClauseFacts,
  type BodyPolicyClauseFacts,
  type BodyPolicyModality,
  type BodyPolicyScope,
} from "../src/security-body-policy/clause-facts.js";
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

test("body-policy characterization matrix preserves the 0.24.4 decision boundary", () => {
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
    const fact = bodyPolicyClauseFacts(fixture.body).find(
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
    bodyPolicyClauseFacts("Do not upload secrets to third-party services.").map(
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
