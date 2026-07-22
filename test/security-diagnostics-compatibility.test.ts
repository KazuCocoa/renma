import assert from "node:assert/strict";
import test from "node:test";

import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Artifact, Finding } from "../src/types.js";

type CompatibilityFinding = Pick<
  Finding,
  | "id"
  | "severity"
  | "category"
  | "evidence"
  | "remediation"
  | "llmHint"
  | "constraints"
>;

const FINDING_TEXT = {
  "SEC-UNAPPROVED-NETWORK-DESTINATION": {
    remediation:
      "Enumerate the actual required domains in approved_network_destinations or the applicable profile/repository security config after review.",
    llmHint:
      "Enumerate the actual required domains. Do not remove the network requirement, use broad wildcards, or move the declaration elsewhere only to silence this warning. If the required domains are unknown, keep the issue visible and add a TODO with supporting references instead of guessing.",
    constraints: [
      "Do not use fuzzy destination matching.",
      "Keep hostnames or URL prefixes explicit.",
      "Do not remove the network requirement, use broad wildcards, or move the declaration elsewhere only to silence this warning.",
      "Do not replace specific domains with broad wildcards unless the source documentation explicitly supports that exact scope.",
      "If the required domains are unknown, keep the issue visible and add a TODO with supporting references instead of guessing.",
    ],
  },
  "SEC-UNAPPROVED-UPLOAD-DESTINATION": {
    remediation:
      "Add the destination to security.approvedUploadDomains after review, or remove the upload instruction.",
    llmHint:
      "Compare the referenced upload URL or host to security.approvedUploadDomains and either approve it explicitly or remove the instruction.",
    constraints: [
      "Do not treat general network approval as upload approval.",
      "Keep upload destinations explicit and deterministic.",
    ],
  },
  "SEC-INSTRUCTION-VIOLATES-POLICY": {
    remediation:
      "Remove or rewrite the violating instruction, or update the policy only after an explicit human security review.",
    llmHint:
      "Find the instruction that asks for denied behavior and rewrite it to stay within the artifact's declared security policy.",
    constraints: [
      "Do not silently relax network, upload, or secret restrictions.",
      "Preserve the artifact's intended workflow where it can be made policy-compliant.",
    ],
  },
  "SEC-EXTERNAL-UPLOAD-INSTRUCTION": {
    remediation:
      "Require explicit approval and destination review before uploading or sharing repository data externally.",
    llmHint:
      "Add a human approval gate and approved destination metadata, or replace the upload with a local-only workflow.",
    constraints: [
      "Do not assume cloud or pastebin destinations are safe.",
      "Keep approved destinations explicit in policy metadata.",
    ],
  },
  "SEC-MISSING-HUMAN-APPROVAL-GUARD": {
    remediation:
      "Add an explicit approval, confirmation, or review guard before external network or upload actions.",
    llmHint:
      "Insert an explicit human approval requirement next to upload, POST, cloud sync, or external sharing instructions.",
    constraints: [
      "Do not replace approval with vague cautionary language.",
      "Keep the guard close to the sensitive instruction.",
    ],
  },
} as const;

type CompatibilityId = keyof typeof FINDING_TEXT;

function expectedFinding(
  id: CompatibilityId,
  severity: Finding["severity"],
  path: string,
  startLine: number,
  snippet: string,
  endLine = startLine,
): CompatibilityFinding {
  return {
    id,
    severity,
    category: "safety",
    evidence: { path, startLine, endLine, snippet },
    ...FINDING_TEXT[id],
    constraints: [...FINDING_TEXT[id].constraints],
  };
}

