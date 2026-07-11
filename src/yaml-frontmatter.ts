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
  values: Record<string, unknown>;
  fields: YamlFrontmatterField[];
  metadataFields: YamlFrontmatterField[];
  duplicateFields: YamlFrontmatterField[];
  duplicateMetadataKeys: YamlFrontmatterField[];
  errors: YamlFrontmatterError[];
}

/** Parse YAML frontmatter without changing the repository-wide Markdown parser. */
export function parseYamlFrontmatter(content: string): ParsedYamlFrontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return emptyResult(false, false);

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && /^---\s*$/.test(line),
  );
  if (closingIndex < 0) return emptyResult(true, false);

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
      ...emptyResult(true, true),
      errors,
    };
  }

  const fields = mapFields(yaml, yaml.contents.items, lineCounter);
  const metadataPair = yaml.contents.items.find(
    (pair) => scalarString(pair.key) === "metadata",
  );
  const metadataFields = isMap(metadataPair?.value)
    ? mapFields(yaml, metadataPair.value.items, lineCounter)
    : [];

  return {
    present: true,
    closed: true,
    mapping: true,
    values: Object.fromEntries(fields.map((field) => [field.key, field.value])),
    fields,
    metadataFields,
    duplicateFields: duplicateFields(fields),
    duplicateMetadataKeys: duplicateFields(metadataFields),
    errors,
  };
}

function emptyResult(present: boolean, closed: boolean): ParsedYamlFrontmatter {
  return {
    present,
    closed,
    mapping: false,
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
    const range = nodeRange(pair.key) ?? nodeRange(pair.value);
    const startLine = (range ? lineCounter.linePos(range[0]).line : 1) + 1;
    const endLine = (range ? lineCounter.linePos(range[2]).line : 1) + 1;
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

function duplicateFields(
  fields: YamlFrontmatterField[],
): YamlFrontmatterField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    if (seen.has(field.key)) return true;
    seen.add(field.key);
    return false;
  });
}
