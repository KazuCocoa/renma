import type { AgentSkillsValidationSummary } from "./agent-skills.js";
import type { ContextLensSummary } from "./context-lens.js";
import type { SecurityPolicyInventorySummary } from "./security-policy-inventory.js";
import type { TrustGraph } from "./trust-graph.js";

/** Finding severity used for scan reports and failure thresholds. */
export type Severity = "low" | "medium" | "high" | "critical";

/** Security review taxonomy for static scan findings. */
export type RiskClass = "violation" | "suspicious" | "advisory";

/** Classified artifact kind discovered from repository paths. */
export type ArtifactKind =
  | "skill"
  | "agent"
  | "context"
  | "context_lens"
  | "profile"
  | "reference"
  | "example"
  | "config"
  | "unknown";

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

/** Repository layout mapping used by strict three-root policy diagnostics. */
export interface LayoutPolicyConfig {
  toolNamespace?: string;
  workflowAliases: Record<string, string>;
}

export interface SecurityProfileConfig {
  allowedDataClass?: string | undefined;
  networkAllowed?: boolean | undefined;
  externalUploadAllowed?: boolean | undefined;
  secretsAllowed?: boolean | undefined;
  humanApprovalRequired?: boolean | undefined;
  securityProfile?: string | undefined;
  allowedData: string[];
  forbiddenInputs: string[];
  approvedDomains: string[];
  approvedUploadDomains: string[];
  disallowedCommands: string[];
}

export interface SecurityConfig {
  approvedDomains: string[];
  approvedUploadDomains: string[];
  disallowedCommands: string[];
  profiles?: Record<string, SecurityProfileConfig> | undefined;
}

/** Effective scan configuration after defaults, config files, and CLI overrides. */
export interface ScanConfig {
  failOn: Severity;
  format: "text" | "json";
  globs: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  concurrency: number;
  suppressions: SuppressionConfig[];
  layout: LayoutPolicyConfig;
  security: SecurityConfig;
}

/** Loaded configuration plus the path it came from, when applicable. */
export interface LoadedConfig {
  config: ScanConfig;
  configPath?: string;
}

/** File artifact read from the scanned repository. */
export interface Artifact {
  path: string;
  absolutePath: string;
  kind: ArtifactKind;
  sizeBytes: number;
  content: string;
}

/** Markdown heading extracted from a parsed artifact. */
export interface Heading {
  depth: number;
  text: string;
  line: number;
}

/** Markdown fenced code block extracted from a parsed artifact. */
export interface CodeFence {
  language: string;
  content: string;
  startLine: number;
  endLine: number;
}

/** Markdown link extracted from a parsed artifact. */
export interface Link {
  text: string;
  target: string;
  line: number;
}

/** Parsed representation of an artifact used by rules and catalog builders. */
export type MetadataValue = string | string[];

/** Source location for a parsed frontmatter metadata field. */
export interface MetadataFieldEvidence {
  path: string;
  key: string;
  startLine: number;
  endLine: number;
  raw: string;
}

/** Parsed frontmatter values plus source evidence for each known field. */
export interface ParsedMetadata {
  values: Record<string, MetadataValue>;
  fields: Record<string, MetadataFieldEvidence>;
  listItems: Record<string, MetadataFieldEvidence[]>;
}

export interface ParsedDocument {
  artifact: Artifact;
  lines: string[];
  headings: Heading[];
  codeFences: CodeFence[];
  links: Link[];
  metadata: Record<string, MetadataValue>;
  metadataFields: Record<string, MetadataFieldEvidence>;
  metadataListItems: Record<string, MetadataFieldEvidence[]>;
}

/** Complete result returned by a scan operation. */
export interface ScanResult {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  format: "text" | "json";
  agentSkills?: AgentSkillsValidationSummary;
  contextLens?: ContextLensSummary;
  securityPolicyInventory?: SecurityPolicyInventorySummary;
  trustGraph?: TrustGraph;
  findings: Finding[];
  diagnostics: Diagnostic[];
  diagnosticsV2: DiagnosticV2[];
  reviewBundles: ReviewBundle[];
  exitThreshold: Severity;
}
