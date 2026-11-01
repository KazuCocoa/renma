import type { ScanBoundaryDiff } from "../scan-boundary-diff.js";
import type { QualityPolicyThresholdChange } from "../quality-policy-diff.js";
import type { MetadataPolicyRequiredFieldChange } from "../metadata-policy-diff.js";
import type { DiagnosticSeverityPolicyChange } from "../diagnostic-severity-policy-diff.js";
import { formatMarkdownInlineCode } from "./markdown-inline-code.js";

export function formatScanBoundaryChange(
  change: ScanBoundaryDiff["changes"][number],
): string {
  const direction =
    change.direction === "weakening" ? "WEAKENING" : "tightening";
  if (change.kind === "glob" || change.kind === "exclusion") {
    return `- ${direction}: ${change.kind} ${change.change} ${formatMarkdownInlineCode(change.pattern)}`;
  }
  if (change.kind === "limit") {
    return `- ${direction}: ${change.property} ${change.from} -> ${change.to}`;
  }
  const expires =
    change.suppression.fromExpires === null
      ? `expires ${change.suppression.toExpires}`
      : change.suppression.toExpires === null
        ? `expires ${change.suppression.fromExpires}`
        : `expires ${change.suppression.fromExpires} -> ${change.suppression.toExpires}`;
  return `- ${direction}: suppression ${change.change} ${formatMarkdownInlineCode(change.suppression.id)} at ${formatMarkdownInlineCode(change.suppression.path)}; ${expires}`;
}

export function formatQualityPolicyChange(
  change: QualityPolicyThresholdChange,
): string {
  const direction =
    change.direction === "weakening" ? "WEAKENING" : "tightening";
  return `- ${direction}: ${change.assetKind} ${change.thresholdType} ${change.from.value} (${change.from.source}) -> ${change.to.value} (${change.to.source}); ${formatMarkdownInlineCode(change.configKey)}`;
}

export function formatMetadataPolicyChange(
  change: MetadataPolicyRequiredFieldChange,
): string {
  const direction =
    change.direction === "weakening" ? "WEAKENING" : "tightening";
  return `- ${direction}: required ${formatMarkdownInlineCode(change.field)} ${formatMetadataRequirementEndpoint(change.from)} -> ${formatMetadataRequirementEndpoint(change.to)}; ${formatMarkdownInlineCode(change.configKey)}`;
}

export function formatDiagnosticSeverityPolicyChange(
  change: DiagnosticSeverityPolicyChange,
): string {
  const direction = formatDiagnosticSeverityDirection(change.direction);
  const from = change.from.severity ?? "(producer default unknown)";
  const to = change.to.severity ?? "(producer default unknown)";
  return `- ${direction}: ${formatMarkdownInlineCode(change.diagnosticId)} ${from} (${change.from.source}) -> ${to} (${change.to.source}); ${formatMarkdownInlineCode(change.configKey)}`;
}

function formatDiagnosticSeverityDirection(
  direction: DiagnosticSeverityPolicyChange["direction"],
): string {
  if (direction === "weakening") return "WEAKENING";
  if (direction === "tightening") return "tightening";
  if (direction === "neutral") return "neutral";
  return "REVIEW REQUIRED";
}

function formatMetadataRequirementEndpoint(
  endpoint: MetadataPolicyRequiredFieldChange["from"],
): string {
  if (endpoint.provenance.source === "renma_default") {
    return `${endpoint.required ? "required" : "not required"} (renma default)`;
  }
  return `${endpoint.required ? "required" : "not required"} (repository configuration ${formatMarkdownInlineCode(endpoint.provenance.configPath ?? "(explicit config path)")})`;
}
