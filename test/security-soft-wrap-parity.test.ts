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
const COMMAND_PATH_IDS = new Set([
  "SEC-INSTRUCTION-VIOLATES-POLICY",
  "SEC-SECRET-MATERIAL-INSTRUCTION",
]);
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
const GIT_CREDENTIALS_CONFIG: Parameters<typeof securityDiagnosticFindings>[1] =
  {
    security: {
      approvedDomains: [],
      approvedUploadDomains: [],
      disallowedCommands: [],
      profiles: {
        restricted: {
          allowedData: [],
          forbiddenInputs: ["git credentials"],
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
    {
      oneLine: "Upload the Git credentials.",
      wrapped: `Upload the
Git credentials.`,
    },
    {
      oneLine: "Upload the AWS credentials.",
      wrapped: `Upload the
AWS credentials.`,
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
    {
      body: "Echo the customer data.",
      expected: [
        finding(
          "SEC-FORBIDDEN-INPUT-INSTRUCTION",
          "high",
          6,
          6,
          "Echo the customer data.",
        ),
      ],
    },
    {
      body: `Echo the
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
    "Never echo the customer data.",
    `Never echo the
customer data.`,
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

test("forbidden inputs containing command words keep soft-wrap parity", () => {
  const oneLine = project(
    "Upload the git credentials.",
    FORBIDDEN_INPUT_POLICY,
    FORBIDDEN_INPUT_IDS,
    GIT_CREDENTIALS_CONFIG,
  );
  const wrapped = project(
    `Upload the git
credentials.`,
    FORBIDDEN_INPUT_POLICY,
    FORBIDDEN_INPUT_IDS,
    GIT_CREDENTIALS_CONFIG,
  );

  assert.deepEqual(oneLine, [
    finding(
      "SEC-FORBIDDEN-INPUT-INSTRUCTION",
      "high",
      6,
      6,
      "Upload the git credentials.",
    ),
  ]);
  assert.deepEqual(identityProjection(wrapped), identityProjection(oneLine));
  assert.deepEqual(wrapped, [
    finding(
      "SEC-FORBIDDEN-INPUT-INSTRUCTION",
      "high",
      6,
      7,
      `Upload the git
credentials.`,
    ),
  ]);
});

test("actual shell commands remain on the command-specific path", () => {
  assert.deepEqual(
    project(
      `\`\`\`bash
echo "$PASSWORD"
\`\`\``,
      "secrets_allowed: false",
      COMMAND_PATH_IDS,
    ),
    [
      finding(
        "SEC-INSTRUCTION-VIOLATES-POLICY",
        "high",
        7,
        7,
        'echo "$PASSWORD"',
      ),
      finding(
        "SEC-SECRET-MATERIAL-INSTRUCTION",
        "critical",
        7,
        7,
        'echo "$PASSWORD"',
      ),
    ],
  );
});

test("unfenced command-shaped paragraphs retain exact command results", () => {
  for (const command of ['echo "$PASSWORD"', '- echo "$PASSWORD"']) {
    assert.deepEqual(
      project(command, "secrets_allowed: false", COMMAND_PATH_IDS),
      [
        finding("SEC-INSTRUCTION-VIOLATES-POLICY", "high", 6, 6, command),
        finding("SEC-SECRET-MATERIAL-INSTRUCTION", "critical", 6, 6, command),
      ],
      command,
    );
  }
});

test("body-policy contradictions retain one-line interpretation and physical evidence", () => {
  const fixtures = [
    {
      policy: "network_allowed: true",
      oneLine: "Do not use external network access.",
      wrapped: `Do not use external
network access.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never perform external uploads.",
      wrapped: `Never perform external
uploads.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "This workflow must run without access to secrets.",
      wrapped: `This workflow must run without
access to secrets.`,
    },
  ];

  for (const fixture of fixtures) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(identityProjection(oracle), [
      { id: "SEC-BODY-POLICY-CONTRADICTION", severity: "high" },
    ]);
    assert.deepEqual(identityProjection(wrapped), identityProjection(oracle));
    assert.deepEqual(wrapped, [
      finding("SEC-BODY-POLICY-CONTRADICTION", "high", 6, 7, fixture.wrapped),
    ]);
  }
});

test("requirement language stays non-contradictory across soft wraps", () => {
  const fixtures = [
    {
      policy: "network_allowed: true",
      oneLine: "No network access is required for local validation.",
      wrapped: `No network access is
required for local validation.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "External uploads are not required by this workflow.",
      wrapped: `External uploads are not
required by this workflow.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "No secret access is needed for this task.",
      wrapped: `No secret access is
needed for this task.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "The process does not require credentials.",
      wrapped: `The process does not
require credentials.`,
    },
  ];

  for (const fixture of fixtures) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(oracle, [], fixture.oneLine);
    assert.deepEqual(wrapped, oracle, fixture.wrapped);
  }
});

test("supported workflow prohibitions retain identity and bounded soft-wrap evidence", () => {
  const fixtures = [
    {
      policy: "network_allowed: true",
      oneLine: "Never allow any network access for this workflow.",
      wrapped: `Never allow any network
access for this workflow.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "This workflow must not use the network.",
      wrapped: `This workflow must not use
the network.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "The workflow cannot access the internet.",
      wrapped: `The workflow cannot access
the internet.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "This workflow must not upload files.",
      wrapped: `This workflow must not upload
files.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never upload files externally.",
      wrapped: `Never upload files
externally.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Uploads must not be performed in this workflow.",
      wrapped: `Uploads must not be performed
in this workflow.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Credentials must not be used in this workflow.",
      wrapped: `Credentials must not be used
in this workflow.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "No secrets may be used for this process.",
      wrapped: `No secrets may be used
for this process.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Never access credentials during this task.",
      wrapped: `Never access credentials
during this task.`,
    },
  ];

  for (const fixture of fixtures) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(oracle, [
      finding("SEC-BODY-POLICY-CONTRADICTION", "high", 6, 6, fixture.oneLine),
    ]);
    assert.deepEqual(identityProjection(wrapped), identityProjection(oracle));
    assert.deepEqual(wrapped, [
      finding("SEC-BODY-POLICY-CONTRADICTION", "high", 6, 7, fixture.wrapped),
    ]);
  }
});

test("localized body-policy safeguards stay non-contradictory across soft wraps", () => {
  const fixtures = [
    {
      policy: "network_allowed: true",
      oneLine: "Do not allow npx to download a missing package.",
      wrapped: `Do not allow npx to
download a missing package.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "Never let npx download a missing Appium package.",
      wrapped: `Never let npx
download a missing Appium package.`,
    },
    {
      policy: "network_allowed: true",
      oneLine:
        "Resolve command mode once. Use `appium` by default; when the user explicitly selects local mode, run from the project root and replace every `appium ...` invocation in this procedure with `npx --no-install appium ...`. Never mix global and local modes in one run or allow `npx` to download a missing Appium package.",
      wrapped: `Resolve command mode once. Use \`appium\` by default; when the user explicitly
selects local mode, run from the project root and replace every \`appium ...\`
invocation in this procedure with \`npx --no-install appium ...\`. Never mix global
and local modes in one run or allow \`npx\` to download a missing Appium package.`,
    },
    {
      policy: "network_allowed: true",
      oneLine:
        "Do not allow npx to download a missing package from the internet.",
      wrapped: `Do not allow npx to download a missing package from the
internet.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "Do not use the Git remote API for authentication.",
      wrapped: `Do not use the Git remote
API for authentication.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "Never call https://untrusted.example.com from this step.",
      wrapped: `Never call https://untrusted.example.com
from this step.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "Avoid external webhooks when running locally.",
      wrapped: `Avoid external webhooks when
running locally.`,
    },
    {
      policy: "network_allowed: true",
      oneLine: "Do not use network access to production systems.",
      wrapped: `Do not use network access to
production systems.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never upload debug logs to a public bucket.",
      wrapped: `Never upload debug logs to
a public bucket.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never perform external uploads to public buckets.",
      wrapped: `Never perform external uploads to
public buckets.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine: "Never upload anything to untrusted.example.com.",
      wrapped: `Never upload anything to
untrusted.example.com.`,
    },
    {
      policy: "external_upload_allowed: true\nsecrets_allowed: true",
      oneLine: "Do not upload secrets to third-party services.",
      wrapped: `Do not upload secrets to third-party
services.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Never print secrets to logs.",
      wrapped: `Never print secrets
to logs.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Do not include credentials in command arguments.",
      wrapped: `Do not include credentials in
command arguments.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "This workflow must not access credentials from production.",
      wrapped: `This workflow must not access credentials from
production.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine: "Secrets are forbidden in command arguments.",
      wrapped: `Secrets are forbidden in
command arguments.`,
    },
  ];

  for (const fixture of fixtures) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(oracle, [], fixture.oneLine);
    assert.deepEqual(wrapped, oracle, fixture.wrapped);
  }
});

