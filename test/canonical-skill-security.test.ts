import assert from "node:assert/strict";
import test from "node:test";

import { validateAgentSkill } from "../src/agent-skills.js";
import { parseDocument } from "../src/markdown.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import {
  applySecurityConfig,
  parseOperationalSecurityPolicy,
  resolveOperationalSecurityPolicy,
} from "../src/security-policy.js";
import type { Artifact, SecurityConfig } from "../src/types.js";

test("canonical Skill security metadata normalizes every policy field with exact evidence", () => {
  const document = skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.allowed-data: >-
    ["public",
    "repo-local files"]
  renma.network-allowed: "true"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "true"
  renma.forbidden-inputs: '["secrets","credentials"]'
  renma.approved-network-destinations: '["api.example.com"]'
  renma.approved-upload-destinations: '["uploads.example.com"]'
  renma.security-profile: " strict-local "
---
# Demo
`);

  const policy = parseOperationalSecurityPolicy(document);

  assert.deepEqual(policy.allowedData, ["public", "repo-local files"]);
  assert.equal(policy.networkAllowed, true);
  assert.equal(policy.externalUploadAllowed, false);
  assert.equal(policy.secretsAllowed, false);
  assert.equal(policy.humanApprovalRequired, true);
  assert.deepEqual(policy.forbiddenInputs, ["secrets", "credentials"]);
  assert.deepEqual(policy.approvedNetworkDestinations, ["api.example.com"]);
  assert.deepEqual(policy.approvedUploadDestinations, ["uploads.example.com"]);
  assert.equal(policy.securityProfile, "strict-local");
  assert.deepEqual(policy.evidenceByField.get("allowedData"), {
    startLine: 5,
    endLine: 7,
    snippet:
      '  renma.allowed-data: >-\n    ["public",\n    "repo-local files"]',
  });
  assert.deepEqual(policy.evidenceByField.get("networkAllowed"), {
    startLine: 8,
    endLine: 8,
    snippet: '  renma.network-allowed: "true"',
  });
});

test("canonical Skill security values use exact string encodings without coercion", () => {
  const policy = parseOperationalSecurityPolicy(
    skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.network-allowed: yes
  renma.external-upload-allowed: "1"
  renma.secrets-allowed: "TRUE"
  renma.requires-human-approval: ""
  renma.allowed-data: public,internal
  renma.forbidden-inputs: '["secrets",1]'
  renma.approved-network-destinations: '[unterminated'
  renma.approved-upload-destinations: '{}'
  renma.security-profile: "   "
---
# Demo
`),
  );

  assert.equal(policy.networkAllowed, undefined);
  assert.equal(policy.externalUploadAllowed, undefined);
  assert.equal(policy.secretsAllowed, undefined);
  assert.equal(policy.humanApprovalRequired, undefined);
  assert.deepEqual(policy.allowedData, []);
  assert.deepEqual(policy.forbiddenInputs, []);
  assert.deepEqual(policy.approvedNetworkDestinations, []);
  assert.deepEqual(policy.approvedUploadDestinations, []);
  assert.equal(policy.securityProfile, undefined);
  assert.equal(policy.declared.size, 0);
  assert.deepEqual([...policy.invalidDeclared].sort(), [
    "allowedData",
    "approvedNetworkDestinations",
    "approvedUploadDestinations",
    "externalUploadAllowed",
    "forbiddenInputs",
    "humanApprovalRequired",
    "networkAllowed",
    "secretsAllowed",
    "securityProfile",
  ]);
});

test("canonical Skill security treats empty JSON lists as explicit and rejects empty scalars", () => {
  const policy = parseOperationalSecurityPolicy(
    skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.allowed-data: '[]'
  renma.network-allowed: ""
  renma.security-profile: ""
---
# Demo
`),
  );

  assert.deepEqual(policy.allowedData, []);
  assert.equal(policy.networkAllowed, undefined);
  assert.equal(policy.securityProfile, undefined);
  assert.deepEqual([...policy.declared], ["allowedData"]);
  assert.deepEqual([...policy.invalidDeclared].sort(), [
    "networkAllowed",
    "securityProfile",
  ]);
});

test("invalid canonical booleans block permissive profile inheritance", () => {
  const fields = [
    ["renma.network-allowed", "networkAllowed"],
    ["renma.external-upload-allowed", "externalUploadAllowed"],
    ["renma.secrets-allowed", "secretsAllowed"],
    ["renma.requires-human-approval", "humanApprovalRequired"],
  ] as const;

  for (const [key, operationalField] of fields) {
    const resolution = resolveOperationalSecurityPolicy(
      skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.security-profile: permissive
  ${key}: "flase"
---
# Demo
`),
    );
    const parsed = resolution.policy;
    const resolved = applySecurityConfig(parsed, permissiveSecurityConfig());

    assert.equal(resolution.issues.length, 1, key);
    assert.equal(resolution.issues[0]?.key, key);
    assert.equal(parsed[operationalField], undefined, key);
    assert.ok(parsed.invalidDeclared.has(operationalField), key);
    assert.equal(resolved[operationalField], undefined, key);
  }
});

