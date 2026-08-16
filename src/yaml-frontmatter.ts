import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  Parser,
  parseDocument as parseYamlDocument,
  type Document,
  type Node,
  type Pair,
} from "yaml";
import {
  agentSkillFrontmatterEnvelope,
  frontmatterEnvelopeForArtifact,
  renmaFrontmatterEnvelope,
  type FrontmatterEnvelope,
} from "./frontmatter-envelope.js";
import { AGENT_SKILL_TOP_LEVEL_KEYS } from "./metadata-definitions.js";
import type { Artifact } from "./types/artifact.js";
import type { ParsedDocument } from "./types/metadata.js";

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
  sequenceItems?: YamlFrontmatterSequenceItem[];
}

export interface YamlFrontmatterSequenceItem {
  value: unknown;
  startLine: number;
  endLine: number;
}

export interface YamlFrontmatterCommentLine {
  content: string;
  line: number;
  startColumn: number;
  endColumn: number;
}

/** Syntactic YAML comment text with exact original frontmatter evidence. */
export interface YamlFrontmatterComment {
  content: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  lines: YamlFrontmatterCommentLine[];
}

export interface ParsedYamlFrontmatter {
  present: boolean;
  closed: boolean;
  mapping: boolean;
  bodyStartLine: number;
  values: Record<string, unknown>;
  fields: YamlFrontmatterField[];
  metadataFields: YamlFrontmatterField[];
  /** True only when syntactic YAML-comment extraction completed successfully. */
  commentsAnalyzable: boolean;
  comments: YamlFrontmatterComment[];
  duplicateFields: YamlFrontmatterField[];
  duplicateMetadataKeys: YamlFrontmatterField[];
  errors: YamlFrontmatterError[];
}

export type YamlFrontmatterCommentAnalysis = Pick<
  ParsedYamlFrontmatter,
  "commentsAnalyzable" | "comments"
>;

const frontmatterByDocument = new WeakMap<
  ParsedDocument,
  ParsedYamlFrontmatter
>();

/** Parse a focused YAML 1.2 frontmatter document without replacing the Markdown parser. */
export function parseAgentSkillFrontmatter(
  content: string,
): ParsedYamlFrontmatter {
  const lines = content.split(/\r?\n/);
  return parseFrontmatterEnvelope(lines, agentSkillFrontmatterEnvelope(lines));
}

/** Parse the exact general Renma frontmatter envelope as YAML 1.2. */
export function parseRenmaFrontmatter(content: string): ParsedYamlFrontmatter {
  const lines = content.split(/\r?\n/);
  return parseFrontmatterEnvelope(lines, renmaFrontmatterEnvelope(lines));
}

/** Select one envelope contract from the discovered artifact role and parse it once. */
export function parseFrontmatterForArtifact(
  artifact: Pick<Artifact, "kind" | "content">,
): ParsedYamlFrontmatter {
  const lines = artifact.content.split(/\r?\n/);
  return parseFrontmatterEnvelope(
    lines,
    frontmatterEnvelopeForArtifact(artifact, lines),
  );
}

/** Retain the primary artifact-aware YAML parse as private document state. */
export function attachYamlFrontmatter(
  document: ParsedDocument,
  frontmatter: ParsedYamlFrontmatter,
): void {
  frontmatterByDocument.set(document, frontmatter);
}

/** Return the primary artifact-aware YAML parse retained for this document. */
export function yamlFrontmatterForDocument(
  document: ParsedDocument,
): ParsedYamlFrontmatter | undefined {
  return frontmatterByDocument.get(document);
}

/** Recover artifact-aware YAML state only for independently reconstructed documents. */
export function ensureYamlFrontmatterForDocument(
  document: ParsedDocument,
): ParsedYamlFrontmatter {
  const attached = yamlFrontmatterForDocument(document);
  if (attached !== undefined) return attached;
  const frontmatter = parseFrontmatterForArtifact(document.artifact);
  attachYamlFrontmatter(document, frontmatter);
  return frontmatter;
}

function parseFrontmatterEnvelope(
  lines: string[],
  envelope: FrontmatterEnvelope,
): ParsedYamlFrontmatter {
  if (!envelope.present) return emptyResult(false, false, 1);
  if (envelope.closingIndex === undefined) {
    return emptyResult(true, false, lines.length + 1);
  }
  const closingIndex = envelope.closingIndex;

  const source = lines.slice(1, closingIndex).join("\n");
  const { yaml, lineCounter, errors, commentAnalysis } =
    parseYamlFrontmatterSource(source);

  if (!isMap(yaml.contents)) {
    return {
      ...emptyResult(true, true, closingIndex + 2),
      ...commentAnalysis,
      errors,
    };
  }

  const fields = mapFields(yaml, yaml.contents.items, lineCounter);
  // Retain field evidence from every top-level metadata mapping. Operational
  // consumers still fail closed when metadata is duplicated, but dedicated
  // declaration parsers need the exact field evidence even when the canonical
  // marker appears only in a later ambiguous mapping.
  const metadataFields = yaml.contents.items
    .filter(
      (pair) => scalarString(pair.key) === AGENT_SKILL_TOP_LEVEL_KEYS.metadata,
    )
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
    ...commentAnalysis,
    duplicateFields: findDuplicates(fields),
    duplicateMetadataKeys: findDuplicates(metadataFields),
    errors,
  };
}

