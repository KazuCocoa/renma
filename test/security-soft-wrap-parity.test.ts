import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSecurityCommand } from "../src/security-command/analyze.js";
import { securityDiagnosticFindings } from "../src/security-diagnostics.js";
import type { Artifact, Finding } from "../src/types.js";

const NETWORK_IDS = new Set([
  "SEC-INSTRUCTION-VIOLATES-POLICY",
  "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
  "SEC-UNAPPROVED-NETWORK-DESTINATION",
  "SEC-UNAPPROVED-UPLOAD-DESTINATION",
  "SEC-CLOUD-UPLOAD-INSTRUCTION",
  "SEC-MISSING-HUMAN-APPROVAL-GUARD",
  "SEC-BODY-POLICY-CONTRADICTION",
]);
const APPROVAL_IDS = new Set(["SEC-MISSING-HUMAN-APPROVAL-GUARD"]);
const FORBIDDEN_INPUT_IDS = new Set(["SEC-FORBIDDEN-INPUT-INSTRUCTION"]);
const BODY_POLICY_IDS = new Set(["SEC-BODY-POLICY-CONTRADICTION"]);
const CONTEXT_SCOPE_IDS = new Set([
  "SEC-OVERBROAD-CONTEXT-INSTRUCTION",
  "SEC-BULK-DATA-SHARING-INSTRUCTION",
  "SEC-NO-REDACTION-INSTRUCTION",
  "SEC-EXTERNAL-UPLOAD-INSTRUCTION",
  "SEC-INSTRUCTION-VIOLATES-POLICY",
]);

type FindingProjection = {
  id: string;
  severity: Finding["severity"];
  evidence: {
    startLine: number;
    endLine: number;
    snippet: string;
  };
};

const DENIED_NETWORK_POLICY = `network_allowed: false
external_upload_allowed: false
requires_human_approval: true`;
const ALLOWLIST_NETWORK_POLICY = `network_allowed: true
external_upload_allowed: true
approved_network_destinations: approved.example.com
approved_upload_destinations: approved.example.com
requires_human_approval: true`;
const FORBIDDEN_INPUT_POLICY = "security_profile: restricted";
const FORBIDDEN_INPUT_CONFIG: Parameters<typeof securityDiagnosticFindings>[1] =
  {
    security: {
      approvedDomains: [],
      approvedUploadDomains: [],
      disallowedCommands: [],
      profiles: {
        restricted: {
          allowedData: [],
          forbiddenInputs: ["customer data"],
          approvedDomains: [],
          approvedUploadDomains: [],
          disallowedCommands: [],
        },
      },
    },
  };

