export type Severity = "low" | "medium" | "high" | "critical";

export type ArtifactKind =
  | "skill"
  | "agent"
  | "profile"
  | "reference"
  | "eval"
  | "config"
  | "unknown";

export interface Evidence {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface Finding {
  id: string;
  title: string;
  category: "quality" | "safety" | "structure" | "eval" | "maintenance";
  severity: Severity;
  confidence: "low" | "medium" | "high";
  evidence: Evidence;
  whyItMatters: string;
  remediation: string;
}

export interface Diagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
}

export interface ScanConfig {
  failOn: Severity;
  format: "text" | "json";
  globs: string[];
  exclude: string[];
  maxFileSizeBytes: number;
  maxDepth: number;
  concurrency: number;
}

export interface LoadedConfig {
  config: ScanConfig;
  configPath?: string;
}

export interface Artifact {
  path: string;
  absolutePath: string;
  kind: ArtifactKind;
  sizeBytes: number;
  content: string;
}

export interface Heading {
  depth: number;
  text: string;
  line: number;
}

export interface CodeFence {
  language: string;
  content: string;
  startLine: number;
  endLine: number;
}

export interface Link {
  text: string;
  target: string;
  line: number;
}

export interface ParsedDocument {
  artifact: Artifact;
  lines: string[];
  headings: Heading[];
  codeFences: CodeFence[];
  links: Link[];
  metadata: Record<string, string>;
}

export interface ScanResult {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  format: "text" | "json";
  findings: Finding[];
  diagnostics: Diagnostic[];
  exitThreshold: Severity;
}