function parseYamlFrontmatterSource(source: string) {
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
  // The same YAML library's CST distinguishes syntactic comments from hashes
  // inside quoted and block scalar content. Only expose comment evidence after
  // the semantic parse succeeds; malformed YAML must not produce guessed text.
  const commentAnalysis =
    errors.length === 0
      ? analyzeYamlFrontmatterComments(source, lineCounter)
      : { commentsAnalyzable: false as const, comments: [] };
  return { yaml, lineCounter, errors, commentAnalysis };
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
    commentsAnalyzable: false,
    comments: [],
    duplicateFields: [],
    duplicateMetadataKeys: [],
    errors: [],
  };
}

type CstCommentLine = YamlFrontmatterCommentLine & {
  offset: number;
  fullLine: boolean;
};

function analyzeYamlFrontmatterComments(
  source: string,
  lineCounter: LineCounter,
): YamlFrontmatterCommentAnalysis {
  const tokens = [...new Parser().parse(source)];
  if (containsCstErrorToken(tokens)) {
    return { commentsAnalyzable: false, comments: [] };
  }
  const comments: Array<{ offset: number; source: string }> = [];
  collectCstCommentTokens(tokens, comments);
  const sourceLines = source.split("\n");
  const commentLines = comments
    .sort((left, right) => left.offset - right.offset)
    .filter(
      (comment, index, sorted) =>
        index === 0 || comment.offset !== sorted[index - 1]?.offset,
    )
    .map((comment): CstCommentLine => {
      const position = lineCounter.linePos(comment.offset);
      const sourceLine = sourceLines[position.line - 1] ?? "";
      return {
        offset: comment.offset,
        content: comment.source.slice(1),
        line: position.line + 1,
        startColumn: position.col,
        endColumn: position.col + comment.source.length,
        fullLine: sourceLine.slice(0, position.col - 1).trim().length === 0,
      };
    });

  const blocks: CstCommentLine[][] = [];
  for (const line of commentLines) {
    const previousBlock = blocks.at(-1);
    const previousLine = previousBlock?.at(-1);
    if (
      line.fullLine &&
      previousLine?.fullLine &&
      line.line === previousLine.line + 1
    ) {
      previousBlock!.push(line);
    } else {
      blocks.push([line]);
    }
  }

  return {
    commentsAnalyzable: true,
    comments: blocks.map((block) => {
      const first = block[0]!;
      const last = block.at(-1)!;
      return {
        content: block.map((line) => line.content).join("\n"),
        startLine: first.line,
        endLine: last.line,
        startColumn: first.startColumn,
        endColumn: last.endColumn,
        lines: block.map(
          ({
            content,
            line,
            startColumn,
            endColumn,
          }): YamlFrontmatterCommentLine => ({
            content,
            line,
            startColumn,
            endColumn,
          }),
        ),
      };
    }),
  };
}

function containsCstErrorToken(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCstErrorToken);
  if (!isRecord(value)) return false;
  if (value.type === "error") return true;
  return Object.values(value).some(containsCstErrorToken);
}

function collectCstCommentTokens(
  value: unknown,
  comments: Array<{ offset: number; source: string }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCstCommentTokens(item, comments);
    return;
  }
  if (!isRecord(value)) return;
  if (
    value.type === "comment" &&
    typeof value.offset === "number" &&
    typeof value.source === "string"
  ) {
    comments.push({ offset: value.offset, source: value.source });
    return;
  }
  for (const child of Object.values(value)) {
    collectCstCommentTokens(child, comments);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    const sequenceItems = isSeq(pair.value)
      ? pair.value.items.map((item) => ({
          value: nodeValue(document, item),
          ...nodeLineRange(item, lineCounter, startLine),
        }))
      : undefined;
    return [
      {
        key,
        value: nodeValue(document, pair.value),
        startLine,
        endLine,
        ...(sequenceItems ? { sequenceItems } : {}),
      },
    ];
  });
}

function nodeLineRange(
  value: unknown,
  lineCounter: LineCounter,
  fallbackLine: number,
): { startLine: number; endLine: number } {
  const range = nodeRange(value);
  if (range === undefined) {
    return { startLine: fallbackLine, endLine: fallbackLine };
  }
  return {
    startLine: lineCounter.linePos(range[0]).line + 1,
    endLine: lineCounter.linePos(Math.max(range[0], range[2] - 1)).line + 1,
  };
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

function nodeRange(value: unknown): NonNullable<Node["range"]> | undefined {
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