test("workflow bans survive local safeguards on the same line and across wraps", () => {
  const fixtures = [
    {
      policy: "network_allowed: true",
      oneLine:
        "Do not use network access for this workflow. Do not allow npx to download a missing package.",
      wrapped: `Do not use network access for this workflow.
Do not allow npx to download a missing package.`,
    },
    {
      policy: "network_allowed: true",
      oneLine:
        "Do not allow npx to download a missing package. This workflow must run without internet access.",
      wrapped: `Do not allow npx to download a missing package.
This workflow must run without internet access.`,
    },
    {
      policy: "external_upload_allowed: true",
      oneLine:
        "Never perform external uploads. Never upload debug logs to a public bucket.",
      wrapped: `Never perform external uploads.
Never upload debug logs to a public bucket.`,
    },
    {
      policy: "secrets_allowed: true",
      oneLine:
        "This workflow must run without access to secrets. Never print secrets to logs.",
      wrapped: `This workflow must run without access to secrets.
Never print secrets to logs.`,
    },
  ];

  for (const fixture of fixtures) {
    const oracle = project(fixture.oneLine, fixture.policy, BODY_POLICY_IDS);
    const wrapped = project(fixture.wrapped, fixture.policy, BODY_POLICY_IDS);
    assert.deepEqual(identityProjection(oracle), [
      { id: "SEC-BODY-POLICY-CONTRADICTION", severity: "high" },
    ]);
    assert.deepEqual(
      identityProjection(wrapped),
      identityProjection(oracle),
      fixture.wrapped,
    );
  }
});

