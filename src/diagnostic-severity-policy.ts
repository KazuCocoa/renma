import type { DiagnosticsConfig } from "./types/configuration.js";
import type { Finding } from "./types/diagnostics.js";
import { verifiedDiagnosticFindingSeverity } from "./diagnostic-default-severity.js";

export const REPOSITORY_SEVERITY_SOURCE = "repository_configuration" as const;

/**
 * Apply repository severity policy without mutating producer findings.
 * This runs before suppression so both active and suppressed evidence retain
 * the same effective severity and producer-default traceability.
 */
export function applyDiagnosticSeverityPolicy(
  findings: readonly Finding[],
  policy: DiagnosticsConfig,
): Finding[] {
  return findings.map((finding) => {
    const defaultSeverity = verifiedDiagnosticFindingSeverity(
      finding.id,
      finding.severity,
    );
    const effectiveSeverity = policy.severity[finding.id];
    if (effectiveSeverity === undefined) return finding;
    return {
      ...finding,
      severity: effectiveSeverity,
      details: {
        ...(finding.details ?? {}),
        defaultSeverity,
        severitySource: REPOSITORY_SEVERITY_SOURCE,
      },
    };
  });
}
