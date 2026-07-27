export interface LegacyBodyPolicyFindingProjection {
  readonly id: string;
  readonly severity: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
}

export const BODY_POLICY_0244_GOLDEN_SOURCE = {
  tag: "v0.24.4",
  commit: "9e72e1a",
} as const;

const finding = (
  snippet: string,
): readonly LegacyBodyPolicyFindingProjection[] => [
  {
    id: "SEC-BODY-POLICY-CONTRADICTION",
    severity: "high",
    startLine: 11,
    endLine: 11,
    snippet,
  },
];

/**
 * Exact public projections generated once from Renma 0.24.4. Corpus cases not
 * listed here produced no body-policy contradiction finding.
 */
export const BODY_POLICY_0244_FINDINGS_BY_CASE: Readonly<
  Record<string, readonly LegacyBodyPolicyFindingProjection[]>
> = {
  "two-01-one-line-unrelated-same-network": finding(
    "This workflow validates inputs and must not use the network.",
  ),
  "two-02-one-line-unrelated-cross-upload": finding(
    "This task validates inputs and also must not upload files.",
  ),
  "two-03-one-line-requirement-same-secrets": finding(
    "The process requires credentials",
  ),
  "two-11-one-line-workflow-prohibition-same-upload": finding(
    "This workflow must not upload files",
  ),
  "two-12-one-line-workflow-prohibition-cross-secrets": finding(
    "This task must not use the network,",
  ),
  "two-23-soft-wrap-workflow-prohibition-same-upload": finding(
    "The process must not upload files",
  ),
  "two-24-soft-wrap-workflow-prohibition-cross-secrets": finding(
    "This run must not use the network.",
  ),
  "two-35-hard-break-workflow-prohibition-same-upload": finding(
    "The operation must not upload files",
  ),
  "two-37-heading-unrelated-same-network": finding(
    "## This task validates inputs",
  ),
  "two-38-heading-unrelated-cross-upload": finding(
    "## The process validates inputs",
  ),
  "two-39-heading-requirement-same-secrets": finding(
    "## This run requires credentials",
  ),
  "two-47-heading-workflow-prohibition-same-upload": finding(
    "## This task must not upload files",
  ),
  "two-48-heading-workflow-prohibition-cross-secrets": finding(
    "## The process must not use the network.",
  ),
  "domain-order-and-deduplication": [
    ...finding("This workflow must not use the network."),
    ...finding("This workflow must not upload files."),
    ...finding("This workflow must not use credentials."),
  ],
  "stabilization-unrelated-workflow": finding("This workflow validates inputs"),
  "stabilization-unrelated-task": finding("This task prepares the report,"),
  "stabilization-unrelated-process": finding(
    "The process checks configuration",
  ),
  "stabilization-three-secrets": finding(
    "This workflow requires network access",
  ),
  "stabilization-modifier-still": finding(
    "This workflow requires network access",
  ),
  "stabilization-modifier-also": finding("This workflow requires credentials"),
  "stabilization-heading": finding("## This workflow requires network access"),
  "stabilization-bare-semicolon": finding(
    "This workflow requires network access",
  ),
  "stabilization-then": finding("This workflow requires network access"),
};