test("invalid canonical lists block profile and repository accumulation", () => {
  const document = skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.security-profile: permissive
  renma.allowed-data: public,internal
  renma.forbidden-inputs: '{}'
  renma.approved-network-destinations: '["api.example.com",1]'
  renma.approved-upload-destinations: '[unterminated'
---
# Demo
`);
  const resolution = resolveOperationalSecurityPolicy(document);
  const parsed = resolution.policy;
  const resolved = applySecurityConfig(parsed, permissiveSecurityConfig());

  assert.equal(resolution.issues.length, 4);
  assert.deepEqual(resolved.allowedData, []);
  assert.deepEqual(resolved.forbiddenInputs, []);
  assert.deepEqual(resolved.approvedNetworkDestinations, []);
  assert.deepEqual(resolved.approvedUploadDestinations, []);
  assert.deepEqual([...parsed.invalidDeclared].sort(), [
    "allowedData",
    "approvedNetworkDestinations",
    "approvedUploadDestinations",
    "forbiddenInputs",
  ]);
});

test("canonical security semantic issues preserve exact multiline and empty-profile evidence", () => {
  const resolution = resolveOperationalSecurityPolicy(
    skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.allowed-data: >-
    public,
    internal
  renma.security-profile: ""
---
# Demo
`),
  );

  assert.deepEqual(resolution.issues, [
    {
      key: "renma.allowed-data",
      operationalField: "allowedData",
      reason:
        'expected a JSON-array string containing strings only; rejected "public, internal"',
      startLine: 5,
      endLine: 7,
      snippet: "  renma.allowed-data: >-\n    public,\n    internal",
    },
    {
      key: "renma.security-profile",
      operationalField: "securityProfile",
      reason: 'expected a trimmed non-empty string; rejected ""',
      startLine: 8,
      endLine: 8,
      snippet: '  renma.security-profile: ""',
    },
  ]);
});

test("invalid canonical security findings include rejected encoding and exact evidence", () => {
  const artifact = skillArtifact(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.network-allowed: "flase"
  renma.allowed-data: >-
    public,
    internal
  renma.security-profile: ""
---
# Demo
`);
  const findings = securityDiagnosticFindings([artifact]);
  const invalid = findings.filter(
    (finding) => finding.id === "SEC-INVALID-CANONICAL-POLICY-METADATA",
  );

  assert.equal(invalid.length, 3);
  assert.match(
    invalid[0]?.title ?? "",
    /Invalid metadata\.renma\.network-allowed: expected the exact string "true" or "false"; rejected "flase"/,
  );
  assert.deepEqual(invalid[0]?.evidence, {
    path: "skills/demo/SKILL.md",
    startLine: 5,
    endLine: 5,
    snippet: 'renma.network-allowed: "flase"',
  });
  assert.deepEqual(invalid[1]?.evidence, {
    path: "skills/demo/SKILL.md",
    startLine: 6,
    endLine: 8,
    snippet: "renma.allowed-data: >-\n    public,\n    internal",
  });
  assert.deepEqual(invalid[2]?.evidence, {
    path: "skills/demo/SKILL.md",
    startLine: 9,
    endLine: 9,
    snippet: 'renma.security-profile: ""',
  });
  assert.equal(
    findings.some((finding) => finding.id === "SEC-MISSING-POLICY-METADATA"),
    false,
  );
});

test("security profile resolution findings use canonical child evidence", () => {
  const findings = securityDiagnosticFindings(
    [
      skillArtifact(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.allowed-data: '["public"]'
  renma.security-profile: missing-profile
---
# Demo
`),
    ],
    { security: permissiveSecurityConfig() },
  );
  const finding = findings.find(
    (candidate) => candidate.id === "SEC-POLICY-PROFILE-NOT-FOUND",
  );

  assert.deepEqual(finding?.evidence, {
    path: "skills/demo/SKILL.md",
    startLine: 6,
    endLine: 6,
    snippet: "renma.security-profile: missing-profile",
  });
});