test("defensive network and upload prose keeps one-line policy meaning across soft wraps", () => {
  const fixtures = [
    "Never upload the report to https://example.com.",
    `Never
upload the report to https://example.com.`,
    `Never upload the report to
https://example.com.`,
  ];

  for (const policy of [DENIED_NETWORK_POLICY, ALLOWLIST_NETWORK_POLICY]) {
    const oracle = project(fixtures[0] ?? "", policy, NETWORK_IDS);
    for (const fixture of fixtures) {
      assert.deepEqual(
        identityProjection(project(fixture, policy, NETWORK_IDS)),
        identityProjection(oracle),
        fixture,
      );
    }
  }

  assert.deepEqual(
    project(fixtures[0] ?? "", DENIED_NETWORK_POLICY, NETWORK_IDS),
    [],
  );
  assert.deepEqual(
    project(fixtures[1] ?? "", DENIED_NETWORK_POLICY, NETWORK_IDS),
    [],
  );
  assert.deepEqual(
    project(fixtures[2] ?? "", DENIED_NETWORK_POLICY, NETWORK_IDS),
    [],
  );

  assert.deepEqual(
    project(fixtures[0] ?? "", ALLOWLIST_NETWORK_POLICY, NETWORK_IDS),
    [
      finding(
        "SEC-BODY-POLICY-CONTRADICTION",
        "high",
        10,
        10,
        fixtures[0] ?? "",
      ),
      finding(
        "SEC-BODY-POLICY-CONTRADICTION",
        "high",
        10,
        10,
        fixtures[0] ?? "",
      ),
      finding(
        "SEC-UNAPPROVED-NETWORK-DESTINATION",
        "high",
        10,
        10,
        fixtures[0] ?? "",
      ),
      finding(
        "SEC-UNAPPROVED-UPLOAD-DESTINATION",
        "high",
        10,
        10,
        fixtures[0] ?? "",
      ),
    ],
  );
  assert.deepEqual(
    project(fixtures[1] ?? "", ALLOWLIST_NETWORK_POLICY, NETWORK_IDS),
    [
      finding(
        "SEC-BODY-POLICY-CONTRADICTION",
        "high",
        10,
        11,
        fixtures[1] ?? "",
      ),
      finding(
        "SEC-BODY-POLICY-CONTRADICTION",
        "high",
        10,
        11,
        fixtures[1] ?? "",
      ),
      finding(
        "SEC-UNAPPROVED-NETWORK-DESTINATION",
        "high",
        11,
        11,
        "upload the report to https://example.com.",
      ),
      finding(
        "SEC-UNAPPROVED-UPLOAD-DESTINATION",
        "high",
        11,
        11,
        "upload the report to https://example.com.",
      ),
    ],
  );
  assert.deepEqual(
    project(fixtures[2] ?? "", ALLOWLIST_NETWORK_POLICY, NETWORK_IDS),
    [
      finding(
        "SEC-BODY-POLICY-CONTRADICTION",
        "high",
        10,
        11,
        fixtures[2] ?? "",
      ),
      finding(
        "SEC-BODY-POLICY-CONTRADICTION",
        "high",
        10,
        10,
        "Never upload the report to",
      ),
      finding(
        "SEC-UNAPPROVED-NETWORK-DESTINATION",
        "high",
        11,
        11,
        "https://example.com.",
      ),
      finding(
        "SEC-UNAPPROVED-UPLOAD-DESTINATION",
        "high",
        11,
        11,
        "https://example.com.",
      ),
    ],
  );
});

test("positive network and upload clauses retain one-line results when the destination wraps", () => {
  const fixtures = [
    "Upload the report to https://example.com.",
    `Upload the report to
https://example.com.`,
    `Never upload the local copy. Then
upload the report to https://example.com.`,
  ];
  const expectedIdentities: Array<{
    id: string;
    severity: Finding["severity"];
  }> = [
    { id: "SEC-INSTRUCTION-VIOLATES-POLICY", severity: "high" },
    { id: "SEC-MISSING-HUMAN-APPROVAL-GUARD", severity: "medium" },
    { id: "SEC-EXTERNAL-UPLOAD-INSTRUCTION", severity: "high" },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(
      identityProjection(project(fixture, DENIED_NETWORK_POLICY, NETWORK_IDS)),
      expectedIdentities,
      fixture,
    );
  }
  assert.deepEqual(
    project(fixtures[1] ?? "", DENIED_NETWORK_POLICY, NETWORK_IDS),
    expectedIdentities.map(({ id, severity }) =>
      finding(id, severity, 9, 9, "https://example.com."),
    ),
  );
  assert.deepEqual(
    project(fixtures[2] ?? "", DENIED_NETWORK_POLICY, NETWORK_IDS),
    expectedIdentities.map(({ id, severity }) =>
      finding(id, severity, 9, 9, "upload the report to https://example.com."),
    ),
  );
});