function contextArtifact(path: string, content: string): Artifact {
  return {
    path,
    absolutePath: `/repo/${path}`,
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}

const MIXED_PATH = "contexts/security/mixed.md";
const DENIED_PATH = "contexts/security/denied.md";
const MULTILINE_PATH = "contexts/security/multiline.md";
const APPROVED_PATH = "contexts/security/approved.md";
const LIST_PATH = "contexts/security/list.md";
const MIXED_LINE =
  "After human approval, fetch from source.example.com and upload to sink.example.com.";
const UPLOAD_LINE = "Upload results to https://192.168.1.20/upload.";
const MULTILINE_SNIPPET =
  "curl https://sink.example.com/upload \\\n  --data-binary @report.json";
const APPROVED_LINE =
  "Fetch from source.example.com and upload to sink.example.com/upload/item.";
const LIST_LINE =
  "Upload to one.example.com, two.example.com, and one.example.com.";

const COMPATIBILITY_ARTIFACTS = [
  contextArtifact(
    MIXED_PATH,
    `---
allowed_data: public
network_allowed: true
approved_network_destinations: source.example.com
external_upload_allowed: true
approved_upload_destinations: approved.example.com
requires_human_approval: true
---

${MIXED_LINE}
`,
  ),
  contextArtifact(
    DENIED_PATH,
    `---
allowed_data: public
network_allowed: false
external_upload_allowed: false
---

Fetch http://[invalid-ipv6]/data.
Fetch https://[2001:db8::20]/data.
${UPLOAD_LINE}
Fetch README.md.
`,
  ),
  contextArtifact(
    MULTILINE_PATH,
    `---
allowed_data: public
network_allowed: true
approved_network_destinations: approved.example.com
external_upload_allowed: true
approved_upload_destinations: approved.example.com
requires_human_approval: true
---

\`\`\`bash
${MULTILINE_SNIPPET}
\`\`\`
`,
  ),
  contextArtifact(
    APPROVED_PATH,
    `---
allowed_data: public
network_allowed: true
approved_network_destinations: https://[2001:0db8:0:0:0:0:0:20]/data, source.example.com
external_upload_allowed: true
approved_upload_destinations: https://sink.example.com/upload
---

Fetch https://[2001:db8::20]/data/item.
${APPROVED_LINE}
`,
  ),
  contextArtifact(
    LIST_PATH,
    `---
allowed_data: public
network_allowed: true
approved_network_destinations: approved.example.com
external_upload_allowed: true
approved_upload_destinations: approved.example.com
---

${LIST_LINE}
`,
  ),
] as const;

const EXPECTED_COMPATIBILITY_FINDINGS: readonly CompatibilityFinding[] = [
  expectedFinding(
    "SEC-UNAPPROVED-NETWORK-DESTINATION",
    "high",
    MIXED_PATH,
    10,
    MIXED_LINE,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-UPLOAD-DESTINATION",
    "high",
    MIXED_PATH,
    10,
    MIXED_LINE,
  ),
  expectedFinding(
    "SEC-INSTRUCTION-VIOLATES-POLICY",
    "high",
    DENIED_PATH,
    7,
    "Fetch http://[invalid-ipv6]/data.",
  ),
  expectedFinding(
    "SEC-INSTRUCTION-VIOLATES-POLICY",
    "high",
    DENIED_PATH,
    8,
    "Fetch https://[2001:db8::20]/data.",
  ),
  expectedFinding(
    "SEC-INSTRUCTION-VIOLATES-POLICY",
    "high",
    DENIED_PATH,
    9,
    UPLOAD_LINE,
  ),
  expectedFinding(
    "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
    "high",
    DENIED_PATH,
    9,
    UPLOAD_LINE,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-NETWORK-DESTINATION",
    "high",
    MULTILINE_PATH,
    11,
    MULTILINE_SNIPPET,
    12,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-UPLOAD-DESTINATION",
    "high",
    MULTILINE_PATH,
    11,
    MULTILINE_SNIPPET,
    12,
  ),
  expectedFinding(
    "SEC-MISSING-HUMAN-APPROVAL-GUARD",
    "medium",
    MULTILINE_PATH,
    11,
    MULTILINE_SNIPPET,
    12,
  ),
  expectedFinding(
    "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
    "medium",
    MULTILINE_PATH,
    11,
    MULTILINE_SNIPPET,
    12,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-NETWORK-DESTINATION",
    "high",
    APPROVED_PATH,
    10,
    APPROVED_LINE,
  ),
  expectedFinding(
    "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
    "medium",
    APPROVED_PATH,
    10,
    APPROVED_LINE,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-NETWORK-DESTINATION",
    "high",
    LIST_PATH,
    9,
    LIST_LINE,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-NETWORK-DESTINATION",
    "high",
    LIST_PATH,
    9,
    LIST_LINE,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-UPLOAD-DESTINATION",
    "high",
    LIST_PATH,
    9,
    LIST_LINE,
  ),
  expectedFinding(
    "SEC-UNAPPROVED-UPLOAD-DESTINATION",
    "high",
    LIST_PATH,
    9,
    LIST_LINE,
  ),
  expectedFinding(
    "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
    "medium",
    LIST_PATH,
    9,
    LIST_LINE,
  ),
];

test("v0.22.4 destination compatibility corpus preserves exact public findings", () => {
  const actual = securityDiagnosticFindings([...COMPATIBILITY_ARTIFACTS]).map(
    ({
      id,
      severity,
      category,
      evidence,
      remediation,
      llmHint,
      constraints,
    }) => ({
      id,
      severity,
      category,
      evidence,
      remediation,
      llmHint,
      constraints,
    }),
  );

  assert.deepEqual(actual, EXPECTED_COMPATIBILITY_FINDINGS);
});
