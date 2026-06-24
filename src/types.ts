/** Finding severity used for scan reports and failure thresholds. */
export type Severity = "low" | "medium" | "high" | "critical";

/** Classified artifact kind discovered from repository paths. */
export type ArtifactKind =
  | "skill"
  | "agent"
  | "context"
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

/** Rule finding emitted by deterministic scans. */
export interface Finding {
  id: string;
  title: string;
  category: "quality" | "safety" | "structure" | "maintenance";
  severity: Severity;
  confidence: "low" | "medium" | "high";
  evidence: Evidence;
  whyItMatters: string;
  remediation: string;
  constraints?: string[];
  verificationSteps?: string[];
  llmHint?: string;
}

/** Non-finding diagnostic produced while loading, discovering, or parsing input. */
export interface Diagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
}

/** Repository layout mapping used by strict three-root policy diagnostics. */
export interface LayoutPolicyConfig {
  toolNamespace?: string;
  workflowAliases: Record<string, string>;
}

export interface SecurityConfig {
  approvedDomains: string[];
  approvedUploadDomains: string[];
  disallowedCommands: string[];
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
export interface ParsedDocument {
  artifact: Artifact;
  lines: string[];
  headings: Heading[];
  codeFences: CodeFence[];
  links: Link[];
  metadata: Record<string, string>;
}

/** Complete result returned by a scan operation. */
export interface ScanResult {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  format: "text" | "json";
  findings: Finding[];
  diagnostics: Diagnostic[];
  exitThreshold: Severity;
}
