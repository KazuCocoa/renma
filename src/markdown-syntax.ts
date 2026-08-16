import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  Code,
  Definition as MdastDefinition,
  Heading as MdastHeading,
  Html,
  Image as MdastImage,
  ImageReference as MdastImageReference,
  InlineCode,
  Link as MdastLink,
  LinkReference as MdastLinkReference,
  Nodes,
  Parents,
  Root,
  Text,
} from "mdast";
import type { Position } from "unist";

import {
  markdownBodyStartLineForArtifact,
  renmaFrontmatterEnvelope,
} from "./frontmatter-envelope.js";
import type { ParsedDocument } from "./types/metadata.js";

/** One-based, inclusive range in the original Markdown file. */
export interface MarkdownSourceRange {
  startLine: number;
  endLine: number;
}

/** One-based, inclusive line range with one-based mdast columns. */
export interface MarkdownSourceColumnRange extends MarkdownSourceRange {
  startColumn: number;
  endColumn: number;
}

/** One node plus its structural context, retained in source traversal order. */
export interface MarkdownNodeRecord {
  node: Nodes;
  parent: Parents;
  index: number;
  ancestors: Parents[];
}

export interface MarkdownHeadingRecord extends MarkdownSourceRange {
  node: MdastHeading;
  depth: number;
  text: string;
}

interface MarkdownResolvedDestinationBase extends MarkdownSourceColumnRange {
  text: string;
  target: string;
  source: string;
  definitionStartLine?: number;
  definitionEndLine?: number;
}

export interface MarkdownLinkRecord extends MarkdownResolvedDestinationBase {
  kind: "link";
  node: MdastLink | MdastLinkReference;
}

export interface MarkdownImageRecord extends MarkdownResolvedDestinationBase {
  kind: "image";
  node: MdastImage | MdastImageReference;
}

export type MarkdownLinkTargetRecord = MarkdownLinkRecord | MarkdownImageRecord;

/** One parser-recognized link/image use, including unresolved references. */
export interface MarkdownLinkSyntaxRecord extends MarkdownSourceColumnRange {
  node: MdastLink | MdastLinkReference | MdastImage | MdastImageReference;
  source: string;
}

/** One parser-recognized definition. Definitions identify targets but are not uses. */
export interface MarkdownDefinitionRecord extends MarkdownSourceColumnRange {
  node: MdastDefinition;
  identifier: string;
  target: string;
  source: string;
}

export interface MarkdownCodeBlockRecord extends MarkdownSourceRange {
  node: Code;
  kind: "fenced" | "indented";
  language: string;
  content: string;
  contentStartLine: number;
  contentEndLine: number;
  closed: boolean;
}

/**
 * Shared syntax representation for one eligible Markdown artifact.
 *
 * `bodyStartLine` is the one-based original-file line parsed as Markdown.
 * mdast positions are converted back to original-file lines by this module.
 */
export interface MarkdownSyntax {
  sourceLines: string[];
  bodyStartLine: number;
  root: Root;
  records: MarkdownNodeRecord[];
  headings: MarkdownHeadingRecord[];
  links: MarkdownLinkRecord[];
  images: MarkdownImageRecord[];
  linkTargets: MarkdownLinkTargetRecord[];
  linkSyntax: MarkdownLinkSyntaxRecord[];
  definitions: MarkdownDefinitionRecord[];
  codeBlocks: MarkdownCodeBlockRecord[];
}

const syntaxByDocument = new WeakMap<ParsedDocument, MarkdownSyntax>();

/** Find the body line under the exact general Renma frontmatter contract. */
export function markdownBodyStartLine(sourceLines: string[]): number {
  const envelope = renmaFrontmatterEnvelope(sourceLines);
  return envelope.closingIndex === undefined ? 1 : envelope.closingIndex + 2;
}

/**
 * Parse one Markdown body while retaining original-file source provenance.
 * Artifact-aware callers pass their selected body start explicitly; the
 * default is the exact general Renma contract.
 */
