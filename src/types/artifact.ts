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
