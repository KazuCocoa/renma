import {
  attachMarkdownSyntax,
  parseMarkdownSyntax,
} from "./markdown-syntax.js";
import {
  markdownBodyStartLineForArtifact,
  renmaFrontmatterEnvelope,
} from "./frontmatter-envelope.js";
import type { Artifact } from "./types/artifact.js";
import type {
  MetadataFieldEvidence,
  MetadataValue,
  ParsedMetadata,
  ParsedDocument,
} from "./types/metadata.js";

/** Parse a markdown artifact into headings, links, code fences, and frontmatter metadata. */
export function parseDocument(artifact: Artifact): ParsedDocument {
  if (
    artifact.contentClassification === "binary" ||
    artifact.markdownParserEligible !== true
  ) {
    return {
      artifact,
      lines:
        artifact.contentClassification === "binary"
          ? []
          : artifact.content.split(/\r?\n/),
      headings: [],
      codeFences: [],
      links: [],
      metadata: {},
      metadataFields: {},
      metadataListItems: {},
    };
  }
  const sourceLines = artifact.content.split(/\r?\n/);
  const syntax = parseMarkdownSyntax(
    artifact.content,
    markdownBodyStartLineForArtifact(artifact, sourceLines),
  );
  const lines = syntax.sourceLines;
  const metadata = parseFrontmatter(artifact.path, lines);
  const document: ParsedDocument = {
    artifact,
    lines,
    headings: syntax.headings.map((heading) => ({
      depth: heading.depth,
      text: heading.text,
      line: heading.startLine,
    })),
    // Keep the established projection fenced-only. Indented code remains
    // available through the internal shared syntax representation.
    codeFences: syntax.codeBlocks
      .filter((block) => block.kind === "fenced")
      .map((block) => ({
        language: block.language,
        content: block.content,
        startLine: block.startLine,
        endLine: block.endLine,
      })),
    links: syntax.linkTargets.map((target) => ({
      text: target.text,
      target: target.target,
      line: target.startLine,
    })),
    metadata: metadata.values,
    metadataFields: metadata.fields,
    metadataListItems: metadata.listItems,
  };
  attachMarkdownSyntax(document, syntax);
  return document;
}

const LIST_METADATA_KEYS = new Set([
  "tags",
  "when_to_use",
  "when_not_to_use",
  "requires_context",
  "optional_context",
  "requires_lens",
  "optional_lens",
  "applies_to",
  "focus",
  "expected_outputs",
  "conflicts",
  "superseded_by",
]);

function parseFrontmatter(path: string, lines: string[]): ParsedMetadata {
  const values: Record<string, MetadataValue> = {};
  const fields: Record<string, MetadataFieldEvidence> = {};
  const listItems: Record<string, MetadataFieldEvidence[]> = {};
  const envelope = renmaFrontmatterEnvelope(lines);
  if (!envelope.present) return { values, fields, listItems };

  let activeListKey: string | undefined;
  let activeListStartLine: number | undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === envelope.closingIndex) break;
    const listItem = line?.match(/^\s+-\s+(.+)$/);
    if (activeListKey && listItem) {
      const current = values[activeListKey];
      if (Array.isArray(current)) current.push(listItem[1]?.trim() ?? "");
      const activeListItems = (listItems[activeListKey] ??= []);
      activeListItems.push(
        frontmatterFieldEvidence(path, activeListKey, lines, index, index),
      );
      fields[activeListKey] = frontmatterFieldEvidence(
        path,
        activeListKey,
        lines,
        activeListStartLine ?? index,
        index,
      );
      continue;
    }

    activeListKey = undefined;
    activeListStartLine = undefined;
    const match = line?.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1] as string;
    const value = match[2]?.trim() ?? "";
    if (LIST_METADATA_KEYS.has(key) && value.length === 0) {
      values[key] = [];
      listItems[key] = [];
      fields[key] = frontmatterFieldEvidence(path, key, lines, index, index);
      activeListKey = key;
      activeListStartLine = index;
      continue;
    }

    values[key] = value;
    fields[key] = frontmatterFieldEvidence(path, key, lines, index, index);
  }
  return { values, fields, listItems };
}

function frontmatterFieldEvidence(
  path: string,
  key: string,
  lines: string[],
  startIndex: number,
  endIndex: number,
): MetadataFieldEvidence {
  return {
    path,
    key,
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    raw: lines.slice(startIndex, endIndex + 1).join("\n"),
  };
}
