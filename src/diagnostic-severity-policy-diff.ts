import { compareUtf16CodeUnits } from "./canonical-json.js";
import type { DiagnosticsConfig } from "./types/configuration.js";
import type { Severity } from "./types/diagnostics.js";

export const DIAGNOSTIC_SEVERITY_POLICY_DIFF_SCHEMA_VERSION =
  "renma.diagnostic-severity-policy-diff.v1" as const;

export type DiagnosticSeverityPolicyChangeDirection =
  "weakening" | "tightening";
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
}

export interface ObservedDiagnosticDefaultSeverities {
  from?: Readonly<Record<string, Severity>>;
  to?: Readonly<Record<string, Severity>>;
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
  observedDefaults: ObservedDiagnosticDefaultSeverities = {},
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
    const fromDefault = observedDefaults.from?.[diagnosticId];
    const toDefault = observedDefaults.to?.[diagnosticId];
    const producerDefault = toDefault ?? fromDefault;
    const direction = changeDirection(
      change,
      fromOverride,
      toOverride,
      producerDefault,
    );
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
  };
}

function changeDirection(
  change: DiagnosticSeverityPolicyChangeKind,
  fromOverride: Severity | undefined,
  toOverride: Severity | undefined,
  toDefault: Severity | undefined,
): DiagnosticSeverityPolicyChangeDirection {
  if (change === "removed") return "weakening";
  if (change === "added") {
    return toDefault !== undefined &&
      toOverride !== undefined &&
      SEVERITY_RANK[toOverride] < SEVERITY_RANK[toDefault]
      ? "weakening"
      : "tightening";
  }
  return SEVERITY_RANK[toOverride!] < SEVERITY_RANK[fromOverride!]
    ? "weakening"
    : "tightening";
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
