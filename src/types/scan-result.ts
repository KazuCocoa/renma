import type { AgentSkillsValidationSummary } from "../agent-skills.js";
import type { ContextLensSummary } from "../context-lens.js";
import type { ExecutableSurfaceInventory } from "../executable-surface-inventory.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { TrustGraph } from "../trust-graph.js";
import type { EffectiveScanBoundaryEvidence } from "../scan-boundary.js";
import type { InspectionCoverage } from "../inspection-coverage.js";
import type {
  Diagnostic,
  DiagnosticV2,
  Finding,
  ReviewBundle,
  Severity,
  SuppressedFindingEvidence,
} from "./diagnostics.js";

/** Complete result returned by a scan operation. */
export interface ScanResult {
  root: string;
  configPath?: string;
  scanBoundary: EffectiveScanBoundaryEvidence;
  inspectionCoverage: InspectionCoverage;
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
