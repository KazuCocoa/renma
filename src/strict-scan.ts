import { severityMeets } from "./rules.js";
import type { ScanResult } from "./types/scan-result.js";

export const STRICT_SCAN_EVALUATION_SCHEMA_VERSION =
  "renma.strict-scan-evaluation.v1" as const;

export const STRICT_SCAN_MATCH_IDS = {
  FINDING_THRESHOLD: "strict_scan.finding_threshold",
  INVALID_AGENT_SKILL: "strict_scan.invalid_agent_skill",
  ERROR_DIAGNOSTIC: "strict_scan.error_diagnostic",
  INCOMPLETE_INSPECTION: "strict_scan.incomplete_inspection",
  INCOMPLETE_SECURITY_ANALYSIS: "strict_scan.incomplete_security_analysis",
} as const;

export type StrictScanMatchId =
  (typeof STRICT_SCAN_MATCH_IDS)[keyof typeof STRICT_SCAN_MATCH_IDS];

export interface StrictScanMatch {
  id: StrictScanMatchId;
  count: number;
  summary: string;
}

export interface StrictScanEvaluation {
  schemaVersion: typeof STRICT_SCAN_EVALUATION_SCHEMA_VERSION;
  outcome: "pass" | "fail";
  matches: StrictScanMatch[];
}

/** Evaluate strict target-state validity without parsing rendered messages. */
export function evaluateStrictScan(result: ScanResult): StrictScanEvaluation {
  const thresholdFindingCount = result.findings.filter((finding) =>
    severityMeets(finding.severity, result.exitThreshold),
  ).length;
  const errorDiagnosticCount = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const incompleteSecurityAnalysisCount =
    strictBlockingSecurityAnalysisIssues(result);
  const matches: StrictScanMatch[] = [];
  if (thresholdFindingCount > 0) {
    matches.push({
      id: STRICT_SCAN_MATCH_IDS.FINDING_THRESHOLD,
      count: thresholdFindingCount,
      summary: `Active findings met the configured ${result.exitThreshold} threshold.`,
    });
  }
  if (result.agentSkills.invalidSkillCount > 0) {
    matches.push({
      id: STRICT_SCAN_MATCH_IDS.INVALID_AGENT_SKILL,
      count: result.agentSkills.invalidSkillCount,
      summary: "One or more Agent Skills are specification-invalid.",
    });
  }
  if (errorDiagnosticCount > 0) {
    matches.push({
      id: STRICT_SCAN_MATCH_IDS.ERROR_DIAGNOSTIC,
      count: errorDiagnosticCount,
      summary: "Renma produced one or more error diagnostics.",
    });
  }
  if (result.inspectionCoverage.blockingIssues.length > 0) {
    matches.push({
      id: STRICT_SCAN_MATCH_IDS.INCOMPLETE_INSPECTION,
      count: result.inspectionCoverage.blockingIssues.length,
      summary:
        "Expected agent-facing artifacts could not be inspected completely.",
    });
  }
  if (incompleteSecurityAnalysisCount > 0) {
    matches.push({
      id: STRICT_SCAN_MATCH_IDS.INCOMPLETE_SECURITY_ANALYSIS,
      count: incompleteSecurityAnalysisCount,
      summary:
        "Applicable YAML frontmatter-comment analysis could not be completed safely.",
    });
  }
  return {
    schemaVersion: STRICT_SCAN_EVALUATION_SCHEMA_VERSION,
    outcome: matches.length > 0 ? "fail" : "pass",
    matches,
  };
}

/** Count only applicable parser-owned YAML comment surfaces that failed closed. */
function strictBlockingSecurityAnalysisIssues(result: ScanResult): number {
  return result.securityAnalysisCoverage.artifacts.filter(
    (artifact) =>
      artifact.analyses.yamlFrontmatterComments === "not-analyzable",
  ).length;
}
