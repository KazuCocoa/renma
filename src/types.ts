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
  | "script"
  | "asset"
  | "config"
  | "unknown";

/** Repository governance boundary determined from a normalized asset path. */
export type AssetScope =
  | "independent"
  | "skill-local"
  | "repository-support"
  | "unknown";

/** Stable registry of deterministic asset-classification rules. */
export const ASSET_CLASSIFICATION_RULES = [
  "skill-entrypoint",
  "skill-local-support",
  "context-root",
  "context-root-legacy",
  "lens-root",
  "agent-root",
  "repository-tool",
  "config-file",
  "generic-profile",
  "generic-reference",
  "generic-example",
  "unknown",
] as const;
export type AssetClassificationRule =
  (typeof ASSET_CLASSIFICATION_RULES)[number];

/** Stable registry of positive and competing asset-classification reasons. */
export const ASSET_CLASSIFICATION_REASON_CODES = [
  "under-canonical-skill-root",
  "under-skill-support-directory",
  "outside-recognized-asset-boundary",
  "unsupported-skill-local-directory",
  "under-recognized-context-root",
  "under-legacy-context-root",
  "under-recognized-lens-root",
  "under-recognized-agent-root",
  "repository-tool-not-context",
  "recognized-config-file",
  "under-generic-support-directory",
  "outside-recognized-skill-boundary",
  "outside-recognized-context-root",
] as const;
export type AssetClassificationReasonCode =
  (typeof ASSET_CLASSIFICATION_REASON_CODES)[number];

/** Resolution state for the structurally implied parent of Skill-local support. */
export type ParentAssetResolution =
  | "structural-candidate"
  | "resolved"
  | "missing"
  | "ambiguous";

/** Stable negative evidence for a nearby classification rule. */
export interface AssetCompetingRuleEvidence {
  rule: AssetClassificationRule;
  matched: false;
  reasonCode: AssetClassificationReasonCode;
  reason: string;
}

/** Deterministic, machine-readable evidence explaining one path classification. */
export interface AssetClassificationEvidence {
  kind: ArtifactKind;
  scope: AssetScope;
  matchedRule: AssetClassificationRule;
  reasonCode: AssetClassificationReasonCode;
  reason: string;
  recognizedRoot?: string;
  /** Structural path candidate; it does not prove that a parent asset exists. */
  parentAssetCandidatePath?: string;
  /** Resolved parent source path; present only for one unambiguous parent. */
  parentAssetPath?: string;
  parentResolution?: ParentAssetResolution;
  parentAssetCandidates?: string[];
  supportDirectory?: string;
  ignoredNestedSegments?: string[];
  competingRules?: AssetCompetingRuleEvidence[];
}

/** Explicit outcome for commands that may recommend an authoring change. */
export type DecisionStatus =
  | "deterministic"
  | "human-confirmation-required"
  | "blocked"
  | "no-change-recommended";

/** Stable registry of suggestion decision reasons. */
export const ASSET_DECISION_REASON_CODES = [
  "conflicting-ownership-evidence",
  "explicit-human-provided-override",
  "skill-local-governance-inherited",
  "skill-local-existing-metadata-preserved",
  "skill-local-unowned",
  "skill-local-parent-unresolved",
  "repository-boundary-unresolved",
  "repository-boundary-ambiguous",
  "repository-tool-not-context",
  "outside-recognized-asset-boundary",
  "independent-governance-intent-unconfirmed",
  "deterministic-metadata-candidate",
  "metadata-already-sufficient",
  "conflicting-or-incomplete-skill-evidence",
  "canonical-agent-skill-no-change",
  "agent-skills-migration-review-required",
] as const;
export type AssetDecisionReasonCode =
  (typeof ASSET_DECISION_REASON_CODES)[number];

export interface AssetDecisionEvidence {
  reasonCode: AssetDecisionReasonCode;
  summary: string;
  question?: string;
}

/** Declared and effective ownership with explicit provenance. */
export interface AssetOwnership {
  declaredOwner: string | null;
  effectiveOwner: string | null;
  source: "declared" | "inherited" | "unowned";
  inheritedFrom?: {
    id: string;
    sourcePath: string;
  };
}

/** Governance provenance kept separate from path classification evidence. */
export interface AssetGovernanceEvidence {
  ownership: AssetOwnership;
  policySource?: "declared" | "inherited" | "missing";
  policyInheritedFrom?: string;
  metadataState?: "declared" | "partial" | "missing" | "not-required";
}

/** Executable command data plus a shell-oriented human display string. */
export interface CommandInvocation<Args extends string[] = string[]> {
  command: "renma";
  args: Args;
  display: string;
}

export interface SuggestedNextAction {
  kind: "inspect-parent" | "inspect-target" | "review-layout" | "verify";
  invocation: CommandInvocation;
}

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

/** Compatibility-only layout input retained without forcing local migration. */
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
  /** Hash of the original bytes; binary files are never decoded to compute it. */
  contentHash?: string;
  contentClassification: "text" | "binary";
  markdownParserEligible: boolean;
  /** UTF-8 text only. Binary artifacts use an empty string and false eligibility. */
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
