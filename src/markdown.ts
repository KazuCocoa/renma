import {
  applyCanonicalRenmaMetadataEvidenceAliases,
  RENMA_LIST_METADATA_KEYS,
  RENMA_METADATA_KEYS,
  type LegacyRenmaMetadataKey,
} from "./renma-metadata.js";
import type {
  Artifact,
  CodeFence,
  Heading,
  Link,
  MetadataFieldEvidence,
  MetadataValue,
  ParsedMetadata,
  ParsedDocument,
} from "./types.js";
import {
  parseYamlFrontmatter,
  yamlFrontmatterFieldEvidence,
} from "./yaml-frontmatter.js";

/** Parse a markdown artifact into headings, links, code fences, and frontmatter metadata. */
export function parseDocument(artifact: Artifact): ParsedDocument {
  const lines = artifact.content.split(/\r?\n/);
  const headings: Heading[] = [];
  const links: Link[] = [];
  const codeFences: CodeFence[] = [];
  const metadata =
    artifact.kind === "skill"
      ? parseCanonicalSkillFrontmatter(artifact.path, lines, artifact.content)
      : parseFrontmatter(artifact.path, lines);
  let fenceStart: number | undefined;
  let fenceLanguage = "";
  let fenceLines: string[] = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      if (fenceStart === undefined) {
        fenceStart = lineNumber;
        fenceLanguage = fence[1] ?? "";
        fenceLines = [];
      } else {
        codeFences.push({
          language: fenceLanguage,
          content: fenceLines.join("\n"),
          startLine: fenceStart,
          endLine: lineNumber,
        });
        fenceStart = undefined;
        fenceLanguage = "";
        fenceLines = [];
      }
      return;
    }

    if (fenceStart !== undefined) {
      fenceLines.push(line);
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      headings.push({
        depth: heading[1]?.length ?? 1,
        text: heading[2]?.trim() ?? "",
        line: lineNumber,
      });
    }

    for (const match of line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      links.push({
        text: match[1] ?? "",
        target: match[2] ?? "",
        line: lineNumber,
      });
    }
  });

  if (fenceStart !== undefined) {
    codeFences.push({
      language: fenceLanguage,
      content: fenceLines.join("\n"),
      startLine: fenceStart,
      endLine: lines.length,
    });
  }

  return {
    artifact,
    lines,
    headings,
    codeFences,
    links,
    metadata: metadata.values,
    metadataFields: metadata.fields,
    metadataListItems: metadata.listItems,
  };
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
  "allowed_data",
  "forbidden_inputs",
  "approved_network_destinations",
  "approved_upload_destinations",
]);

