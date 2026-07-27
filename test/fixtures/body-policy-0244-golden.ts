export interface LegacyBodyPolicyFindingProjection {
  readonly id: string;
  readonly severity: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
}

export interface LegacyBodyPolicyGoldenCase {
  readonly name: string;
  readonly body: string;
  readonly expected: readonly LegacyBodyPolicyFindingProjection[];
  readonly coverage: Readonly<Record<string, string | number>>;
}

export const BODY_POLICY_0244_GOLDEN_SOURCE = Object.freeze({
  tag: "v0.24.4",
  commit: "9e72e1adddd588ea72cba1c3e06ed1d07de330d9",
  generatedBy:
    "Checked out the full commit, built it with the repository toolchain, and invoked securityDiagnosticFindings once for every frozen body with all three permissive policy domains enabled. Legacy code is not executed in CI.",
});

const RAW_BODY_POLICY_0244_GOLDEN_CASES = [
  {
    name: "pairwise-01-ordinary-one-line",
    body: "This workflow validates inputs and is deterministic, yet must not use the network.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "unrelated",
      laterScope: "workflow",
      earlierDomain: "network",
      laterDomain: "network",
      connector: "ordinary",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-02-ordinary-soft-wrap",
    body: "This task validates inputs and\nis deterministic, yet\nthe helper must not upload files during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "unrelated",
      laterScope: "local",
      earlierDomain: "network",
      laterDomain: "upload",
      connector: "ordinary",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-03-ordinary-hard-break",
    body: "The process validates inputs and is deterministic, yet may write local logs but  \nmust not access credentials from production.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The process",
      firstKind: "unrelated",
      laterScope: "specific",
      earlierDomain: "network",
      laterDomain: "secrets",
      connector: "ordinary",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-04-ordinary-heading",
    body: "## This run validates inputs and is deterministic, yet may write local logs but the helper must not use the network except for approved domains.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This run",
      firstKind: "unrelated",
      laterScope: "unsupported",
      earlierDomain: "upload",
      laterDomain: "network",
      connector: "ordinary",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-05-modified-ordinary-one-line",
    body: "The operation requires external uploads and also may write local logs, yet must not upload files.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The operation",
      firstKind: "requirement",
      laterScope: "workflow",
      earlierDomain: "upload",
      laterDomain: "upload",
      connector: "modified-ordinary",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-06-modified-ordinary-soft-wrap",
    body: "This workflow requires external uploads and also\nmay write local logs, yet\nthe helper must not use credentials during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "requirement",
      laterScope: "local",
      earlierDomain: "upload",
      laterDomain: "secrets",
      connector: "modified-ordinary",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-07-modified-ordinary-hard-break",
    body: "This task requires credentials and also may write local logs, yet audits logs but  \nmust not use network access to production systems.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "requirement",
      laterScope: "specific",
      earlierDomain: "secrets",
      laterDomain: "network",
      connector: "modified-ordinary",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-08-modified-ordinary-heading",
    body: "## The process requires credentials and also may write local logs, yet audits logs but the helper must not upload files except to approved storage.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The process",
      firstKind: "requirement",
      laterScope: "unsupported",
      earlierDomain: "secrets",
      laterDomain: "upload",
      connector: "modified-ordinary",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-09-but-one-line",
    body: "This run does not require credential access but audits logs, yet must not use credentials.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This run",
      firstKind: "not-required",
      laterScope: "workflow",
      earlierDomain: "secrets",
      laterDomain: "secrets",
      connector: "but",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-10-but-soft-wrap",
    body: "The operation does not require network access but\naudits logs, yet\nthe helper must not use the network during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The operation",
      firstKind: "not-required",
      laterScope: "local",
      earlierDomain: "network",
      laterDomain: "network",
      connector: "but",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-11-but-hard-break",
    body: "This workflow does not require network access but  \naudits logs, yet checks configuration but must not upload files to a public bucket.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "not-required",
      laterScope: "specific",
      earlierDomain: "network",
      laterDomain: "upload",
      connector: "but",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-12-but-heading",
    body: "## This task does not require network access but audits logs, yet checks configuration but the helper must not use credentials unless explicitly approved.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "not-required",
      laterScope: "unsupported",
      earlierDomain: "network",
      laterDomain: "secrets",
      connector: "but",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-13-yet-one-line",
    body: "The process must not upload files during local setup, yet checks configuration, yet must not use the network.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The process",
      firstKind: "local",
      laterScope: "workflow",
      earlierDomain: "upload",
      laterDomain: "network",
      connector: "yet",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-14-yet-soft-wrap",
    body: "This run must not upload files during local setup, yet\nchecks configuration, yet\nthe helper must not upload files during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This run",
      firstKind: "local",
      laterScope: "local",
      earlierDomain: "upload",
      laterDomain: "upload",
      connector: "yet",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-15-yet-hard-break",
    body: "The operation must not upload files during local setup, yet checks configuration, yet is deterministic but  \nmust not access credentials from production.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The operation",
      firstKind: "local",
      laterScope: "specific",
      earlierDomain: "upload",
      laterDomain: "secrets",
      connector: "yet",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-16-yet-heading",
    body: "## This workflow must not use credentials during local setup, yet checks configuration, yet is deterministic but the helper must not use the network except for approved domains.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "local",
      laterScope: "unsupported",
      earlierDomain: "secrets",
      laterDomain: "network",
      connector: "yet",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-17-however-one-line",
    body: "This task must not access credentials from production; however, it is deterministic, yet must not upload files.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "specific",
      laterScope: "workflow",
      earlierDomain: "secrets",
      laterDomain: "upload",
      connector: "however",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-18-however-soft-wrap",
    body: "The process must not access credentials from production; however, it\nis deterministic, yet\nthe helper must not use credentials during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The process",
      firstKind: "specific",
      laterScope: "local",
      earlierDomain: "secrets",
      laterDomain: "secrets",
      connector: "however",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-19-however-hard-break",
    body: "This run must not use network access to production systems; however, it is deterministic, yet may write local logs but  \nmust not use network access to production systems.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This run",
      firstKind: "specific",
      laterScope: "specific",
      earlierDomain: "network",
      laterDomain: "network",
      connector: "however",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-20-however-heading",
    body: "## The operation must not use network access to production systems; however, it is deterministic, yet may write local logs but the helper must not upload files except to approved storage.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The operation",
      firstKind: "specific",
      laterScope: "unsupported",
      earlierDomain: "network",
      laterDomain: "upload",
      connector: "however",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "copular",
    },
  },
  {
    name: "pairwise-21-semicolon-one-line",
    body: "This workflow must not use the network; may write local logs, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow must not use the network",
      },
    ],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "workflow-prohibition",
      laterScope: "workflow",
      earlierDomain: "network",
      laterDomain: "secrets",
      connector: "semicolon",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-22-semicolon-soft-wrap",
    body: "This task must not upload files;\nmay write local logs, yet\nthe helper must not use the network during local setup.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task must not upload files",
      },
    ],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "workflow-prohibition",
      laterScope: "local",
      earlierDomain: "upload",
      laterDomain: "network",
      connector: "semicolon",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-23-semicolon-hard-break",
    body: "The process must not upload files; may write local logs, yet audits logs but  \nmust not upload files to a public bucket.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The process must not upload files",
      },
    ],
    coverage: {
      group: "pairwise",
      subject: "The process",
      firstKind: "workflow-prohibition",
      laterScope: "specific",
      earlierDomain: "upload",
      laterDomain: "upload",
      connector: "semicolon",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-24-semicolon-heading",
    body: "## This run must not upload files; may write local logs, yet audits logs but the helper must not use credentials unless explicitly approved.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This run must not upload files",
      },
    ],
    coverage: {
      group: "pairwise",
      subject: "This run",
      firstKind: "workflow-prohibition",
      laterScope: "unsupported",
      earlierDomain: "upload",
      laterDomain: "secrets",
      connector: "semicolon",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "auxiliary",
    },
  },
  {
    name: "pairwise-25-then-one-line",
    body: "The operation validates inputs then audits logs, yet must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The operation validates inputs",
      },
    ],
    coverage: {
      group: "pairwise",
      subject: "The operation",
      firstKind: "unrelated",
      laterScope: "workflow",
      earlierDomain: "secrets",
      laterDomain: "network",
      connector: "then",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-26-then-soft-wrap",
    body: "This workflow validates inputs then\naudits logs, yet\nthe helper must not upload files during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "unrelated",
      laterScope: "local",
      earlierDomain: "secrets",
      laterDomain: "upload",
      connector: "then",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-27-then-hard-break",
    body: "This task validates inputs then audits logs, yet checks configuration but  \nmust not access credentials from production.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "unrelated",
      laterScope: "specific",
      earlierDomain: "secrets",
      laterDomain: "secrets",
      connector: "then",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-28-then-heading",
    body: "## The process validates inputs then audits logs, yet checks configuration but the helper must not use the network except for approved domains.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The process",
      firstKind: "unrelated",
      laterScope: "unsupported",
      earlierDomain: "network",
      laterDomain: "network",
      connector: "then",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "ordinary",
    },
  },
  {
    name: "pairwise-29-sentence-one-line",
    body: "This run requires network access. checks configuration, yet must not upload files.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This run",
      firstKind: "requirement",
      laterScope: "workflow",
      earlierDomain: "network",
      laterDomain: "upload",
      connector: "sentence",
      layout: "one-line",
      subjectMode: "implicit",
      predicateCount: 3,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-30-sentence-soft-wrap",
    body: "The operation requires network access.\nchecks configuration, yet\nthe helper must not use credentials during local setup.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "The operation",
      firstKind: "requirement",
      laterScope: "local",
      earlierDomain: "network",
      laterDomain: "secrets",
      connector: "sentence",
      layout: "soft-wrap",
      subjectMode: "changed",
      predicateCount: 3,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-31-sentence-hard-break",
    body: "This workflow requires external uploads. checks configuration, yet is deterministic but  \nmust not use network access to production systems.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This workflow",
      firstKind: "requirement",
      laterScope: "specific",
      earlierDomain: "upload",
      laterDomain: "network",
      connector: "sentence",
      layout: "hard-break",
      subjectMode: "implicit",
      predicateCount: 4,
      middleCategory: "established",
    },
  },
  {
    name: "pairwise-32-sentence-heading",
    body: "## This task requires external uploads. checks configuration, yet is deterministic but the helper must not upload files except to approved storage.",
    expected: [],
    coverage: {
      group: "pairwise",
      subject: "This task",
      firstKind: "requirement",
      laterScope: "unsupported",
      earlierDomain: "upload",
      laterDomain: "upload",
      connector: "sentence",
      layout: "heading",
      subjectMode: "changed",
      predicateCount: 4,
      middleCategory: "established",
    },
  },
  {
    name: "direct-always-network-one-line",
    body: "This workflow always must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow always must not use the network.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "one-line",
    },
  },
  {
    name: "direct-always-network-soft-wrap",
    body: "This workflow\nalways must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "This workflow\nalways must not use the network.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "soft-wrap",
    },
  },
  {
    name: "direct-always-network-heading",
    body: "## This workflow always must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This workflow always must not use the network.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "heading",
    },
  },
  {
    name: "direct-explicit-upload-one-line",
    body: "This task explicitly cannot upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task explicitly cannot upload files.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "one-line",
    },
  },
  {
    name: "direct-explicit-upload-soft-wrap",
    body: "This task\nexplicitly cannot upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "This task\nexplicitly cannot upload files.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "soft-wrap",
    },
  },
  {
    name: "direct-explicit-upload-heading",
    body: "## This task explicitly cannot upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This task explicitly cannot upload files.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "heading",
    },
  },
  {
    name: "direct-modal-secret-one-line",
    body: "The process may never use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The process may never use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "one-line",
    },
  },
  {
    name: "direct-modal-secret-soft-wrap",
    body: "The process\nmay never use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "The process\nmay never use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "soft-wrap",
    },
  },
  {
    name: "direct-modal-secret-heading",
    body: "## The process may never use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## The process may never use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "heading",
    },
  },
  {
    name: "direct-colon-secret-one-line",
    body: "This workflow: must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow: must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "one-line",
    },
  },
  {
    name: "direct-colon-secret-soft-wrap",
    body: "This workflow\n: must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "This workflow\n: must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "soft-wrap",
    },
  },
  {
    name: "direct-colon-secret-heading",
    body: "## This workflow: must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This workflow: must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "heading",
    },
  },
  {
    name: "direct-relative-secret-one-line",
    body: "This workflow that validates inputs must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that validates inputs must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "one-line",
    },
  },
  {
    name: "direct-relative-secret-soft-wrap",
    body: "This workflow\nthat validates inputs must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet:
          "This workflow\nthat validates inputs must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "soft-wrap",
    },
  },
  {
    name: "direct-relative-secret-heading",
    body: "## This workflow that validates inputs must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "## This workflow that validates inputs must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-bridge",
      layout: "heading",
    },
  },
  {
    name: "descriptive-says-helper-one-line",
    body: "This workflow says the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow says the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "one-line",
    },
  },
  {
    name: "descriptive-says-helper-soft-wrap",
    body: "This workflow\nsays the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "This workflow\nsays the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "soft-wrap",
    },
  },
  {
    name: "descriptive-says-helper-heading",
    body: "## This workflow says the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This workflow says the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "heading",
    },
  },
  {
    name: "descriptive-documents-helper-one-line",
    body: "This workflow documents that the helper must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow documents that the helper must not upload files.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "one-line",
    },
  },
  {
    name: "descriptive-documents-helper-soft-wrap",
    body: "This workflow\ndocuments that the helper must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet:
          "This workflow\ndocuments that the helper must not upload files.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "soft-wrap",
    },
  },
  {
    name: "descriptive-documents-helper-heading",
    body: "## This workflow documents that the helper must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "## This workflow documents that the helper must not upload files.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "heading",
    },
  },
  {
    name: "quoted-example-one-line",
    body: 'This workflow quotes "must not use the network" as example wording.',
    expected: [],
    coverage: {
      group: "direct-precision",
      layout: "one-line",
    },
  },
  {
    name: "quoted-example-soft-wrap",
    body: 'This workflow\nquotes "must not use the network" as example wording.',
    expected: [],
    coverage: {
      group: "direct-precision",
      layout: "soft-wrap",
    },
  },
  {
    name: "quoted-example-heading",
    body: '## This workflow quotes "must not use the network" as example wording.',
    expected: [],
    coverage: {
      group: "direct-precision",
      layout: "heading",
    },
  },
  {
    name: "conditional-prohibition-one-line",
    body: "This workflow must not use credentials if offline mode is selected.",
    expected: [],
    coverage: {
      group: "direct-precision",
      layout: "one-line",
    },
  },
  {
    name: "conditional-prohibition-soft-wrap",
    body: "This workflow\nmust not use credentials if offline mode is selected.",
    expected: [],
    coverage: {
      group: "direct-precision",
      layout: "soft-wrap",
    },
  },
  {
    name: "conditional-prohibition-heading",
    body: "## This workflow must not use credentials if offline mode is selected.",
    expected: [],
    coverage: {
      group: "direct-precision",
      layout: "heading",
    },
  },
  {
    name: "conditional-subject-bridge-one-line",
    body: "This workflow when offline must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow when offline must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "one-line",
    },
  },
  {
    name: "conditional-subject-bridge-soft-wrap",
    body: "This workflow\nwhen offline must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "This workflow\nwhen offline must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "soft-wrap",
    },
  },
  {
    name: "conditional-subject-bridge-heading",
    body: "## This workflow when offline must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This workflow when offline must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "heading",
    },
  },
  {
    name: "changed-subject-bridge-one-line",
    body: "This workflow: the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow: the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "one-line",
    },
  },
  {
    name: "changed-subject-bridge-soft-wrap",
    body: "This workflow\n: the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 12,
        snippet: "This workflow\n: the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "soft-wrap",
    },
  },
  {
    name: "changed-subject-bridge-heading",
    body: "## This workflow: the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This workflow: the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "direct-precision",
      layout: "heading",
    },
  },
  {
    name: "changed-middle-helper-one-line",
    body: "This workflow validates inputs but the helper audits logs, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "changed-subject",
      layout: "one-line",
    },
  },
  {
    name: "changed-middle-helper-soft-wrap",
    body: "This workflow validates inputs\nbut the helper audits logs,\nyet must not use credentials.",
    expected: [],
    coverage: {
      group: "changed-subject",
      layout: "soft-wrap",
    },
  },
  {
    name: "changed-middle-validation-one-line",
    body: "This workflow validates inputs but validation is delegated, yet the helper must not upload files.",
    expected: [],
    coverage: {
      group: "changed-subject",
      layout: "one-line",
    },
  },
  {
    name: "changed-middle-validation-soft-wrap",
    body: "This workflow validates inputs\nbut validation is delegated,\nyet the helper must not upload files.",
    expected: [],
    coverage: {
      group: "changed-subject",
      layout: "soft-wrap",
    },
  },
  {
    name: "precision-unexpected-modifier",
    body: "This workflow requires network access but unexpectedly must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-changed-helper",
    body: "This workflow requires network access but the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-unsupported-although",
    body: "This workflow validates inputs although must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow validates inputs although must not use credentials.",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-offline-helper",
    body: "This workflow requires credentials, yet the offline helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires credentials,",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-specific-upload-target",
    body: "This workflow requires external uploads, yet must not upload files to a public bucket.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires external uploads,",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-unsupported-network-remainder",
    body: "This workflow requires network access but must not use the network except for approved domains.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-semicolon-however-without-comma",
    body: "This workflow requires network access; however must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "precision-changed-helper-chain",
    body: "This workflow validates inputs but the helper checks logs, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "independent-earlier-network-prohibition",
    body: "No network access and this workflow requires network access",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "domain-order-and-deduplication",
    body: "This workflow must not use credentials. This workflow must not upload files. This workflow must not use the network. This workflow must not use credentials. This workflow must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow must not use the network.",
      },
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow must not upload files.",
      },
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow must not use credentials.",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "paragraph-boundary-isolation",
    body: "This workflow validates inputs.\n\nMust not use credentials.",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "list-item-boundary-isolation",
    body: "- This task requires network access\n- Must not upload files.",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-unrelated-workflow",
    body: "This workflow validates inputs but must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-unrelated-task",
    body: "This task prepares the report, yet must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task prepares the report,",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-unrelated-process",
    body: "The process checks configuration; however, it must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The process checks configuration",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-specific-network",
    body: "This workflow must not use network access to production systems but must not use credentials.",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-specific-secret",
    body: "This workflow must not access credentials from production yet must not upload files.",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-three-secrets",
    body: "This workflow requires network access but checks logs, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-three-upload",
    body: "This workflow requires network access, but may write local logs, yet must not upload files.",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-modifier-still",
    body: "This workflow requires network access but still must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-modifier-also",
    body: "This workflow requires credentials yet also must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires credentials",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-modifier-therefore",
    body: "This workflow requires external uploads; however, it therefore must not use the network.",
    expected: [],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-heading",
    body: "## This workflow requires network access but must not use credentials",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "## This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-bare-semicolon",
    body: "This workflow requires network access; must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-then",
    body: "This workflow requires network access then must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow requires network access",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-middle-copular",
    body: "This workflow validates inputs but is deterministic, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-middle-audits",
    body: "This workflow validates inputs but audits logs, yet must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "stabilization-middle-reviews",
    body: "This task runs but reviews results, yet must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task runs",
      },
    ],
    coverage: {
      group: "precision-and-structure",
    },
  },
  {
    name: "scope-proof-descriptive-lists-upload",
    body: "This workflow lists no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow lists no external uploads.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      predicateStart: "explicit-workflow-subject",
      provenance: "supported-subjectless",
      subjectProof: "descriptive",
      layout: "one-line",
    },
  },
  {
    name: "scope-proof-changed-helper-network",
    body: "This workflow validates inputs but the helper must never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      predicateStart: "explicit-changed-subject",
      provenance: "supported-subjectless",
      subjectProof: "changed",
      layout: "one-line",
    },
  },
  {
    name: "scope-proof-changed-helper-upload",
    body: "This workflow validates inputs but the helper must never perform external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "the helper must never perform external uploads.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      predicateStart: "explicit-changed-subject",
      provenance: "supported-subjectless",
      subjectProof: "changed",
      layout: "one-line",
    },
  },
  {
    name: "scope-proof-conditional-network",
    body: "This workflow validates inputs but if offline, never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      predicateStart: "conditional-or-subordinate",
      provenance: "supported-subjectless",
      subjectProof: "conditional",
      layout: "one-line",
    },
  },
  {
    name: "bridge-will-never-network",
    body: "This workflow will never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow will never use the network.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "modal",
      subjectProof: "explicit-workflow-subject",
      layout: "one-line",
    },
  },
  {
    name: "bridge-shall-never-secrets",
    body: "This workflow shall never access credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow shall never access credentials.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "modal",
      subjectProof: "explicit-workflow-subject",
      layout: "one-line",
    },
  },
  {
    name: "bridge-punctuation-modifier-network",
    body: "This workflow: always must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow: always must not use the network.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "punctuation-plus-modifier",
      subjectProof: "explicit-workflow-subject",
      layout: "one-line",
    },
  },
  {
    name: "bridge-dash-modifier-upload",
    body: "This task — explicitly cannot upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task — explicitly cannot upload files.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "punctuation-plus-modifier",
      subjectProof: "explicit-workflow-subject",
      layout: "one-line",
    },
  },
  {
    name: "bridge-relative-secrets",
    body: "This workflow that validates inputs must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that validates inputs must not use credentials.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "bounded-relative",
      subjectProof: "explicit-workflow-subject",
      layout: "one-line",
    },
  },
  {
    name: "bridge-parenthetical-deterministic-validation",
    body: "This task (during deterministic validation) cannot upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This task (during deterministic validation) cannot upload files.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "bounded-parenthetical",
      bridgeScope: "local-step",
      layout: "one-line",
    },
  },
  {
    name: "bridge-parenthetical-local-network",
    body: "This workflow (during local setup) must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow (during local setup) must not use the network.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "bounded-parenthetical",
      bridgeScope: "local-step",
      layout: "one-line",
    },
  },
  {
    name: "bridge-parenthetical-validation-upload",
    body: "This workflow (only for the validation step) must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow (only for the validation step) must not upload files.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "bounded-parenthetical",
      bridgeScope: "local-step",
      layout: "one-line",
    },
  },
  {
    name: "bridge-parenthetical-exception-network",
    body: "This workflow (except for approved domains) must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow (except for approved domains) must not use the network.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "bounded-parenthetical",
      bridgeScope: "exception",
      layout: "one-line",
    },
  },
  {
    name: "bridge-parenthetical-target-upload",
    body: "This workflow (to a public bucket) must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow (to a public bucket) must not upload files.",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      bridge: "bounded-parenthetical",
      bridgeScope: "specific-target",
      layout: "one-line",
    },
  },
  {
    name: "middle-inflected-uploads",
    body: "This workflow checks inputs but uploads files, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow checks inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      middleVerb: "uploads",
      verbForm: "third-person",
      layout: "one-line",
    },
  },
  {
    name: "middle-inflected-operates",
    body: "This workflow validates inputs but operates offline, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      middleVerb: "operates",
      verbForm: "third-person",
      layout: "one-line",
    },
  },
  {
    name: "middle-changed-audit-jobs",
    body: "This workflow validates inputs but audit jobs must never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      middleVerb: "audit",
      predicateStart: "explicit-changed-subject",
      layout: "one-line",
    },
  },
  {
    name: "middle-changed-review-tasks",
    body: "This workflow validates inputs but review tasks must never upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      middleVerb: "review",
      predicateStart: "explicit-changed-subject",
      layout: "one-line",
    },
  },
  {
    name: "middle-changed-log-processors",
    body: "This workflow validates inputs but log processors must never access credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "scope-proof-and-bridges",
      middleVerb: "log",
      predicateStart: "explicit-changed-subject",
      layout: "one-line",
    },
  },
  {
    name: "bounded-directive-please-network",
    body: "Please do not use the network.",
    expected: [],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "directive-prefix",
      directivePrefix: "please",
      layout: "one-line",
    },
  },
  {
    name: "bounded-directive-for-safety-upload",
    body: "For safety, no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "For safety, no external uploads.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "directive-prefix",
      directivePrefix: "for-safety",
      layout: "one-line",
    },
  },
  {
    name: "bounded-directive-policy-label-upload",
    body: "Policy: no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Policy: no external uploads.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "directive-prefix",
      directivePrefix: "policy-label",
      layout: "one-line",
    },
  },
  {
    name: "bounded-directive-ensure-upload",
    body: "Ensure no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Ensure no external uploads.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "directive-prefix",
      directivePrefix: "ensure",
      layout: "one-line",
    },
  },
  {
    name: "bounded-coordination-semicolon-network",
    body: "Validate inputs; never use the network.",
    expected: [],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "subjectless-coordination",
      separator: "semicolon",
      activeSubject: "none",
      layout: "one-line",
    },
  },
  {
    name: "bounded-coordination-and-upload",
    body: "Validate inputs and no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Validate inputs and no external uploads.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "subjectless-coordination",
      separator: "and",
      activeSubject: "none",
      layout: "one-line",
    },
  },
  {
    name: "bounded-coordination-two-domains-and",
    body: "No external uploads and never use the network.",
    expected: [],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "subjectless-coordination",
      separator: "and",
      activeSubject: "none",
      domainBehavior: "two-domain",
      layout: "one-line",
    },
  },
  {
    name: "bounded-coordination-two-domains-semicolon",
    body: "Never use the network; no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "no external uploads.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "subjectless-coordination",
      separator: "semicolon",
      activeSubject: "none",
      domainBehavior: "two-domain",
      layout: "one-line",
    },
  },
  {
    name: "bounded-paired-relative-secrets",
    body: "This workflow, which validates inputs, must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow, which validates inputs, must not use credentials.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "paired-comma-modifier",
      pairedModifier: "relative",
      qualification: "none",
      layout: "one-line",
    },
  },
  {
    name: "bounded-paired-relative-upload",
    body: "This workflow, which is deterministic, must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow, which is deterministic, must not upload files.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "paired-comma-modifier",
      pairedModifier: "relative",
      qualification: "none",
      layout: "one-line",
    },
  },
  {
    name: "bounded-paired-local-network",
    body: "This workflow, during local setup, must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow, during local setup, must not use the network.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "paired-comma-modifier",
      pairedModifier: "parenthetical",
      qualification: "local",
      layout: "one-line",
    },
  },
  {
    name: "bounded-paired-exception-network",
    body: "This workflow, except for approved domains, must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow, except for approved domains, must not use the network.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "paired-comma-modifier",
      pairedModifier: "parenthetical",
      qualification: "exception",
      layout: "one-line",
    },
  },
  {
    name: "bounded-paired-target-upload",
    body: "This workflow, to a public bucket, must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow, to a public bucket, must not upload files.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "paired-comma-modifier",
      pairedModifier: "parenthetical",
      qualification: "specific-target",
      layout: "one-line",
    },
  },
  {
    name: "bounded-inline-relative-to-network",
    body: "This workflow that is designed to validate inputs must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that is designed to validate inputs must not use the network.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "inline-relative",
      preposition: "to",
      qualification: "unrelated-action",
      layout: "one-line",
    },
  },
  {
    name: "bounded-inline-relative-to-disk-upload",
    body: "This workflow that writes logs to disk must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that writes logs to disk must not upload files.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "inline-relative",
      preposition: "to",
      qualification: "unrelated-action",
      layout: "one-line",
    },
  },
  {
    name: "bounded-inline-relative-from-disk-secrets",
    body: "This workflow that loads configuration from disk must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that loads configuration from disk must not use credentials.",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "inline-relative",
      preposition: "from",
      qualification: "unrelated-action",
      layout: "one-line",
    },
  },
  {
    name: "bounded-changed-subject-audits",
    body: "This workflow checks inputs but audits must not use the network, yet must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow checks inputs",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "changed-subject",
      subjectShape: "single-word",
      homograph: "audits",
      layout: "one-line",
    },
  },
  {
    name: "bounded-changed-subject-reviews",
    body: "This workflow checks inputs but reviews must not use credentials, yet must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow checks inputs",
      },
    ],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "changed-subject",
      subjectShape: "single-word",
      homograph: "reviews",
      layout: "one-line",
    },
  },
  {
    name: "bounded-changed-subject-logs",
    body: "This workflow validates inputs but logs must not contain credentials, yet must not use the network.",
    expected: [],
    coverage: {
      group: "bounded-statement-groups",
      boundary: "changed-subject",
      subjectShape: "single-word",
      homograph: "logs",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-descriptive-network",
    body: "Policy: this workflow says do not use the network.",
    expected: [],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "policy-label",
      candidateBridge: "descriptive",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-conditional-secrets",
    body: "For safety, this workflow when offline must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "For safety, this workflow when offline must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "directive",
      candidateBridge: "conditional",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-local-upload",
    body: "Requirement: this workflow (during local setup) must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "Requirement: this workflow (during local setup) must not upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "policy-label",
      candidateBridge: "local",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-changed-helper-secrets",
    body: "Policy: this workflow: the helper must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Policy: this workflow: the helper must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "policy-label",
      candidateBridge: "changed-subject",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-supported-network",
    body: "Policy: this workflow must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Policy: this workflow must not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "policy-label",
      candidateBridge: "immediate",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-supported-upload",
    body: "For safety, this workflow must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "For safety, this workflow must not upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "directive",
      candidateBridge: "immediate",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-directive-supported-secrets",
    body: "Requirement: this workflow must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Requirement: this workflow must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      outerPrefix: "policy-label",
      candidateBridge: "immediate",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-semicolon-unknown-upload",
    body: "Finish validation; no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "no external uploads.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      separator: "semicolon",
      previousPredicate: "unknown",
      domain: "upload",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-semicolon-unknown-network",
    body: "Clean the workspace; never use the network.",
    expected: [],
    coverage: {
      group: "stabilization-cross-products",
      separator: "semicolon",
      previousPredicate: "unknown",
      domain: "network",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-semicolon-unknown-secrets",
    body: "Rotate the logs; never use credentials.",
    expected: [],
    coverage: {
      group: "stabilization-cross-products",
      separator: "semicolon",
      previousPredicate: "unknown",
      domain: "secrets",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-modal-never-network",
    body: "This workflow must never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow must never use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      predicateFamily: "modal-never",
      modal: "must",
      domain: "network",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-modal-never-upload",
    body: "This task must never upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task must never upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      predicateFamily: "modal-never",
      modal: "must",
      domain: "upload",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-modal-never-secrets",
    body: "The process must never use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The process must never use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      predicateFamily: "modal-never",
      modal: "must",
      domain: "secrets",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-relative-descriptive-network",
    body: "This workflow that documents logs must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow that documents logs must not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      modifier: "relative",
      qualification: "descriptive",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-relative-local-network",
    body: "This workflow, which validates inputs during setup, must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow, which validates inputs during setup, must not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      modifier: "paired-relative",
      qualification: "local",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-relative-target-network",
    body: "This workflow that documents network access to production must not use the network.",
    expected: [],
    coverage: {
      group: "stabilization-cross-products",
      modifier: "relative",
      qualification: "specific-target",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-relative-source-secrets",
    body: "This workflow that uses credentials from production must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that uses credentials from production must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      modifier: "relative",
      qualification: "specific-source",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-relative-target-upload",
    body: "This workflow, which uploads to a bucket, must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow, which uploads to a bucket, must not upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      modifier: "paired-relative",
      qualification: "specific-target",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-relative-conditional-secrets",
    body: "This workflow that runs when scheduled must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow that runs when scheduled must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      modifier: "relative",
      qualification: "conditional",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-homograph-copular-audits",
    body: "This workflow checks inputs but audits are reviewed, yet must not upload files.",
    expected: [],
    coverage: {
      group: "stabilization-cross-products",
      homograph: "audits",
      predicateHead: "copular",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-homograph-finite-reviews",
    body: "This workflow checks inputs but reviews require approval, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow checks inputs",
      },
    ],
    coverage: {
      group: "stabilization-cross-products",
      homograph: "reviews",
      predicateHead: "finite",
      layout: "one-line",
    },
  },
  {
    name: "stabilization2-homograph-finite-logs",
    body: "This workflow validates inputs but logs contain credentials, yet must not use the network.",
    expected: [],
    coverage: {
      group: "stabilization-cross-products",
      homograph: "logs",
      predicateHead: "finite",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-network",
    body: "Policy: this workflow validates inputs but must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Policy: this workflow validates inputs",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-network",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-upload",
    body: "For safety, this task requires external uploads and must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "For safety, this task requires external uploads and must not upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-upload",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-secrets",
    body: "Requirement: the process checks configuration, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Requirement: the process checks configuration,",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-secrets",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-relative",
    body: "Policy: this workflow, which validates inputs, must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "Policy: this workflow, which validates inputs, must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-relative",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-later-policy",
    body: "This workflow validates inputs; Policy: no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Policy: no external uploads.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "later-policy",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-later-directive",
    body: "This task prepares results; For safety, never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task prepares results",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "later-directive",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-modal-shared-network",
    body: "This workflow validates inputs but must never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "modal-shared-network",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-modifier-shared-secrets",
    body: "The process checks configuration but explicitly cannot use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The process checks configuration",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "modifier-shared-secrets",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-modifier-shared-secret-verb",
    body: "This task checks inputs but directly never uses credentials.",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "modifier-shared-secret-verb",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-modal-hard-network",
    body: "Validate inputs. Must never use the network.",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "modal-hard-network",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-modal-hard-upload",
    body: "Prepare the report. Shall never upload files.",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "modal-hard-upload",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-quoted-double",
    body: 'Documentation says "validate inputs; never use the network."',
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "quoted-double",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-quoted-single",
    body: "The example reads 'clean the workspace; no external uploads.'",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "no external uploads.'",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "quoted-single",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-quoted-curly",
    body: "The guide shows “rotate the logs; never use credentials.”",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "quoted-curly",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-object-relative-network",
    body: "This workflow, which the security team validates, must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "This workflow, which the security team validates, must not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "object-relative-network",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-object-relative-upload",
    body: "This task, which maintainers review, must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task, which maintainers review, must not upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "object-relative-upload",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-object-relative-secrets",
    body: "The process, which the owner audits, must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "The process, which the owner audits, must not use credentials.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "object-relative-secrets",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-paired-local",
    body: "Policy: this workflow, during local setup, must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "Policy: this workflow, during local setup, must not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-paired-local",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-paired-exception",
    body: "For safety, this workflow, except for approved domains, must not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "For safety, this workflow, except for approved domains, must not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-paired-exception",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-prefixed-paired-target",
    body: "Requirement: this workflow, to a public bucket, must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          "Requirement: this workflow, to a public bucket, must not upload files.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "prefixed-paired-target",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-relative-inner-prohibition",
    body: "This workflow,\nwhich the helper says must not use the network,\nmust not upload files.",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "relative-inner-prohibition",
      layout: "soft-wrap",
    },
  },
  {
    name: "stabilization3-homograph-use",
    body: "This workflow checks inputs but audits use the network, yet must not upload files.",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "homograph-use",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-homograph-upload",
    body: "This workflow validates inputs but reports upload files, yet must not use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow validates inputs",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "homograph-upload",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-subjectless-audits",
    body: "This workflow audits logs, then must not upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow audits logs,",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "subjectless-audits",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-ensure-that",
    body: "Ensure that no external uploads are allowed.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Ensure that no external uploads are allowed.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "ensure-that",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-make-sure-that",
    body: "Make sure that this workflow never uses credentials.",
    expected: [],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "make-sure-that",
      layout: "one-line",
    },
  },
  {
    name: "stabilization3-please-ensure-that",
    body: "Please ensure that the workflow does not use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Please ensure that the workflow does not use the network.",
      },
    ],
    coverage: {
      group: "stabilization-cross-product-composition",
      source: "please-ensure-that",
      layout: "one-line",
    },
  },
  {
    name: "stabilization4-quote-active-semicolon-network",
    body: 'This workflow documents "validate inputs; never use the network."',
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: 'This workflow documents "validate inputs',
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-active-subject",
      separator: "semicolon",
    },
  },
  {
    name: "stabilization4-quote-active-but-secrets",
    body: 'This workflow explains "check configuration but never use credentials."',
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: 'This workflow explains "check configuration',
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-active-subject",
      separator: "but",
    },
  },
  {
    name: "stabilization4-quote-active-and-upload",
    body: 'This workflow quotes "prepare the report and no external uploads."',
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          'This workflow quotes "prepare the report and no external uploads."',
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-active-subject",
      separator: "and",
    },
  },
  {
    name: "stabilization4-quote-active-comma-network",
    body: 'This workflow records "validate inputs, never use the network."',
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet:
          'This workflow records "validate inputs, never use the network."',
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-active-subject",
      separator: "comma",
    },
  },
  {
    name: "stabilization4-quote-standalone-period-network",
    body: 'Documentation says "Validate inputs. Never use the network."',
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-standalone",
      separator: "period",
    },
  },
  {
    name: "stabilization4-quote-standalone-exclamation-upload",
    body: 'The example reads "Clean the workspace! No external uploads."',
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: 'No external uploads."',
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-standalone",
      separator: "exclamation",
    },
  },
  {
    name: "stabilization4-quote-standalone-question-secrets",
    body: "The guide shows “Rotate the logs? Never use credentials.”",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-standalone",
      separator: "question",
    },
  },
  {
    name: "stabilization4-quote-curly-however-upload",
    body: "The guide shows ‘Prepare the report however, no external uploads.’",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "quote-standalone",
      separator: "however",
    },
  },
  {
    name: "stabilization4-relative-subject-network",
    body: "This workflow, which must not use the network, validates inputs.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "subject-relative",
      domain: "network",
    },
  },
  {
    name: "stabilization4-relative-subject-upload-soft-wrap",
    body: "This task,\nwhich cannot upload files,\nprepares the report.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "subject-relative",
      domain: "upload",
    },
  },
  {
    name: "stabilization4-relative-subject-secrets-heading",
    body: "## The process, which must never use credentials, checks configuration.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "subject-relative",
      domain: "secrets",
    },
  },
  {
    name: "stabilization4-relative-subject-local-network",
    body: "This workflow, which must not use the network during local setup, validates inputs.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "subject-relative-local",
      domain: "network",
    },
  },
  {
    name: "stabilization4-relative-subject-specific-upload",
    body: "This task, which cannot upload files to a public bucket, prepares the report.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "subject-relative-specific",
      domain: "upload",
    },
  },
  {
    name: "stabilization4-modal-might-network",
    body: "This workflow might never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow might never use the network.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "epistemic-modal",
      modal: "might",
    },
  },
  {
    name: "stabilization4-modal-could-upload",
    body: "This task could never upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task could never upload files.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "capability-modal",
      modal: "could",
    },
  },
  {
    name: "stabilization4-modal-can-secrets",
    body: "The process can never use credentials.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "The process can never use credentials.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "capability-modal",
      modal: "can",
    },
  },
  {
    name: "stabilization4-modal-would-network",
    body: "This workflow would never use the network.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This workflow would never use the network.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "hypothetical-modal",
      modal: "would",
    },
  },
  {
    name: "stabilization4-modal-should-upload",
    body: "This task should never upload files.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "This task should never upload files.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "recommendation-modal",
      modal: "should",
    },
  },
  {
    name: "stabilization4-modal-policy-may-upload",
    body: "Policy: may never upload files.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "policy-modal",
      modal: "may",
    },
  },
  {
    name: "stabilization4-modal-policy-should-network",
    body: "Policy: should never use the network.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "policy-modal",
      modal: "should",
    },
  },
  {
    name: "stabilization4-modal-policy-can-secrets",
    body: "Policy: can never use credentials.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "policy-modal",
      modal: "can",
    },
  },
  {
    name: "stabilization4-prefix-policy-please-network",
    body: "Policy: please do not use the network.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "composed-prefix",
      prefix: "policy-please",
    },
  },
  {
    name: "stabilization4-prefix-requirement-ensure-upload",
    body: "Requirement: ensure that no external uploads are allowed.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Requirement: ensure that no external uploads are allowed.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "composed-prefix",
      prefix: "requirement-ensure",
    },
  },
  {
    name: "stabilization4-prefix-policy-ensure-subject-secrets",
    body: "Policy: please ensure that this workflow never uses credentials.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "composed-prefix",
      prefix: "policy-please-ensure",
    },
  },
  {
    name: "stabilization4-prefix-safety-please-network",
    body: "For safety, please do not use the network.",
    expected: [],
    coverage: {
      group: "structural-stabilization",
      dimension: "composed-prefix",
      prefix: "safety-please",
    },
  },
  {
    name: "stabilization4-prefix-policy-safety-upload",
    body: "Policy: for safety, no external uploads.",
    expected: [
      {
        id: "SEC-BODY-POLICY-CONTRADICTION",
        severity: "high",
        startLine: 11,
        endLine: 11,
        snippet: "Policy: for safety, no external uploads.",
      },
    ],
    coverage: {
      group: "structural-stabilization",
      dimension: "composed-prefix",
      prefix: "policy-safety",
    },
  },
] as const satisfies readonly LegacyBodyPolicyGoldenCase[];

export const BODY_POLICY_0244_GOLDEN_CASES: readonly LegacyBodyPolicyGoldenCase[] =
  Object.freeze(
    RAW_BODY_POLICY_0244_GOLDEN_CASES.map((fixture) =>
      Object.freeze({
        ...fixture,
        coverage: Object.freeze({ ...fixture.coverage }),
        expected: Object.freeze(
          fixture.expected.map((finding) => Object.freeze({ ...finding })),
        ),
      }),
    ),
  );