export function parseMarkdownSyntax(
  content: string,
  bodyStartLine?: number,
): MarkdownSyntax {
  const sourceLines = content.split(/\r?\n/);
  const resolvedBodyStartLine =
    bodyStartLine ?? markdownBodyStartLine(sourceLines);
  const body = sourceLines.slice(resolvedBodyStartLine - 1).join("\n");
  let root: Root;
  try {
    root = fromMarkdown(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse Markdown: ${detail}`, { cause: error });
  }

  const records = collectMarkdownNodeRecords(root);
  const headings = records.flatMap((record): MarkdownHeadingRecord[] => {
    if (record.node.type !== "heading" || record.parent.type !== "root") {
      return [];
    }
    return [
      {
        node: record.node,
        ...markdownSourceRange(record.node, resolvedBodyStartLine),
        depth: record.node.depth,
        text: markdownNodeText(record.node),
      },
    ];
  });
  const definitions = records.flatMap((record): MarkdownDefinitionRecord[] => {
    if (record.node.type !== "definition") return [];
    return [
      {
        node: record.node,
        ...markdownSourceColumnRange(record.node, resolvedBodyStartLine),
        identifier: record.node.identifier,
        target: record.node.url,
        source: markdownNodeSource(
          record.node,
          sourceLines,
          resolvedBodyStartLine,
        ),
      },
    ];
  });
  // CommonMark resolves duplicate definitions to the first definition. mdast
  // owns identifier normalization and reference-kind recognition; this shared
  // projection only joins those parser-owned identities.
  const definitionByIdentifier = new Map<string, MarkdownDefinitionRecord>();
  for (const definition of definitions) {
    if (!definitionByIdentifier.has(definition.identifier)) {
      definitionByIdentifier.set(definition.identifier, definition);
    }
  }
  const linkSyntax = records.flatMap((record): MarkdownLinkSyntaxRecord[] => {
    if (!isMarkdownLinkSyntaxNode(record.node)) return [];
    return [
      {
        node: record.node,
        ...markdownSourceColumnRange(record.node, resolvedBodyStartLine),
        source: markdownNodeSource(
          record.node,
          sourceLines,
          resolvedBodyStartLine,
        ),
      },
    ];
  });
  const linkTargets = records.flatMap((record): MarkdownLinkTargetRecord[] => {
    if (record.node.type === "link") {
      return [
        {
          kind: "link",
          node: record.node,
          ...markdownSourceColumnRange(record.node, resolvedBodyStartLine),
          text: markdownNodeText(record.node),
          target: record.node.url,
          source: markdownNodeSource(
            record.node,
            sourceLines,
            resolvedBodyStartLine,
          ),
        },
      ];
    }
    if (record.node.type === "image") {
      return [
        {
          kind: "image",
          node: record.node,
          ...markdownSourceColumnRange(record.node, resolvedBodyStartLine),
          text: record.node.alt ?? "",
          target: record.node.url,
          source: markdownNodeSource(
            record.node,
            sourceLines,
            resolvedBodyStartLine,
          ),
        },
      ];
    }
    if (record.node.type === "linkReference") {
      const definition = definitionByIdentifier.get(record.node.identifier);
      if (definition === undefined) return [];
      return [
        {
          kind: "link",
          node: record.node,
          ...markdownSourceColumnRange(record.node, resolvedBodyStartLine),
          text: markdownNodeText(record.node),
          target: definition.target,
          source: markdownNodeSource(
            record.node,
            sourceLines,
            resolvedBodyStartLine,
          ),
          definitionStartLine: definition.startLine,
          definitionEndLine: definition.endLine,
        },
      ];
    }
    if (record.node.type === "imageReference") {
      const definition = definitionByIdentifier.get(record.node.identifier);
      if (definition === undefined) return [];
      return [
        {
          kind: "image",
          node: record.node,
          ...markdownSourceColumnRange(record.node, resolvedBodyStartLine),
          text: record.node.alt ?? "",
          target: definition.target,
          source: markdownNodeSource(
            record.node,
            sourceLines,
            resolvedBodyStartLine,
          ),
          definitionStartLine: definition.startLine,
          definitionEndLine: definition.endLine,
        },
      ];
    }
    return [];
  });
  const links = linkTargets.filter(
    (target): target is MarkdownLinkRecord => target.kind === "link",
  );
  const images = linkTargets.filter(
    (target): target is MarkdownImageRecord => target.kind === "image",
  );
  const codeBlocks = records.flatMap((record): MarkdownCodeBlockRecord[] => {
    if (record.node.type !== "code") return [];
    return [codeBlockRecord(record.node, sourceLines, resolvedBodyStartLine)];
  });

  return {
    sourceLines,
    bodyStartLine: resolvedBodyStartLine,
    root,
    records,
    headings,
    links,
    images,
    linkTargets,
    linkSyntax,
    definitions,
    codeBlocks,
  };
}

/** Retain syntax as non-public working state associated with a parsed document. */
export function attachMarkdownSyntax(
  document: ParsedDocument,
  syntax: MarkdownSyntax,
): void {
  syntaxByDocument.set(document, syntax);
}

/** Return the primary syntax parse retained for an eligible parsed document. */
export function markdownSyntaxForDocument(
  document: ParsedDocument,
): MarkdownSyntax | undefined {
  return syntaxByDocument.get(document);
}

/**
 * Return cached syntax or recover it for an independently constructed copy.
 * Normal repository snapshots take the cached branch because `parseDocument`
 * attaches their primary parse before any syntax consumer runs.
 */
export function ensureMarkdownSyntaxForDocument(
  document: ParsedDocument,
): MarkdownSyntax | undefined {
  const attached = markdownSyntaxForDocument(document);
  if (attached !== undefined) return attached;
  if (
    document.artifact.contentClassification === "binary" ||
    document.artifact.markdownParserEligible !== true
  ) {
    return undefined;
  }
  const sourceLines = document.artifact.content.split(/\r?\n/);
  const syntax = parseMarkdownSyntax(
    document.artifact.content,
    markdownBodyStartLineForArtifact(document.artifact, sourceLines),
  );
  attachMarkdownSyntax(document, syntax);
  return syntax;
}

/** Require an mdast source position so parser failures remain fail-closed. */
export function requiredMarkdownPosition(node: {
  position?: Position | undefined;
}): Position {
  if (node.position !== undefined) return node.position;
  throw new Error("Markdown parser returned a node without a source position");
}

/** Convert an mdast position to a one-based original-file line range. */
export function markdownSourceRange(
  node: { position?: Position | undefined },
  bodyStartLine: number,
): MarkdownSourceRange {
  const position = requiredMarkdownPosition(node);
  const skippedSourceLineCount = bodyStartLine - 1;
  return {
    startLine: skippedSourceLineCount + position.start.line,
    endLine: skippedSourceLineCount + position.end.line,
  };
}

/** Convert an mdast position while retaining its one-based source columns. */
export function markdownSourceColumnRange(
  node: { position?: Position | undefined },
  bodyStartLine: number,
): MarkdownSourceColumnRange {
  const position = requiredMarkdownPosition(node);
  return {
    ...markdownSourceRange(node, bodyStartLine),
    startColumn: position.start.column,
    endColumn: position.end.column,
  };
}

/** Return the exact original source occupied by one positioned mdast node. */
export function markdownNodeSource(
  node: { position?: Position | undefined },
  sourceLines: readonly string[],
  bodyStartLine: number,
): string {
  const range = markdownSourceColumnRange(node, bodyStartLine);
  const lines = sourceLines.slice(range.startLine - 1, range.endLine);
  if (lines.length === 0) return "";
  lines[0] = (lines[0] ?? "").slice(range.startColumn - 1);
  const lastIndex = lines.length - 1;
  if (range.startLine === range.endLine) {
    lines[0] = (lines[0] ?? "").slice(0, range.endColumn - range.startColumn);
  } else {
    lines[lastIndex] = (lines[lastIndex] ?? "").slice(0, range.endColumn - 1);
  }
  return lines.join("\n");
}

/** Collect descendant text without exposing mdast details to ordinary callers. */
export function markdownNodeText(node: Nodes | Parents): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return (node as Text | InlineCode).value;
  }
  if (node.type === "html") {
    const value = (node as Html).value;
    return value.trimStart().startsWith("<!--") ? "" : value;
  }
  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }
  if ("children" in node) return node.children.map(markdownNodeText).join("");
  return "";
}

function isMarkdownLinkSyntaxNode(
  node: Nodes,
): node is MdastLink | MdastLinkReference | MdastImage | MdastImageReference {
  return (
    node.type === "link" ||
    node.type === "linkReference" ||
    node.type === "image" ||
    node.type === "imageReference"
  );
}

/** Traverse the shared tree once and retain parent/ancestor context. */
export function collectMarkdownNodeRecords(root: Root): MarkdownNodeRecord[] {
  const records: MarkdownNodeRecord[] = [];
  const visit = (parent: Parents, ancestors: Parents[]): void => {
    parent.children.forEach((node, index) => {
      records.push({ node, parent, index, ancestors });
      if ("children" in node) visit(node, [...ancestors, node]);
    });
  };
  visit(root, [root]);
  return records;
}

/** Return every original-file line occupied by matching structural code nodes. */
export function markdownCodeLineNumbers(
  syntax: MarkdownSyntax,
  kind?: MarkdownCodeBlockRecord["kind"],
): Set<number> {
  const lines = new Set<number>();
  for (const block of syntax.codeBlocks) {
    if (kind !== undefined && block.kind !== kind) continue;
    for (let line = block.startLine; line <= block.endLine; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

function codeBlockRecord(
  node: Code,
  sourceLines: string[],
  bodyStartLine: number,
): MarkdownCodeBlockRecord {
  const range = markdownSourceRange(node, bodyStartLine);
  const position = requiredMarkdownPosition(node);
  const openingLine = sourceLines[range.startLine - 1] ?? "";
  const openingCharacter = openingLine[position.start.column - 1];
  // mdast already owns code-block recognition. Inspecting its opening source
  // character only preserves the established fenced-versus-indented projection.
  const fenced = openingCharacter === "`" || openingCharacter === "~";
  const openingLength = fenced
    ? repeatedCharacterLength(
        openingLine,
        position.start.column - 1,
        openingCharacter,
      )
    : 0;
  const closed =
    fenced &&
    range.endLine > range.startLine &&
    isClosingFence(
      node,
      range,
      sourceLines[range.endLine - 1] ?? "",
      openingCharacter,
      openingLength,
    );
  const contentStartLine = fenced ? range.startLine + 1 : range.startLine;
  const contentEndLine = fenced && closed ? range.endLine - 1 : range.endLine;
  const content =
    contentEndLine < contentStartLine
      ? ""
      : sourceLines.slice(contentStartLine - 1, contentEndLine).join("\n");

  return {
    node,
    ...range,
    kind: fenced ? "fenced" : "indented",
    language: node.lang ?? "",
    content,
    contentStartLine,
    contentEndLine,
    closed,
  };
}

function repeatedCharacterLength(
  value: string,
  start: number,
  character: string,
): number {
  let end = start;
  while (value[end] === character) end += 1;
  return end - start;
}

function isClosingFence(
  node: Code,
  range: MarkdownSourceRange,
  line: string,
  character: string,
  openingLength: number,
): boolean {
  const meaningfulEnd = line.trimEnd().length;
  let markerStart = meaningfulEnd;
  while (markerStart > 0 && line[markerStart - 1] === character) {
    markerStart -= 1;
  }
  const markerLength = meaningfulEnd - markerStart;
  const sourceSpanLineCount = range.endLine - range.startLine + 1;
  const valueLineCount = node.value === "" ? 0 : node.value.split("\n").length;
  // mdast already decided whether container prefixes and indentation form a
  // code node. A closing token occupies an additional source line beyond the
  // opening plus every value line. This avoids applying the top-level
  // three-space rule to raw list or blockquote prefixes, while distinguishing
  // a shorter or marker-looking final content line retained in `node.value`.
  return (
    markerLength >= openingLength && sourceSpanLineCount >= valueLineCount + 2
  );
}