function parseFrontmatter(path: string, lines: string[]): ParsedMetadata {
  const values: Record<string, MetadataValue> = {};
  const fields: Record<string, MetadataFieldEvidence> = {};
  const listItems: Record<string, MetadataFieldEvidence[]> = {};
  const result = { values, fields, listItems };
  if (lines[0]?.trim() !== "---") return result;

  let activeListKey: string | undefined;
  let activeListStartLine: number | undefined;
  let activeNestedMap: string | undefined;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") break;

    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (activeListKey && listItem) {
      const current = values[activeListKey];
      if (Array.isArray(current)) {
        current.push(parseScalar(listItem[1] ?? ""));
      }
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

    if (activeNestedMap) {
      const nested = line.match(/^\s{2,}([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (nested) {
        const key = `${activeNestedMap}.${nested[1] ?? ""}`;
        const value = nested[2]?.trim() ?? "";
        const block = blockScalarMarker(value);
        if (block) {
          const parsed = parseBlockScalar(lines, index, block);
          values[key] = parsed.value;
          fields[key] = frontmatterFieldEvidence(
            path,
            key,
            lines,
            index,
            parsed.endIndex,
          );
          index = parsed.endIndex;
        } else {
          values[key] = parseScalar(value);
          fields[key] = frontmatterFieldEvidence(
            path,
            key,
            lines,
            index,
            index,
          );
        }
        continue;
      }
      if (line.trim().length === 0 || /^\s*#/.test(line)) continue;
      activeNestedMap = undefined;
    }

    activeListKey = undefined;
    activeListStartLine = undefined;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1] as string;
    const value = match[2]?.trim() ?? "";
    if (key === "metadata" && value.length === 0) {
      values[key] = "";
      fields[key] = frontmatterFieldEvidence(path, key, lines, index, index);
      activeNestedMap = key;
      continue;
    }

    if (LIST_METADATA_KEYS.has(key) && value.length === 0) {
      values[key] = [];
      listItems[key] = [];
      fields[key] = frontmatterFieldEvidence(path, key, lines, index, index);
      activeListKey = key;
      activeListStartLine = index;
      continue;
    }

    const block = blockScalarMarker(value);
    if (block) {
      const parsed = parseBlockScalar(lines, index, block);
      values[key] = parsed.value;
      fields[key] = frontmatterFieldEvidence(
        path,
        key,
        lines,
        index,
        parsed.endIndex,
      );
      index = parsed.endIndex;
      continue;
    }

    values[key] = parseScalar(value);
    fields[key] = frontmatterFieldEvidence(path, key, lines, index, index);
  }

  return result;
}

/** Build the operational Skill metadata view from the same YAML tree used by validation. */
function parseCanonicalSkillFrontmatter(
  path: string,
  lines: string[],
  content: string,
): ParsedMetadata {
  const values: Record<string, MetadataValue> = {};
  const fields: Record<string, MetadataFieldEvidence> = {};
  const listItems: Record<string, MetadataFieldEvidence[]> = {};
  const result = { values, fields, listItems };
  const parsed = parseYamlFrontmatter(content);

  // Ambiguous YAML never becomes operational metadata. Validation still reports
  // the exact parser and duplicate-key failures from the full YAML result.
  if (
    !parsed.present ||
    !parsed.closed ||
    !parsed.mapping ||
    parsed.errors.length > 0 ||
    parsed.duplicateFields.length > 0 ||
    parsed.duplicateMetadataKeys.length > 0
  ) {
    return result;
  }

  const allowedTopLevelFields = new Set([
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
  ]);
  if (
    parsed.fields.some((field) => !allowedTopLevelFields.has(field.key)) ||
    typeof parsed.values.name !== "string" ||
    parsed.values.name.trim().length === 0 ||
    typeof parsed.values.description !== "string" ||
    parsed.values.description.trim().length === 0 ||
    ["license", "compatibility", "allowed-tools"].some(
      (key) =>
        parsed.values[key] !== undefined &&
        typeof parsed.values[key] !== "string",
    ) ||
    (parsed.values.metadata !== undefined &&
      (typeof parsed.values.metadata !== "object" ||
        parsed.values.metadata === null ||
        Array.isArray(parsed.values.metadata) ||
        Object.values(parsed.values.metadata).some(
          (value) => typeof value !== "string",
        )))
  ) {
    return result;
  }

  const standardFields = new Set([
    "name",
    "description",
    "license",
    "compatibility",
    "allowed-tools",
  ]);
  for (const field of parsed.fields) {
    if (!standardFields.has(field.key) || typeof field.value !== "string") {
      continue;
    }
    values[field.key] = field.value;
    fields[field.key] = yamlFrontmatterFieldEvidence(path, lines, field);
  }

  for (const field of parsed.metadataFields) {
    if (typeof field.value !== "string") continue;
    const key = `metadata.${field.key}`;
    values[key] = field.value;
    fields[key] = yamlFrontmatterFieldEvidence(path, lines, field, key);
    const legacyKey = (
      Object.entries(RENMA_METADATA_KEYS) as Array<
        [LegacyRenmaMetadataKey, string]
      >
    ).find(([, canonical]) => field.key === `renma.${canonical}`)?.[0];
    if (legacyKey && RENMA_LIST_METADATA_KEYS.has(legacyKey)) {
      try {
        const parsed = JSON.parse(field.value) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item === "string")
        ) {
          listItems[key] = parsed.map(() =>
            yamlFrontmatterFieldEvidence(path, lines, field, key),
          );
        }
      } catch {
        // List normalization retains the legacy comma-separated interpretation.
      }
    }
  }

  // Downstream evidence is organized by governance meaning. These are evidence
  // aliases only: no top-level legacy Skill value is read or copied.
  return applyCanonicalRenmaMetadataEvidenceAliases(result);
}

function blockScalarMarker(value: string): "literal" | "folded" | undefined {
  if (/^\|[-+]?\s*$/.test(value)) return "literal";
  if (/^>[-+]?\s*$/.test(value)) return "folded";
  return undefined;
}

function parseBlockScalar(
  lines: string[],
  startIndex: number,
  mode: "literal" | "folded",
): { value: string; endIndex: number } {
  const collected: string[] = [];
  let endIndex = startIndex;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      line.trim() === "---" ||
      (/^[A-Za-z0-9_-]+:/.test(line) && line.length > 0)
    ) {
      break;
    }
    if (line.length > 0 && !/^\s+/.test(line)) break;
    collected.push(line);
    endIndex = index;
  }

  const nonEmptyIndents = collected
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const indent = nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : 0;
  const normalized = collected.map((line) =>
    line.trim().length === 0 ? "" : line.slice(indent),
  );
  const value =
    mode === "literal"
      ? normalized.join("\n").trim()
      : foldBlockScalar(normalized);
  return { value, endIndex };
}

function foldBlockScalar(lines: string[]): string {
  const paragraphs: string[] = [];
  let active: string[] = [];
  const flush = () => {
    if (active.length > 0) paragraphs.push(active.join(" "));
    active = [];
  };
  for (const line of lines) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    active.push(line.trim());
  }
  flush();
  return paragraphs.join("\n").trim();
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
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