test("approval requirements associate a wrapped disclosure action with its sensitive target", () => {
  const fixtures = [
    {
      oneLine: "Upload the password.",
      wrapped: `Upload the
password.`,
    },
    {
      oneLine: "Upload the password.",
      wrapped: `Upload
the password.`,
    },
    {
      oneLine: "Upload the private key.",
      wrapped: `Upload the
private key.`,
    },
    {
      oneLine: "Share the credentials.",
      wrapped: `Share
the credentials.`,
    },
  ];

  for (const fixture of fixtures) {
    const oracle = project(
      fixture.oneLine,
      "requires_human_approval: true",
      APPROVAL_IDS,
    );
    const wrapped = project(
      fixture.wrapped,
      "requires_human_approval: true",
      APPROVAL_IDS,
    );
    assert.deepEqual(identityProjection(oracle), [
      { id: "SEC-MISSING-HUMAN-APPROVAL-GUARD", severity: "medium" },
    ]);
    assert.deepEqual(identityProjection(wrapped), identityProjection(oracle));
    assert.deepEqual(wrapped, [
      finding(
        "SEC-MISSING-HUMAN-APPROVAL-GUARD",
        "medium",
        7,
        7,
        fixture.wrapped.split("\n")[1] ?? "",
      ),
    ]);
  }

  for (const fixture of [
    "Never upload the password.",
    `Never upload the
password.`,
    "After explicit human approval, upload the password.",
    `After explicit human approval, upload the
password.`,
  ]) {
    assert.deepEqual(
      project(fixture, "requires_human_approval: true", APPROVAL_IDS),
      [],
      fixture,
    );
  }
});

test("configured forbidden inputs keep literal phrase matching across soft wraps", () => {
  const fixtures = [
    {
      body: "Upload the customer data.",
      expected: [
        finding(
          "SEC-FORBIDDEN-INPUT-INSTRUCTION",
          "high",
          6,
          6,
          "Upload the customer data.",
        ),
      ],
    },
    {
      body: `Upload the
customer data.`,
      expected: [
        finding(
          "SEC-FORBIDDEN-INPUT-INSTRUCTION",
          "high",
          7,
          7,
          "customer data.",
        ),
      ],
    },
    {
      body: `Upload the customer
data.`,
      expected: [
        finding(
          "SEC-FORBIDDEN-INPUT-INSTRUCTION",
          "high",
          6,
          7,
          `Upload the customer
data.`,
        ),
      ],
    },
  ];
  const oracleIdentity = identityProjection(
    project(
      fixtures[0]?.body ?? "",
      FORBIDDEN_INPUT_POLICY,
      FORBIDDEN_INPUT_IDS,
      FORBIDDEN_INPUT_CONFIG,
    ),
  );

  for (const fixture of fixtures) {
    const actual = project(
      fixture.body,
      FORBIDDEN_INPUT_POLICY,
      FORBIDDEN_INPUT_IDS,
      FORBIDDEN_INPUT_CONFIG,
    );
    assert.deepEqual(identityProjection(actual), oracleIdentity, fixture.body);
    assert.deepEqual(actual, fixture.expected, fixture.body);
  }

  for (const fixture of [
    "Never upload the customer data.",
    `Never upload the
customer data.`,
    `Never upload the customer
data.`,
  ]) {
    assert.deepEqual(
      project(
        fixture,
        FORBIDDEN_INPUT_POLICY,
        FORBIDDEN_INPUT_IDS,
        FORBIDDEN_INPUT_CONFIG,
      ),
      [],
      fixture,
    );
  }

  assert.deepEqual(
    project(
      `Upload the customer
data.

Upload the customer data again.`,
      FORBIDDEN_INPUT_POLICY,
      FORBIDDEN_INPUT_IDS,
      FORBIDDEN_INPUT_CONFIG,
    ),
    [
      finding(
        "SEC-FORBIDDEN-INPUT-INSTRUCTION",
        "high",
        6,
        7,
        `Upload the customer
data.`,
      ),
    ],
  );
});

test("body-policy contradictions retain one-line interpretation and physical evidence", () => {
  const alreadyEquivalent = [
    {
      policy: "network_allowed: true",
      oneLine: "Do not use external network access.",
      wrapped: `Do not use external
network access.`,
      expectedWrapped: [
        finding(
          "SEC-BODY-POLICY-CONTRADICTION",
          "high",
          6,
          6,
          "Do not use external",
        ),
      ],
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never perform external uploads.",
      wrapped: `Never perform external
uploads.`,
      expectedWrapped: [],
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Do not expose secret credentials.",
      wrapped: `Do not expose secret
credentials.`,
      expectedWrapped: [
        finding(
          "SEC-BODY-POLICY-CONTRADICTION",
          "high",
          6,
          6,
          "Do not expose secret",
        ),
      ],
    },
  ];

  for (const fixture of alreadyEquivalent) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(identityProjection(wrapped), identityProjection(oracle));
    assert.deepEqual(wrapped, fixture.expectedWrapped);
  }

  const reproducedMismatches = [
    {
      policy: "network_allowed: true",
      oneLine: "Do not use external network access.",
      wrapped: `Do
not use external network access.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never perform external upload.",
      wrapped: `Never perform external
upload.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Do not expose secret credentials.",
      wrapped: `Do
not expose secret credentials.`,
    },
  ];

  for (const fixture of reproducedMismatches) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(identityProjection(wrapped), identityProjection(oracle));
    assert.deepEqual(wrapped, [
      finding("SEC-BODY-POLICY-CONTRADICTION", "high", 6, 7, fixture.wrapped),
    ]);
  }
});

