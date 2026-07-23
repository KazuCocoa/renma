import type { AgentSkillsValidationSummary } from "../agent-skills.js";
import type { ContextLensSummary } from "../context-lens.js";
import type { SecurityPolicyInventorySummary } from "../security-policy-inventory.js";
import type { TrustGraph } from "../trust-graph.js";
import type {
  Diagnostic,
  DiagnosticV2,
  Finding,
  ReviewBundle,
  Severity,
} from "./diagnostics.js";

/** Complete result returned by a scan operation. */
export interface ScanResult {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  format: "text" | "json";
  agentSkills: AgentSkillsValidationSummary;
  contextLens?: ContextLensSummary;
  securityPolicyInventory?: SecurityPolicyInventorySummary;
  trustGraph?: TrustGraph;
  findings: Finding[];
  diagnostics: Diagnostic[];
  diagnosticsV2: DiagnosticV2[];
  reviewBundles: ReviewBundle[];
  exitThreshold: Severity;
}
