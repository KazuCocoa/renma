import assert from "node:assert/strict";
import test from "node:test";

import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Artifact, SecurityConfig } from "../src/types.js";
import { canonicalSkillFixture } from "./canonical-skill-fixture.js";

const baseSecurityConfig: SecurityConfig = {
  approvedDomains: [],
  approvedUploadDomains: [],
  disallowedCommands: [],
  profiles: {},
};

test("security diagnostics resolve configured security profiles", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: appium-disclosed-local
---

Fetch https://github.com/appium/appium and upload sanitized diagnostics only.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          "appium-disclosed-local": {
            allowedDataClass: "disclosed",
            networkAllowed: true,
            externalUploadAllowed: false,
            secretsAllowed: false,
            humanApprovalRequired: true,
            allowedData: ["sanitized diagnostics"],
            forbiddenInputs: ["secrets", "credentials"],
            approvedDomains: ["github.com"],
            approvedUploadDomains: [],
            disallowedCommands: ["gh gist create"],
          },
        },
      },
    },
  );

  assert.equal(
    findings.some((finding) => finding.id === "SEC-POLICY-PROFILE-NOT-FOUND"),
    false,
  );
  assert.equal(
    findings.some(
      (finding) =>
        finding.id === "SEC-UNAPPROVED-NETWORK-DESTINATION" &&
        finding.evidence.snippet.includes("github.com"),
    ),
    false,
  );
});

test("security diagnostics report missing security profiles", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: missing-profile
---

Fetch https://github.com/appium/appium.`),
    ],
    { security: baseSecurityConfig },
  );

  assert.ok(
    findings.some((finding) => finding.id === "SEC-POLICY-PROFILE-NOT-FOUND"),
  );
});

test("security diagnostics keep artifact-local denials stricter than profiles", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: appium-disclosed-local
network_allowed: false
---

Fetch https://github.com/appium/appium.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          "appium-disclosed-local": {
            allowedDataClass: "disclosed",
            networkAllowed: true,
            externalUploadAllowed: false,
            secretsAllowed: false,
            humanApprovalRequired: true,
            allowedData: [],
            forbiddenInputs: [],
            approvedDomains: ["github.com"],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    },
  );

  assert.ok(
    findings.some(
      (finding) => finding.id === "SEC-POLICY-OVERRIDE-CONTRADICTION",
    ),
  );
  assert.ok(
    findings.some(
      (finding) => finding.id === "SEC-INSTRUCTION-VIOLATES-POLICY",
    ),
  );
});

test("security diagnostics report profile-forbidden input instructions", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: appium-disclosed-local
---

Collect credentials from the local environment before uploading diagnostics.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          "appium-disclosed-local": {
            allowedDataClass: "disclosed",
            networkAllowed: true,
            externalUploadAllowed: false,
            secretsAllowed: false,
            humanApprovalRequired: true,
            allowedData: [],
            forbiddenInputs: ["credentials"],
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    },
  );

  assert.ok(
    findings.some(
      (finding) => finding.id === "SEC-FORBIDDEN-INPUT-INSTRUCTION",
    ),
  );
});

test("security diagnostics report security profile cycles", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: a
---

Fetch https://github.com/appium/appium.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          a: {
            securityProfile: "b",
            allowedData: [],
            forbiddenInputs: [],
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
          b: {
            securityProfile: "a",
            allowedData: [],
            forbiddenInputs: [],
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    },
  );

  assert.ok(
    findings.some((finding) => finding.id === "SEC-POLICY-PROFILE-CYCLE"),
  );
});

test("security diagnostics report artifact upload override that weakens profile policy", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: strict-local
external_upload_allowed: true
---

Upload sanitized diagnostics to https://github.com/example/repo.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          "strict-local": {
            externalUploadAllowed: false,
            allowedData: [],
            forbiddenInputs: [],
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    },
  );

  assert.ok(
    findings.some(
      (finding) => finding.id === "SEC-POLICY-OVERRIDE-CONTRADICTION",
    ),
  );
});

test("security diagnostics report artifact secrets override that weakens profile policy", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: strict-local
secrets_allowed: true
---

Use credentials from the local environment.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          "strict-local": {
            secretsAllowed: false,
            allowedData: [],
            forbiddenInputs: [],
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    },
  );

  assert.ok(
    findings.some(
      (finding) => finding.id === "SEC-POLICY-OVERRIDE-CONTRADICTION",
    ),
  );
});

test("security diagnostics do not report forbidden inputs for safe negative wording", () => {
  const findings = securityDiagnosticFindings(
    [
      artifact(`---
security_profile: strict-local
---

Do not include credentials.
Never upload .env files.
Redact private keys before sharing diagnostics.
Exclude secrets from the report.`),
    ],
    {
      security: {
        ...baseSecurityConfig,
        profiles: {
          "strict-local": {
            allowedData: [],
            forbiddenInputs: [
              "credentials",
              ".env files",
              "private keys",
              "secrets",
            ],
            approvedDomains: [],
            approvedUploadDomains: [],
            disallowedCommands: [],
          },
        },
      },
    },
  );

  assert.equal(
    findings.some(
      (finding) =>
        finding.id === "SEC-FORBIDDEN-INPUT-INSTRUCTION" &&
        finding.severity === "high",
    ),
    false,
  );
});

function artifact(content: string): Artifact {
  const artifactPath = "skills/appium/SKILL.md";
  const operationalContent = canonicalSkillFixture(artifactPath, content);
  return {
    path: artifactPath,
    absolutePath: "/repo/skills/appium/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(operationalContent),
    contentClassification: "text",
    markdownParserEligible: true,
    content: operationalContent,
  };
}
