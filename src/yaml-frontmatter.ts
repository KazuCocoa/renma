import {
  isMap,
  isNode,
  isScalar,
  LineCounter,
  parseDocument as parseYamlDocument,
  type Document,
  type Node,
  type Pair,
} from "yaml";

export interface YamlFrontmatterError {
  code: string;
  message: string;
  line: number;
}

export interface YamlFrontmatterField {
  key: string;
  value: unknown;
  startLine: number;
  endLine: number;
}

export interface ParsedYamlFrontmatter {
  present: boolean;
  closed: boolean;
  mapping: boolean;
  bodyStartLine: number;
  values: Record<string, unknown>;
  fields: YamlFrontmatterField[];
  metadataFields: YamlFrontmatterField[];
  duplicateFields: YamlFrontmatterField[];
  duplicateMetadataKeys: YamlFrontmatterField[];
  errors: YamlFrontmatterError[];
}

export interface AgentSkillFrontmatterEnvelope {
  present: boolean;
  closingIndex: number | undefined;
}

/**
 * Locate an Agent Skills YAML envelope without parsing its contents.
 *
 * The opening delimiter retains the established BOM and surrounding-whitespace
 * handling. A closing delimiter must begin in column one, but may retain
 * trailing whitespace. Indented delimiter-looking text therefore remains YAML
 * content, including inside block scalars.
 */
export function agentSkillFrontmatterEnvelope(
  lines: string[],
): AgentSkillFrontmatterEnvelope {
  const firstLine = lines[0]?.replace(/^\uFEFF/, "").trim();
  if (firstLine !== "---") {
    return { present: false, closingIndex: undefined };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && /^---\s*$/.test(line),
  );
  return {
    present: true,
    closingIndex: closingIndex < 0 ? undefined : closingIndex,
  };
}

/** Parse a focused YAML 1.2 frontmatter document without replacing the Markdown parser. */
export function parseAgentSkillFrontmatter(
  content: string,
): ParsedYamlFrontmatter {
  const lines = content.split(/\r?\n/);
  const envelope = agentSkillFrontmatterEnvelope(lines);
  if (!envelope.present) return emptyResult(false, false, 1);
  if (envelope.closingIndex === undefined) {
    return emptyResult(true, false, lines.length + 1);
  }
  const closingIndex = envelope.closingIndex;

  const source = lines.slice(1, closingIndex).join("\n");
  const lineCounter = new LineCounter();
  const yaml = parseYamlDocument(source, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    stringKeys: true,
    uniqueKeys: false,
    version: "1.2",
  });
  const errors = yaml.errors.map((error) => ({
    code: error.code,
    message: error.message,
    line:
      (error.linePos?.[0].line ?? lineCounter.linePos(error.pos[0]).line) + 1,
  }));

  if (!isMap(yaml.contents)) {
    return {
      ...emptyResult(true, true, closingIndex + 2),
      errors,
    };
  }

  const fields = mapFields(yaml, yaml.contents.items, lineCounter);
  // Retain field evidence from every top-level metadata mapping. Operational
  // consumers still fail closed when metadata is duplicated, but dedicated
  // declaration parsers need the exact field evidence even when the canonical
  // marker appears only in a later ambiguous mapping.
  const metadataFields = yaml.contents.items
    .filter((pair) => scalarString(pair.key) === "metadata")
    .flatMap((pair) =>
      isMap(pair.value) ? mapFields(yaml, pair.value.items, lineCounter) : [],
    );

  return {
    present: true,
    closed: true,
    mapping: true,
    bodyStartLine: closingIndex + 2,
    values: Object.fromEntries(fields.map((field) => [field.key, field.value])),
    fields,
    metadataFields,
    duplicateFields: findDuplicates(fields),
    duplicateMetadataKeys: findDuplicates(metadataFields),
    errors,
  };
}

function emptyResult(
  present: boolean,
  closed: boolean,
  bodyStartLine: number,
): ParsedYamlFrontmatter {
  return {
    present,
    closed,
    mapping: false,
    bodyStartLine,
    values: {},
    fields: [],
    metadataFields: [],
    duplicateFields: [],
    duplicateMetadataKeys: [],
    errors: [],
  };
}

function mapFields(
  document: Document.Parsed,
  pairs: Pair[],
  lineCounter: LineCounter,
): YamlFrontmatterField[] {
  return pairs.flatMap((pair) => {
    const key = scalarString(pair.key);
    if (key === undefined) return [];
    const keyRange = nodeRange(pair.key);
    const valueRange = nodeRange(pair.value);
    const startOffset = keyRange?.[0] ?? valueRange?.[0];
    const endOffset = valueRange?.[2] ?? keyRange?.[2];
    const startLine =
      (startOffset === undefined ? 1 : lineCounter.linePos(startOffset).line) +
      1;
    // YAML node ranges use an exclusive end offset. Pointing at that offset
    // can advance evidence to the following field, so locate the final byte
    // belonging to this pair instead.
    const endLine =
      (endOffset === undefined
        ? startLine - 1
        : lineCounter.linePos(Math.max(startOffset ?? 0, endOffset - 1)).line) +
      1;
    return [
      {
        key,
        value: nodeValue(document, pair.value),
        startLine,
        endLine,
      },
    ];
  });
}

function scalarString(value: unknown): string | undefined {
  return isScalar(value) && typeof value.value === "string"
    ? value.value
    : undefined;
}

function nodeValue(document: Document.Parsed, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return isNode(value) ? value.toJS(document) : value;
}

function nodeRange(value: unknown): Node["range"] | undefined {
  return isNode(value) ? (value.range ?? undefined) : undefined;
}

function findDuplicates(
  fields: YamlFrontmatterField[],
): YamlFrontmatterField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    if (seen.has(field.key)) return true;
    seen.add(field.key);
    return false;
  });
}
