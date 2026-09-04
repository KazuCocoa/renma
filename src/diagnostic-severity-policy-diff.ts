import { compareUtf16CodeUnits } from "./canonical-json.js";
import { diagnosticDefaultSeverity } from "./diagnostic-default-severity.js";
import type { DiagnosticsConfig } from "./types/configuration.js";
import type { Severity } from "./types/diagnostics.js";

export const DIAGNOSTIC_SEVERITY_POLICY_DIFF_SCHEMA_VERSION =
  "renma.diagnostic-severity-policy-diff.v1" as const;

export type DiagnosticSeverityPolicyChangeDirection =
  "weakening" | "tightening" | "neutral" | "review_required";
export type DiagnosticSeverityPolicyChangeKind =
  "added" | "removed" | "changed";

export interface DiagnosticSeverityPolicyEndpoint {
  severity: Severity | null;
  source: "producer_default" | "repository_configuration";
  configPath: string | null;
}

export interface DiagnosticSeverityPolicyChange {
  diagnosticId: string;
  configKey: string;
  change: DiagnosticSeverityPolicyChangeKind;
  direction: DiagnosticSeverityPolicyChangeDirection;
  from: DiagnosticSeverityPolicyEndpoint;
  to: DiagnosticSeverityPolicyEndpoint;
}

export interface DiagnosticSeverityPolicyDiff {
  schemaVersion: typeof DIAGNOSTIC_SEVERITY_POLICY_DIFF_SCHEMA_VERSION;
  changes: DiagnosticSeverityPolicyChange[];
  strengthenedDiagnosticIds: string[];
  weakenedDiagnosticIds: string[];
  neutralDiagnosticIds: string[];
  reviewRequiredDiagnosticIds: string[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Compare explicit repository severity policy in stable diagnostic-id order. */
export function buildDiagnosticSeverityPolicyDiff(
  from: DiagnosticsConfig,
  to: DiagnosticsConfig,
  fromConfigPath?: string,
  toConfigPath?: string,
): DiagnosticSeverityPolicyDiff {
  const ids = [
    ...new Set([...Object.keys(from.severity), ...Object.keys(to.severity)]),
  ].sort(compareUtf16CodeUnits);
  const changes = ids.flatMap((diagnosticId) => {
    const fromOverride = from.severity[diagnosticId];
    const toOverride = to.severity[diagnosticId];
    if (fromOverride === toOverride) return [];
    const change: DiagnosticSeverityPolicyChangeKind =
      fromOverride === undefined
        ? "added"
        : toOverride === undefined
          ? "removed"
          : "changed";
    const producerDefault = diagnosticDefaultSeverity(diagnosticId);
    const fromEffective = fromOverride ?? producerDefault;
    const toEffective = toOverride ?? producerDefault;
    const direction = changeDirection(fromEffective, toEffective);
    return [
      {
        diagnosticId,
        configKey: `diagnostics.severity.${diagnosticId}`,
        change,
        direction,
        from: endpoint(fromOverride, producerDefault, fromConfigPath),
        to: endpoint(toOverride, producerDefault, toConfigPath),
      },
    ];
  });

  return {
    schemaVersion: DIAGNOSTIC_SEVERITY_POLICY_DIFF_SCHEMA_VERSION,
    changes,
    strengthenedDiagnosticIds: changes
      .filter((change) => change.direction === "tightening")
      .map((change) => change.diagnosticId),
    weakenedDiagnosticIds: changes
      .filter((change) => change.direction === "weakening")
      .map((change) => change.diagnosticId),
    neutralDiagnosticIds: changes
      .filter((change) => change.direction === "neutral")
      .map((change) => change.diagnosticId),
    reviewRequiredDiagnosticIds: changes
      .filter((change) => change.direction === "review_required")
      .map((change) => change.diagnosticId),
  };
}

function changeDirection(
  fromEffective: Severity | undefined,
  toEffective: Severity | undefined,
): DiagnosticSeverityPolicyChangeDirection {
  if (fromEffective === undefined || toEffective === undefined) {
    return "review_required";
  }
  if (SEVERITY_RANK[toEffective] < SEVERITY_RANK[fromEffective]) {
    return "weakening";
  }
  if (SEVERITY_RANK[toEffective] > SEVERITY_RANK[fromEffective]) {
    return "tightening";
  }
  return "neutral";
}

function endpoint(
  override: Severity | undefined,
  producerDefault: Severity | undefined,
  configPath: string | undefined,
): DiagnosticSeverityPolicyEndpoint {
  return override === undefined
    ? {
        severity: producerDefault ?? null,
        source: "producer_default",
        configPath: null,
      }
    : {
        severity: override,
        source: "repository_configuration",
        configPath: configPath ?? null,
      };
}
