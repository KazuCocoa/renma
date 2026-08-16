import {
  attachMarkdownSyntax,
  parseMarkdownSyntax,
} from "./markdown-syntax.js";
import {
  attachYamlFrontmatter,
  parseFrontmatterForArtifact,
  type ParsedYamlFrontmatter,
  type YamlFrontmatterField,
} from "./yaml-frontmatter.js";
import { NON_SKILL_LIST_METADATA_KEYS } from "./metadata-definitions.js";
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
  const frontmatter = parseFrontmatterForArtifact(artifact);
  const syntax = parseMarkdownSyntax(
    artifact.content,
    frontmatter.closed ? frontmatter.bodyStartLine : 1,
  );
  const lines = syntax.sourceLines;
  const metadata = projectFrontmatterMetadata(
    artifact.path,
    lines,
    frontmatter,
  );
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
  attachYamlFrontmatter(document, frontmatter);
  attachMarkdownSyntax(document, syntax);
  return document;
}

const LIST_METADATA_KEYS = new Set<string>(NON_SKILL_LIST_METADATA_KEYS);

function projectFrontmatterMetadata(
  path: string,
  lines: string[],
  frontmatter: ParsedYamlFrontmatter,
): ParsedMetadata {
  const values: Record<string, MetadataValue> = {};
  const fields: Record<string, MetadataFieldEvidence> = {};
  const listItems: Record<string, MetadataFieldEvidence[]> = {};
  if (
    !frontmatter.present ||
    !frontmatter.closed ||
    !frontmatter.mapping ||
    frontmatter.errors.length > 0
  ) {
    return { values, fields, listItems };
  }

  const duplicateKeys = new Set(
    frontmatter.duplicateFields.map((field) => field.key),
  );
  for (const field of frontmatter.fields) {
    if (duplicateKeys.has(field.key)) continue;
    const normalized = normalizeMetadataField(field);
    if (normalized === undefined) continue;
    values[field.key] = normalized;
    fields[field.key] = yamlMetadataFieldEvidence(path, lines, field);
    if (field.sequenceItems !== undefined) {
      listItems[field.key] = field.sequenceItems.map((item) =>
        frontmatterFieldEvidence(
          path,
          field.key,
          lines,
          item.startLine - 1,
          item.endLine - 1,
        ),
      );
    }
  }
  return { values, fields, listItems };
}

function normalizeMetadataField(
  field: YamlFrontmatterField,
): MetadataValue | undefined {
  if (Array.isArray(field.value)) {
    if (!LIST_METADATA_KEYS.has(field.key)) return undefined;
    const values = field.value.map(normalizeMetadataScalar);
    return values.some((value) => value === undefined)
      ? undefined
      : (values as string[]);
  }
  return normalizeMetadataScalar(field.value);
}

function normalizeMetadataScalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return undefined;
}

function yamlMetadataFieldEvidence(
  path: string,
  lines: string[],
  field: YamlFrontmatterField,
): MetadataFieldEvidence {
  return frontmatterFieldEvidence(
    path,
    field.key,
    lines,
    field.startLine - 1,
    field.endLine - 1,
  );
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
