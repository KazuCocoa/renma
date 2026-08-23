import type { AgentSkillsValidationSummary } from "../agent-skills.js";
import type { ContextLensSummary } from "../context-lens.js";
import type { ExecutableSurfaceInventory } from "../executable-surface-inventory.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { TrustGraph } from "../trust-graph.js";
import type { EffectiveScanBoundaryEvidence } from "../scan-boundary.js";
import type { InspectionCoverage } from "../inspection-coverage.js";
import type { SecurityAnalysisCoverage } from "./security-analysis-coverage.js";
import type {
  Diagnostic,
  DiagnosticV2,
  Finding,
  ReviewBundle,
  Severity,
  SuppressedDiagnosticEvidence,
  SuppressedFindingEvidence,
} from "./diagnostics.js";

/** Stable schema identifier for the serialized scan JSON document. */
export const SCAN_JSON_SCHEMA_VERSION = "renma.scan.v2" as const;

/** Core result returned by a scan operation before wire-format serialization. */
export interface ScanResult {
  root: string;
  configPath?: string;
  scanBoundary: EffectiveScanBoundaryEvidence;
  inspectionCoverage: InspectionCoverage;
  securityAnalysisCoverage: SecurityAnalysisCoverage;
  scannedFileCount: number;
  format: "text" | "json";
  agentSkills: AgentSkillsValidationSummary;
  contextLens?: ContextLensSummary;
  executableSurfaceInventory?: ExecutableSurfaceInventory;
  securityPolicyInventory?: SecurityPolicyInventorySummary;
  trustGraph?: TrustGraph;
  findings: Finding[];
  suppressedFindings: SuppressedFindingEvidence[];
  diagnostics: Diagnostic[];
  diagnosticsV2: DiagnosticV2[];
  reviewBundles: ReviewBundle[];
  exitThreshold: Severity;
}

/** Public JSON document emitted by `formatJson()` and `scan --format json`. */
export interface ScanJsonDocument {
  schemaVersion: typeof SCAN_JSON_SCHEMA_VERSION;
  root: string;
  configPath?: string;
  scanBoundary: EffectiveScanBoundaryEvidence;
  inspectionCoverage: InspectionCoverage;
  securityAnalysisCoverage: SecurityAnalysisCoverage;
  scannedFileCount: number;
  format: "json";
  agentSkills: AgentSkillsValidationSummary;
  contextLens?: ContextLensSummary;
  executableSurfaceInventory?: ExecutableSurfaceInventory;
  securityPolicyInventory?: SecurityPolicyInventorySummary;
  trustGraph?: TrustGraph;
  diagnostics: DiagnosticV2[];
  suppressedDiagnostics: SuppressedDiagnosticEvidence[];
  reviewBundles: ReviewBundle[];
  exitThreshold: Severity;
}
