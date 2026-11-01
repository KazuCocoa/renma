import {
  buildSecurityDiffSummary,
  type SecurityDiffSummary,
} from "../security-diff.js";
import { securityPolicyRelaxations } from "../security-policy-ci-policy.js";
import { formatMarkdownInlineCode } from "./markdown-inline-code.js";
import {
  DIFF_DETAIL_LIMIT,
  formatPolicyOverflow,
  formatSignedNumber,
} from "./diff-format.js";
import type {
  SecurityPolicyAssetChange,
  SecurityPolicyChangeProvenance,
  SecurityPolicyChangeSource,
  SecurityPolicyFieldChange,
  SharedSecurityPolicyChange,
} from "../security-policy-diff.js";

export function formatSecurityChanges(
  security: SecurityDiffSummary | undefined,
): string[] {
  const { posture, policyInventory } =
    security ??
    buildSecurityDiffSummary({
      addedFindings: [],
      removedFindings: [],
    });
  const relaxations = security ? securityPolicyRelaxations(security) : [];
  const lines = [
    ...(relaxations.length > 0
      ? [
          "### Security policy relaxations",
          "",
          ...relaxations
            .slice(0, DIFF_DETAIL_LIMIT)
            .map(formatSecurityPolicyRelaxation),
          ...formatPolicyOverflow(relaxations.length, 0),
          "",
          "### Aggregate security metrics",
          "",
        ]
      : []),
    `- Added security findings: ${posture.added.totalSecurityFindings}`,
    `- Resolved security findings: ${posture.resolved.totalSecurityFindings}`,
    `- Added violations: ${posture.added.riskClasses.violation}`,
    `- Added suspicious: ${posture.added.riskClasses.suspicious}`,
    `- Added advisory: ${posture.added.riskClasses.advisory}`,
    `- Resolved violations: ${posture.resolved.riskClasses.violation}`,
    `- Resolved suspicious: ${posture.resolved.riskClasses.suspicious}`,
    `- Resolved advisory: ${posture.resolved.riskClasses.advisory}`,
    `- Policy assets: ${formatSignedNumber(policyInventory.totalPolicyAssets)}`,
    `- Assets with local policy metadata: ${formatSignedNumber(policyInventory.assetsWithLocalPolicyMetadata)}`,
    `- Assets with inherited policy: ${formatSignedNumber(policyInventory.assetsWithInheritedPolicy)}`,
    `- Assets with effective policy: ${formatSignedNumber(policyInventory.assetsWithEffectivePolicy)}`,
    `- Assets without effective policy: ${formatSignedNumber(policyInventory.assetsWithoutEffectivePolicy)}`,
    `- Effective policy from local metadata: ${formatSignedNumber(policyInventory.policySources.local)}`,
    `- Effective policy from security profiles: ${formatSignedNumber(policyInventory.policySources.security_profile)}`,
    `- Effective policy from repository config: ${formatSignedNumber(policyInventory.policySources.repository_config)}`,
    `- Effective policy from owning Skills: ${formatSignedNumber(policyInventory.policySources.owning_skill)}`,
    `- Network allowed: ${formatSignedNumber(policyInventory.networkAllowed.true)}`,
    `- Network denied: ${formatSignedNumber(policyInventory.networkAllowed.false)}`,
    ...(policyInventory.externalUploadGovernance
      ? [
          `- Upload denied: ${formatSignedNumber(policyInventory.externalUploadGovernance.denied)}`,
          `- Upload allowed; approval required: ${formatSignedNumber(policyInventory.externalUploadGovernance.allowedApprovalRequired)}`,
          `- Upload allowed; approval not required: ${formatSignedNumber(policyInventory.externalUploadGovernance.allowedNoApprovalRequired)}`,
          `- Upload allowed; approval requirement unspecified: ${formatSignedNumber(policyInventory.externalUploadGovernance.allowedApprovalUnspecified)}`,
          `- Upload permission unspecified: ${formatSignedNumber(policyInventory.externalUploadGovernance.unspecified)}`,
        ]
      : [
          `- External upload allowed: ${formatSignedNumber(policyInventory.externalUploadAllowed.true)}`,
          `- External upload denied: ${formatSignedNumber(policyInventory.externalUploadAllowed.false)}`,
        ]),
    `- Secrets allowed: ${formatSignedNumber(policyInventory.secretsAllowed.true)}`,
    `- Secrets denied: ${formatSignedNumber(policyInventory.secretsAllowed.false)}`,
    `- Human approval required: ${formatSignedNumber(policyInventory.humanApprovalRequired.true)}`,
    `- Approved network destinations: ${formatSignedNumber(policyInventory.approvedNetworkDestinationCount)}`,
    `- Approved upload destinations: ${formatSignedNumber(policyInventory.approvedUploadDestinationCount)}`,
    `- Forbidden inputs: ${formatSignedNumber(policyInventory.forbiddenInputCount)}`,
    `- Missing security profiles: ${formatSignedNumber(policyInventory.securityProfiles.missing)}`,
    `- Cyclic security profiles: ${formatSignedNumber(policyInventory.securityProfiles.cyclic)}`,
  ];
  const policyChanges = security?.policyChanges ?? [];
  const sharedPolicyChanges = security?.sharedPolicyChanges ?? [];
  if (policyChanges.length > 0) {
    lines.push(
      "",
      "### Effective security policy boundary changes",
      "",
      ...policyChanges
        .slice(0, DIFF_DETAIL_LIMIT)
        .flatMap(formatSecurityPolicyAssetChange),
      ...formatPolicyOverflow(policyChanges.length, 0),
    );
  }
  if (sharedPolicyChanges.length > 0) {
    lines.push("", "### Shared policy blast radius", "");
    lines.push(
      ...sharedPolicyChanges
        .slice(0, DIFF_DETAIL_LIMIT)
        .flatMap(formatSharedSecurityPolicyChange),
      ...formatPolicyOverflow(sharedPolicyChanges.length, 0),
    );
  }
  return lines;
}