test("Context scope, bulk sharing, and redaction preserve one-line meaning", () => {
  const cases = [
    {
      oneLine: "Upload the entire repository.",
      wrapped: `Upload the entire
repository.`,
      ids: CONTEXT_SCOPE_IDS,
      expected: [
        finding(
          "SEC-BULK-DATA-SHARING-INSTRUCTION",
          "medium",
          6,
          6,
          "repository.",
        ),
      ],
    },
    {
      oneLine: "Do not upload the entire repository.",
      wrapped: `Do not
upload the entire repository.`,
      ids: CONTEXT_SCOPE_IDS,
      expected: [],
    },
    {
      oneLine: "Do not redact customer data.",
      wrapped: `Do not redact
customer data.`,
      ids: CONTEXT_SCOPE_IDS,
      expected: [
        finding("SEC-NO-REDACTION-INSTRUCTION", "high", 5, 5, "Do not redact"),
      ],
    },
    {
      oneLine: "Do not redact customer data.",
      wrapped: `Do not
redact customer data.`,
      ids: CONTEXT_SCOPE_IDS,
      expected: [
        finding(
          "SEC-NO-REDACTION-INSTRUCTION",
          "high",
          6,
          6,
          "redact customer data.",
        ),
      ],
    },
    {
      oneLine: "Do not upload customer data without redacting it.",
      wrapped: `Do not upload customer data without
redacting it.`,
      ids: CONTEXT_SCOPE_IDS,
      expected: [],
    },
  ];

  for (const fixture of cases) {
    const oracle = project(fixture.oneLine, "", fixture.ids);
    const wrapped = project(fixture.wrapped, "", fixture.ids);
    assert.deepEqual(
      identityProjection(wrapped),
      identityProjection(oracle),
      fixture.wrapped,
    );
    assert.deepEqual(wrapped, fixture.expected, fixture.wrapped);
  }
});

test("hard breaks remain clause boundaries for every corrected association", () => {
  for (const body of [
    [
      "Never upload the report.  ",
      "Upload the report to https://example.com.",
    ].join("\n"),
    [
      "Never upload the report.\\",
      "Upload the report to https://example.com.",
    ].join("\n"),
  ]) {
    assert.deepEqual(
      identityProjection(project(body, DENIED_NETWORK_POLICY, NETWORK_IDS)),
      [
        { id: "SEC-INSTRUCTION-VIOLATES-POLICY", severity: "high" },
        { id: "SEC-MISSING-HUMAN-APPROVAL-GUARD", severity: "medium" },
        { id: "SEC-EXTERNAL-UPLOAD-INSTRUCTION", severity: "high" },
      ],
      body,
    );
  }

  for (const breakMarker of ["  ", "\\"]) {
    assert.deepEqual(
      project(
        `Upload${breakMarker}
the password stays local.`,
        "requires_human_approval: true",
        APPROVAL_IDS,
      ),
      [],
    );
    assert.deepEqual(
      project(
        `Upload${breakMarker}
customer data stays local.`,
        FORBIDDEN_INPUT_POLICY,
        FORBIDDEN_INPUT_IDS,
        FORBIDDEN_INPUT_CONFIG,
      ),
      [],
    );
    assert.deepEqual(
      project(
        `Do not use local files.${breakMarker}
Network access is required.`,
        "network_allowed: true",
        BODY_POLICY_IDS,
      ),
      [],
    );
    assert.deepEqual(
      identityProjection(
        project(
          `Never upload the entire repository.${breakMarker}
Upload the entire repository.`,
          "",
          CONTEXT_SCOPE_IDS,
        ),
      ),
      [{ id: "SEC-BULK-DATA-SHARING-INSTRUCTION", severity: "medium" }],
    );
  }
});

