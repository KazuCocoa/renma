/** Finding severity used for scan reports and failure thresholds. */
export type Severity = "low" | "medium" | "high" | "critical";

/** Security review taxonomy for static scan findings. */
export type RiskClass = "violation" | "suspicious" | "advisory";

/** Source location and snippet used to justify a finding. */
export interface Evidence {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

/** Location shape used by LLM-actionable diagnostics v2. */
export interface DiagnosticLocation {
  path: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
}

/** Repair guardrail attached to an LLM-actionable diagnostic. */
export interface RepairConstraint {
  kind:
    | "must_preserve"
    | "must_not_change"
    | "allowed_change"
    | "requires_human_decision"
    | "risk";
  text: string;
}

/** Verification step attached to an LLM-actionable diagnostic. */
export interface VerificationStep {
  text: string;
  command?: string;
  expected?: string;
}

/** Normalized diagnostic shape for LLM-assisted and human repair workflows. */
export interface DiagnosticV2 {
  version: 2;
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  repairPolicy?: "preserve_semantics";
  location?: DiagnosticLocation;
  relatedLocations?: DiagnosticLocation[];
  repairConstraints?: RepairConstraint[];
  verificationSteps?: VerificationStep[];
  llmHint?: string;
  details?: Record<string, unknown>;
}

/** Compact grouping of related diagnostics for review. */
export interface ReviewBundle {
  id: string;
  title: string;
  summary: string;
  severity: "error" | "warning" | "info";
  diagnosticCodes: string[];
  diagnosticIds?: string[];
  affectedAssets?: string[];
  affectedFiles?: string[];
  suggestedReviewOrder?: string[];
  llmHint?: string;
}

/** Rule finding emitted by deterministic scans. */
export interface Finding {
  id: string;
  title: string;
  category: "quality" | "safety" | "structure" | "maintenance";
  severity: Severity;
  confidence: "low" | "medium" | "high";
  riskClass?: RiskClass;
  evidence: Evidence;
  whyItMatters: string;
  remediation: string;
  constraints?: string[];
  repairConstraints?: RepairConstraint[];
  verificationSteps?: string[];
  verificationStepsV2?: VerificationStep[];
  llmHint?: string;
  details?: Record<string, unknown>;
}

/** Configured finding suppression scoped to rule id and repository paths. */
export interface SuppressionConfig {
  id: string;
  paths: string[];
  reason: string;
  expires?: SuppressionExpiration;
}

/** Supported suppression expiration values. */
export type SuppressionExpiration = "never" | `${number}-${number}-${number}`;

/** Non-finding diagnostic produced while loading, discovering, or parsing input. */
export interface Diagnostic {
  code?: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
  evidence?: Evidence;
  repairConstraints?: RepairConstraint[];
  verificationSteps?: VerificationStep[];
  llmHint?: string;
  details?: Record<string, unknown>;
}