test("canonical security policy examples are recognized in body text and YAML fences", () => {
  const findings = securityDiagnosticFindings([
    skillArtifact(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
---
# Demo

metadata:
  renma.network-allowed: "false"
  renma.allowed-data: '["public"]'

\`\`\`yaml
metadata:
  renma.network-allowed: "false"
  renma.allowed-data: '["public"]'
\`\`\`
`),
  ]);

  assert.equal(
    findings.some(
      (finding) =>
        finding.id === "SEC-INSTRUCTION-VIOLATES-POLICY" ||
        finding.id === "SEC-UNAPPROVED-NETWORK-DESTINATION" ||
        finding.id === "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
    ),
    false,
  );
});

test("native YAML security values invalidate the whole Skill operational source", () => {
  for (const line of [
    "  renma.network-allowed: true",
    "  renma.allowed-data: [public, internal]",
  ]) {
    const document = skillDocument(`---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.secrets-allowed: "false"
${line}
---
# Demo
`);
    const validation = validateAgentSkill(document);
    const resolution = resolveOperationalSecurityPolicy(document);
    const policy = resolution.policy;

    assert.equal(validation.valid, false, line);
    assert.equal(resolution.issues.length, 1, line);
    assert.equal(policy.secretsAllowed, undefined, line);
    assert.equal(policy.declared.size, 0, line);
  }
});

test("duplicate canonical security input never selects a policy winner", () => {
  for (const content of [
    `---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.network-allowed: "true"
  renma.network-allowed: "false"
---
# Demo
`,
    `---
name: demo
description: Review demo security inputs. Use when policy boundaries need deterministic review.
metadata:
  renma.network-allowed: "true"
metadata:
  renma.network-allowed: "false"
---
# Demo
`,
  ]) {
    const document = skillDocument(content);
    assert.equal(validateAgentSkill(document).valid, false);
    assert.equal(
      parseOperationalSecurityPolicy(document).networkAllowed,
      undefined,
    );
  }
});

test("pre-0.16 Skill security remains migration input but is not operational", () => {
  const document = skillDocument(`---
id: skill.demo
allowed_data: public
network_allowed: false
security_profile: strict-local
---
# Demo
`);
  const validation = validateAgentSkill(document);
  const policy = parseOperationalSecurityPolicy(document);

  assert.equal(validation.format, "renma-legacy");
  assert.equal(validation.migrationRecommended, true);
  assert.deepEqual(policy.allowedData, []);
  assert.equal(policy.networkAllowed, undefined);
  assert.equal(policy.securityProfile, undefined);
});

test("authoring warnings do not disable canonical Skill security metadata", () => {
  const document = skillDocument(`---
name: demo
description: Review demo inputs carefully.
metadata:
  renma.allowed-data: '["public"]'
  renma.network-allowed: "false"
---
# Demo
`);
  const validation = validateAgentSkill(document);
  const policy = parseOperationalSecurityPolicy(document);

  assert.equal(validation.valid, true);
  assert.ok(validation.warningCount > 0);
  assert.deepEqual(policy.allowedData, ["public"]);
  assert.equal(policy.networkAllowed, false);
});

function skillDocument(content: string) {
  return parseDocument(skillArtifact(content));
}

function skillArtifact(content: string): Artifact {
  return {
    path: "skills/demo/SKILL.md",
    absolutePath: "/repo/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    content,
  };
}

function permissiveSecurityConfig(): SecurityConfig {
  return {
    approvedDomains: ["repo.example.com"],
    approvedUploadDomains: ["uploads.example.com"],
    disallowedCommands: [],
    profiles: {
      permissive: {
        allowedDataClass: "public",
        networkAllowed: true,
        externalUploadAllowed: true,
        secretsAllowed: true,
        humanApprovalRequired: true,
        allowedData: ["profile-data"],
        forbiddenInputs: ["profile-forbidden"],
        approvedDomains: ["profile.example.com"],
        approvedUploadDomains: ["profile-uploads.example.com"],
        disallowedCommands: [],
      },
    },
  };
}