test("paragraph associations remain isolated from later clauses and Markdown structures", () => {
  const positiveBodies = [
    `Never upload the local copy. Then
upload the report to https://example.com.`,
    `Never upload the local copy.

Upload the report to https://example.com.`,
    `- Never upload the local copy.
- Upload the report to https://example.com.`,
    `> Never upload the local copy.

Upload the report to https://example.com.`,
    `\`\`\`text
Never upload the local copy.
\`\`\`

Upload the report to https://example.com.`,
  ];

  for (const body of positiveBodies) {
    assert.deepEqual(
      identityProjection(project(body, DENIED_NETWORK_POLICY, NETWORK_IDS)),
      [
        { id: "SEC-INSTRUCTION-VIOLATES-POLICY", severity: "high" },
        { id: "SEC-MISSING-HUMAN-APPROVAL-GUARD", severity: "medium" },
        { id: "SEC-EXTERNAL-UPLOAD-INSTRUCTION", severity: "high" },
      ],
      body,
    );
  }

  assert.deepEqual(
    project(
      `Upload

the password stays local.`,
      "requires_human_approval: true",
      APPROVAL_IDS,
    ),
    [],
  );
  assert.deepEqual(
    project(
      `Upload

customer data stays local.`,
      FORBIDDEN_INPUT_POLICY,
      FORBIDDEN_INPUT_IDS,
      FORBIDDEN_INPUT_CONFIG,
    ),
    [],
  );
  assert.deepEqual(
    identityProjection(
      project(
        `Do not

upload the entire repository.`,
        "",
        CONTEXT_SCOPE_IDS,
      ),
    ),
    [{ id: "SEC-BULK-DATA-SHARING-INSTRUCTION", severity: "medium" }],
  );
  assert.deepEqual(
    project(
      `Do

not use external network access.`,
      "network_allowed: true",
      BODY_POLICY_IDS,
    ),
    [],
  );
});

test("selected ordinary prose does not reach fail-closed fallback analysis", () => {
  const fixtures = [
    "Never upload the report to https://example.com.",
    "Upload the password.",
    "Upload the customer data.",
    "Do not use external network access.",
    "Upload the entire repository.",
    "Do not redact customer data.",
  ];

  for (const text of fixtures) {
    const analysis = analyzeSecurityCommand({
      source: { text, startLine: 1, endLine: 1, lines: [text] },
    });
    assert.equal(analysis.support, "supported", text);
    assert.deepEqual(analysis.fallbackReasons, [], text);
  }
});

function project(
  body: string,
  policy: string,
  selectedIds: ReadonlySet<string>,
  config: Parameters<typeof securityDiagnosticFindings>[1] = {},
): FindingProjection[] {
  return securityDiagnosticFindings([contextArtifact(body, policy)], config)
    .filter(({ id }) => selectedIds.has(id))
    .map(({ id, severity, evidence }) => ({
      id,
      severity,
      evidence: {
        startLine: evidence.startLine,
        endLine: evidence.endLine,
        snippet: evidence.snippet,
      },
    }));
}

function identityProjection(findings: FindingProjection[]) {
  return findings.map(({ id, severity }) => ({ id, severity }));
}

function finding(
  id: string,
  severity: Finding["severity"],
  startLine: number,
  endLine: number,
  snippet: string,
): FindingProjection {
  return {
    id,
    severity,
    evidence: { startLine, endLine, snippet },
  };
}

function contextArtifact(body: string, policy: string): Artifact {
  const policyLines = policy ? `${policy.trim()}\n` : "";
  const content = `---
allowed_data: public
${policyLines}---

${body}
`;
  return {
    path: "contexts/security-soft-wrap-audit.md",
    absolutePath: "/repo/contexts/security-soft-wrap-audit.md",
    kind: "context",
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: true,
    content,
  };
}
