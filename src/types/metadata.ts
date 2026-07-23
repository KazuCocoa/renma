import type { Artifact, CodeFence, Heading, Link } from "./artifact.js";

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
