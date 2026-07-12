import assert from "node:assert/strict";
import test from "node:test";

import { validateAgentSkill } from "../src/agent-skills.js";
import { parseDocument } from "../src/markdown.js";
import { parseOperationalSecurityPolicy } from "../src/security-policy.js";
import type { Artifact } from "../src/types.js";

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
    const policy = parseOperationalSecurityPolicy(document);

    assert.equal(validation.valid, false, line);
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
  return parseDocument({
    path: "skills/demo/SKILL.md",
    absolutePath: "/repo/skills/demo/SKILL.md",
    kind: "skill",
    sizeBytes: Buffer.byteLength(content),
    content,
  } satisfies Artifact);
}