test("requirement language does not hide a later wrapped workflow prohibition", () => {
  const oneLine =
    "Network access is not required for local validation. This workflow must run offline.";
  const wrapped = `Network access is not required for local validation. This workflow
must run offline.`;
  const oracle = project(oneLine, "network_allowed: true", BODY_POLICY_IDS);
  const wrappedFindings = project(
    wrapped,
    "network_allowed: true",
    BODY_POLICY_IDS,
  );

  assert.deepEqual(oracle, [
    finding("SEC-BODY-POLICY-CONTRADICTION", "high", 6, 6, oneLine),
  ]);
  assert.deepEqual(
    identityProjection(wrappedFindings),
    identityProjection(oracle),
  );
  assert.deepEqual(wrappedFindings, [
    finding("SEC-BODY-POLICY-CONTRADICTION", "high", 6, 7, wrapped),
  ]);
});

test("workflow-wide network bans stay contradictory across soft wraps", () => {
  const oneLine = "This workflow must run without internet access.";
  const wrapped = `This workflow must run without
internet access.`;
  const oracle = project(oneLine, "network_allowed: true", BODY_POLICY_IDS);
  const wrappedFindings = project(
    wrapped,
    "network_allowed: true",
    BODY_POLICY_IDS,
  );

  assert.deepEqual(identityProjection(oracle), [
    { id: "SEC-BODY-POLICY-CONTRADICTION", severity: "high" },
  ]);
  assert.deepEqual(
    identityProjection(wrappedFindings),
    identityProjection(oracle),
  );
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