function formatSecurityPolicyRelaxation(
  relaxation: ReturnType<typeof securityPolicyRelaxations>[number],
): string {
  const asset = `${formatMarkdownInlineCode(relaxation.asset.id)} (${formatMarkdownInlineCode(relaxation.asset.path)})`;
  if (relaxation.kind === "scalar") {
    return `- ${asset}: ${relaxation.property} ${relaxation.fromState} -> ${relaxation.toState}`;
  }
  const values =
    relaxation.direction === "allowed_value_added"
      ? relaxation.addedValues
      : relaxation.removedValues;
  const action =
    relaxation.direction === "allowed_value_added"
      ? "allowed value added"
      : "restricted value removed";
  const overflow =
    values.length > DIFF_DETAIL_LIMIT
      ? `; ${values.length - DIFF_DETAIL_LIMIT} more not shown`
      : "";
  return `- ${asset}: ${relaxation.property} — ${action}: ${formatPolicyValues(values)}${overflow}`;
}

function formatSecurityPolicyAssetChange(
  change: SecurityPolicyAssetChange,
): string[] {
  const lines = [
    `- ${formatMarkdownInlineCode(change.asset.id)} (${formatMarkdownInlineCode(change.asset.path)})`,
  ];
  for (const field of change.fields) {
    lines.push(...formatSecurityPolicyFieldChange(field));
    if (
      field.kind === "scalar" &&
      field.field === "networkAllowed" &&
      field.after === true
    ) {
      lines.push(
        ...formatEffectiveDestinationScope(
          "Effective approved network destinations after",
          change.after?.approvedNetworkDestinations ?? [],
        ),
      );
    }
    if (
      field.kind === "scalar" &&
      field.field === "externalUploadAllowed" &&
      field.after === true
    ) {
      lines.push(
        ...formatEffectiveDestinationScope(
          "Effective approved upload destinations after",
          change.after?.approvedUploadDestinations ?? [],
        ),
      );
    }
  }
  return lines;
}

function formatSecurityPolicyFieldChange(
  change: SecurityPolicyFieldChange,
): string[] {
  const label = securityPolicyFieldLabel(change.field);
  const provenance = formatPolicyProvenance(change.provenance);
  if (change.kind === "scalar") {
    return [
      `  - ${label} (${provenance}): ${formatPolicyScalar(change.before)} -> ${formatPolicyScalar(change.after)}`,
    ];
  }
  const lines = [`  - ${label} (${provenance}):`];
  if (change.added.length > 0) {
    lines.push(
      `    - Added: ${formatPolicyValues(change.added)}`,
      ...formatPolicyOverflow(change.added.length, 4),
    );
  }
  if (change.removed.length > 0) {
    lines.push(
      `    - Removed: ${formatPolicyValues(change.removed)}`,
      ...formatPolicyOverflow(change.removed.length, 4),
    );
  }
  return lines;
}

function formatSharedSecurityPolicyChange(
  change: SharedSecurityPolicyChange,
): string[] {
  const count = change.affectedAssets.length;
  const noun = count === 1 ? "asset receives" : "assets receive";
  const lines = [
    `- ${formatPolicySource(change.source)}: ${count} ${noun} an effective policy change; fields: ${change.changedFields.map(securityPolicyFieldLabel).join(", ")}`,
  ];
  lines.push(
    ...change.affectedAssets
      .slice(0, DIFF_DETAIL_LIMIT)
      .map(
        (asset) =>
          `  - ${formatMarkdownInlineCode(asset.id)} (${formatMarkdownInlineCode(asset.path)})`,
      ),
    ...formatPolicyOverflow(change.affectedAssets.length, 2),
  );
  return lines;
}

function formatPolicyProvenance(
  provenance: SecurityPolicyChangeProvenance,
): string {
  if (provenance.mode === "unresolved") {
    if (provenance.sources.length === 0) return "provenance unresolved";
    return `provenance unresolved; known source${provenance.sources.length === 1 ? "" : "s"}: ${provenance.sources.map(formatPolicySource).join(", ")}`;
  }
  const mode =
    provenance.mode === "direct"
      ? "direct"
      : provenance.mode === "inherited"
        ? "inherited"
        : "direct and inherited";
  return `${mode}; source${provenance.sources.length === 1 ? "" : "s"}: ${provenance.sources.map(formatPolicySource).join(", ")}`;
}

function formatPolicySource(source: SecurityPolicyChangeSource): string {
  const location = source.path
    ? ` at ${formatMarkdownInlineCode(source.path)}`
    : "";
  if (source.type === "asset") {
    return `asset ${formatMarkdownInlineCode(source.id)}${location}`;
  }
  if (source.type === "owning_skill") {
    return `owning Skill ${formatMarkdownInlineCode(source.id)}${location}`;
  }
  if (source.type === "security_profile") {
    return `security profile ${formatMarkdownInlineCode(source.id)}${location}`;
  }
  return `repository security configuration${location}`;
}

function securityPolicyFieldLabel(
  field: SecurityPolicyFieldChange["field"],
): string {
  switch (field) {
    case "networkAllowed":
      return "Network allowed";
    case "approvedNetworkDestinations":
      return "Approved network destinations";
    case "externalUploadAllowed":
      return "External upload allowed";
    case "approvedUploadDestinations":
      return "Approved upload destinations";
    case "allowedData":
      return "Allowed data";
    case "forbiddenInputs":
      return "Forbidden inputs";
    case "secretsAllowed":
      return "Secrets allowed";
    case "humanApprovalRequired":
      return "Human approval required";
    case "disallowedCommands":
      return "Disallowed commands";
  }
}

function formatPolicyScalar(value: boolean | null): string {
  return value === null ? "unspecified" : String(value);
}

function formatPolicyValues(values: readonly string[]): string {
  return values
    .slice(0, DIFF_DETAIL_LIMIT)
    .map(formatMarkdownInlineCode)
    .join(", ");
}

function formatEffectiveDestinationScope(
  label: string,
  values: readonly string[],
): string[] {
  if (values.length === 0) return [`  - ${label}: none declared`];
  return [
    `  - ${label}: ${formatPolicyValues(values)}`,
    ...formatPolicyOverflow(values.length, 4),
  ];
}
