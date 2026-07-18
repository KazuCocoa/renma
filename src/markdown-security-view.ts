import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  BlockContent,
  Code,
  Heading,
  Html,
  InlineCode,
  List,
  Paragraph,
  Parent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type { Position } from "unist";

export type MarkdownSourceRange = {
  startLine: number;
  endLine: number;
};

export type MarkdownListItemAncestry = MarkdownSourceRange & {
  depth: number;
  ordered: boolean;
  start: number | undefined;
};

export type MarkdownParagraphView = MarkdownSourceRange & {
  kind: "paragraph";
  lines: string[];
  text: string;
  listItemAncestry: MarkdownListItemAncestry[];
  blockQuoted: boolean;
  operational: boolean;
};

export type MarkdownCodeBlockView = MarkdownSourceRange & {
  kind: "code";
  contentStartLine: number;
  contentEndLine: number;
  lines: string[];
  text: string;
  language: string | undefined;
  fenced: boolean;
  listItemAncestry: MarkdownListItemAncestry[];
  blockQuoted: boolean;
  operational: boolean;
};

export type MarkdownSemanticUnit =
  | MarkdownParagraphView
  | MarkdownCodeBlockView;

type PositionedNode = RootContent | BlockContent;

type NodeRecord = {
  node: PositionedNode;
  parent: Parent;
  index: number;
  ancestors: Parent[];
};

type HeadingRecord = MarkdownSourceRange & {
  depth: number;
  text: string;
};

type RemovedRange = { start: number; end: number };

type HtmlCommentSourceRange = MarkdownSourceRange & {
  startColumn: number;
  endColumn: number;
};

const EXAMPLE_BOUNDARY_RE =
  /\b(unsafe|negative|prohibited|forbidden|noncompliant|bad)\s+(?:example|pattern)s?\b|\bwhat not to do\b/i;
const EXAMPLE_LABEL_RE =
  /\b(unsafe|negative|prohibited|forbidden|noncompliant|bad)\s+examples?\s*:\s*$/i;
const OPERATIONAL_FENCE_ROUTING_RE =
  /\b(use|follow|apply|execute|run|perform|carry out)\b.{0,60}\b(following|below|these)\b.{0,40}\b(instructions?|steps?|procedure|workflow|payload)\b|\b(following|below)\b.{0,40}\b(instructions?|steps?|procedure|workflow|payload)\b.{0,40}\b(exactly|verbatim|as written)\b/i;
const OPERATIONAL_FENCE_LABEL_RE =
  /^\s*(?:(?:operational|execution)\s+)?(?:instructions?|steps?|procedure|workflow|payload)\s*:\s*$/i;
const OPERATIONAL_FENCE_HEADING_RE =
  /\b(instructions?|operational instructions?|execution instructions?|procedure|runbook)\b/i;
const SAFETY_HEADING_RE =
  /\b(human approval|safety|constraints?|guardrails?)\b/i;

export class MarkdownSecurityView {
  readonly lines: string[];
  readonly bodyStart: number;
  readonly paragraphs: MarkdownParagraphView[];
  readonly codeBlocks: MarkdownCodeBlockView[];
  readonly inlineCodeRanges: MarkdownSourceRange[];
  readonly htmlRanges: MarkdownSourceRange[];
  readonly htmlCommentRanges: MarkdownSourceRange[];
  readonly thematicBreakRanges: MarkdownSourceRange[];
  readonly semanticUnits: MarkdownSemanticUnit[];

  private readonly visibleLines: string[];
  readonly headings: HeadingRecord[];
  private readonly blockQuoteLines = new Set<number>();
  private readonly codeByLine = new Map<number, MarkdownCodeBlockView>();
  private readonly fenceMarkerLines = new Set<number>();
  private readonly records: NodeRecord[];

  constructor(content: string, bodyStart: number) {
    this.lines = content.split(/\r?\n/);
    this.bodyStart = bodyStart;
    const bodyOffset = lineStartOffset(content, bodyStart);
    const body = content.slice(bodyOffset);
    let tree: Root;
    try {
      tree = fromMarkdown(body);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to parse Markdown for security diagnostics: ${detail}`,
        { cause: error },
      );
    }

    this.records = collectNodeRecords(tree);
    this.headings = this.records
      .filter(
        (record): record is NodeRecord & { node: Heading } =>
          record.node.type === "heading",
      )
      .map(({ node }) => ({
        ...sourceRange(node, bodyStart),
        depth: node.depth,
        text: nodeText(node),
      }));
    this.inlineCodeRanges = this.records
      .filter(
        (record): record is NodeRecord & { node: InlineCode } =>
          record.node.type === "inlineCode",
      )
      .map(({ node }) => sourceRange(node, bodyStart));
    this.htmlRanges = this.records
      .filter(
        (record): record is NodeRecord & { node: Html } =>
          record.node.type === "html",
      )
      .map(({ node }) => sourceRange(node, bodyStart));
    const htmlRecords = this.records.filter(
      (record): record is NodeRecord & { node: Html } =>
        record.node.type === "html",
    );
    const commentRanges = htmlRecords.flatMap(({ node }) =>
      htmlCommentSourceRanges(node, bodyStart),
    );
    this.htmlCommentRanges = commentRanges.map(({ startLine, endLine }) => ({
      startLine,
      endLine,
    }));
    this.thematicBreakRanges = this.records
      .filter(({ node }) => node.type === "thematicBreak")
      .map(({ node }) => sourceRange(node, bodyStart));
    this.visibleLines = stripCommentNodes(this.lines, commentRanges);

    for (const { node, ancestors } of this.records) {
      if (
        node.type === "blockquote" ||
        ancestors.some((ancestor) => ancestor.type === "blockquote")
      ) {
        const range = sourceRange(node, bodyStart);
        for (let line = range.startLine; line <= range.endLine; line += 1) {
          this.blockQuoteLines.add(line - 1);
        }
      }
    }

    this.paragraphs = this.records
      .filter(
        (record): record is NodeRecord & { node: Paragraph } =>
          record.node.type === "paragraph",
      )
      .map((record) => this.paragraphView(record, bodyStart));
    this.paragraphs.push(
      ...htmlRecords.flatMap((record) =>
        this.htmlProseViews(record, bodyStart),
      ),
    );
    this.paragraphs.sort((left, right) => left.startLine - right.startLine);
    this.codeBlocks = this.records
      .filter(
        (record): record is NodeRecord & { node: Code } =>
          record.node.type === "code",
      )
      .map((record) => this.codeBlockView(record, bodyStart));
    for (const code of this.codeBlocks) {
      for (let line = code.startLine; line <= code.endLine; line += 1) {
        this.codeByLine.set(line - 1, code);
      }
      if (code.fenced) {
        this.fenceMarkerLines.add(code.startLine - 1);
        if (code.contentEndLine < code.endLine) {
          this.fenceMarkerLines.add(code.endLine - 1);
        }
      }
    }
    this.semanticUnits = [
      ...this.paragraphs.filter((paragraph) => paragraph.operational),
      ...this.codeBlocks.filter((code) => code.operational),
    ].sort((left, right) => left.startLine - right.startLine);
  }

  visibleLine(lineIndex: number): string {
    return this.visibleLines[lineIndex] ?? "";
  }

  isBlockQuotedLine(lineIndex: number): boolean {
    return this.blockQuoteLines.has(lineIndex);
  }

  codeBlockAtLine(lineIndex: number): MarkdownCodeBlockView | undefined {
    return this.codeByLine.get(lineIndex);
  }

  isCodeContentLine(lineIndex: number): boolean {
    return (
      this.codeByLine.has(lineIndex) && !this.fenceMarkerLines.has(lineIndex)
    );
  }

  isFenceMarkerLine(lineIndex: number): boolean {
    return this.fenceMarkerLines.has(lineIndex);
  }

  isInlineCodeLine(line: number): boolean {
    return this.inlineCodeRanges.some(
      (range) => range.startLine <= line && range.endLine >= line,
    );
  }

  sameStructuralSection(
    firstLineIndex: number,
    lastLineIndex: number,
  ): boolean {
    const startLine = firstLineIndex + 1;
    const endLine = lastLineIndex + 1;
    return ![...this.headings, ...this.thematicBreakRanges].some(
      (boundary) =>
        boundary.startLine > startLine && boundary.startLine <= endLine,
    );
  }

  associatedGuardLines(lineIndex: number): string[] {
    const line = lineIndex + 1;
    const record = this.smallestBlockRecordAtLine(line);
    if (record === undefined) return [];
    const candidates = new Set<number>();
    const listItem = [...record.ancestors]
      .reverse()
      .find((ancestor) => ancestor.type === "listItem");
    if (listItem !== undefined) {
      const range = sourceRange(listItem, this.bodyStart);
      for (let current = range.startLine; current <= line; current += 1) {
        candidates.add(current - 1);
      }
    }

    const previous = record.parent.children[record.index - 1];
    if (previous?.type === "paragraph") {
      const range = sourceRange(previous, this.bodyStart);
      for (
        let current = range.startLine;
        current <= range.endLine;
        current += 1
      ) {
        candidates.add(current - 1);
      }
    }

    const safetyHeading = [...this.headingChainAt(line)]
      .reverse()
      .find((heading) => SAFETY_HEADING_RE.test(heading.text));
    if (safetyHeading !== undefined) {
      for (
        let current = safetyHeading.endLine + 1;
        current <= line;
        current += 1
      ) {
        candidates.add(current - 1);
      }
    }
    candidates.delete(lineIndex);
    return [...candidates]
      .sort((left, right) => left - right)
      .map((candidate) => this.visibleLine(candidate));
  }

  instructionSectionText(line: number): string {
    const range = this.sectionRangeAt(line);
    return this.semanticUnits
      .filter(
        (unit) =>
          unit.startLine >= range.startLine && unit.endLine <= range.endLine,
      )
      .flatMap((unit) => unit.lines)
      .join("\n");
  }

  private paragraphView(
    record: NodeRecord & { node: Paragraph },
    bodyStart: number,
  ): MarkdownParagraphView {
    const range = sourceRange(record.node, bodyStart);
    const lines = this.visibleLines
      .slice(range.startLine - 1, range.endLine)
      .map((line) => line.trim());
    const blockQuoted = record.ancestors.some(
      (ancestor) => ancestor.type === "blockquote",
    );
    return {
      kind: "paragraph",
      ...range,
      lines,
      text: lines.join(" ").trim(),
      listItemAncestry: listAncestry(record.ancestors, bodyStart),
      blockQuoted,
      operational:
        !blockQuoted &&
        !lines.every((line) => /^\s*\/\//.test(line)) &&
        !this.isNonOperationalExample(record, range.startLine),
    };
  }

  private codeBlockView(
    record: NodeRecord & { node: Code },
    bodyStart: number,
  ): MarkdownCodeBlockView {
    const range = sourceRange(record.node, bodyStart);
    const opening = this.lines[range.startLine - 1]?.slice(
      (record.node.position?.start.column ?? 1) - 1,
    );
    const fenced = /^(?:`{3,}|~{3,})/.test(opening ?? "");
    const closing =
      fenced &&
      range.endLine > range.startLine &&
      /^(?:`{3,}|~{3,})\s*$/.test(this.lines[range.endLine - 1]?.trim() ?? "");
    const contentStartLine = fenced ? range.startLine + 1 : range.startLine;
    const contentEndLine =
      fenced && closing ? range.endLine - 1 : range.endLine;
    const lines =
      contentEndLine < contentStartLine
        ? []
        : this.lines.slice(contentStartLine - 1, contentEndLine);
    const blockQuoted = record.ancestors.some(
      (ancestor) => ancestor.type === "blockquote",
    );
    const language = record.node.lang?.toLowerCase();
    const semanticLanguage =
      language === undefined ||
      language === "text" ||
      language === "markdown" ||
      language === "md";
    return {
      kind: "code",
      ...range,
      contentStartLine,
      contentEndLine,
      lines,
      text: record.node.value,
      language,
      fenced,
      listItemAncestry: listAncestry(record.ancestors, bodyStart),
      blockQuoted,
      operational:
        fenced &&
        semanticLanguage &&
        !blockQuoted &&
        !this.isNonOperationalExample(record, range.startLine) &&
        this.isOperationalFence(record, range.startLine),
    };
  }

  private isOperationalFence(record: NodeRecord, line: number): boolean {
    const previous = record.parent.children[record.index - 1];
    const previousText = previous === undefined ? "" : nodeText(previous);
    return (
      OPERATIONAL_FENCE_ROUTING_RE.test(previousText) ||
      OPERATIONAL_FENCE_LABEL_RE.test(previousText) ||
      this.headingChainAt(line).some((heading) =>
        OPERATIONAL_FENCE_HEADING_RE.test(heading.text),
      )
    );
  }

  private htmlProseViews(
    record: NodeRecord & { node: Html },
    bodyStart: number,
  ): MarkdownParagraphView[] {
    if (
      /^\s*<(?:script|pre|style|textarea)(?=[\s>])/i.test(record.node.value)
    ) {
      return [];
    }
    const range = sourceRange(record.node, bodyStart);
    const visible = this.visibleLines.slice(range.startLine - 1, range.endLine);
    const views: MarkdownParagraphView[] = [];
    let runStart = -1;
    let runLines: string[] = [];
    const flush = (): void => {
      if (runStart < 0 || runLines.length === 0) return;
      const startLine = range.startLine + runStart;
      const endLine = startLine + runLines.length - 1;
      const text = runLines
        .map((line) => line.trim())
        .join(" ")
        .trim();
      if (text.length > 0) {
        const blockQuoted = record.ancestors.some(
          (ancestor) => ancestor.type === "blockquote",
        );
        views.push({
          kind: "paragraph",
          startLine,
          endLine,
          lines: runLines.map((line) => line.trim()),
          text,
          listItemAncestry: listAncestry(record.ancestors, bodyStart),
          blockQuoted,
          operational:
            !blockQuoted &&
            !this.isNonOperationalExample(record, startLine) &&
            !runLines.every((line) => /^\s*\/\//.test(line)),
        });
      }
      runStart = -1;
      runLines = [];
    };
    visible.forEach((line, index) => {
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^<\/?[A-Za-z][^>]*>\s*$/.test(trimmed) ||
        /^<\?(?:.|\s)*\?>$/.test(trimmed) ||
        /^<![A-Z][^>]*>$/.test(trimmed) ||
        /^<!\[CDATA\[(?:.|\s)*\]\]>$/.test(trimmed)
      ) {
        flush();
        return;
      }
      if (runStart < 0) runStart = index;
      runLines.push(line);
    });
    flush();
    return views;
  }

  private isNonOperationalExample(record: NodeRecord, line: number): boolean {
    if (EXAMPLE_BOUNDARY_RE.test(nodeText(record.node))) return true;
    const previous = record.parent.children[record.index - 1];
    if (previous !== undefined && EXAMPLE_LABEL_RE.test(nodeText(previous))) {
      return true;
    }
    return this.headingChainAt(line).some((heading) =>
      EXAMPLE_BOUNDARY_RE.test(heading.text),
    );
  }

  private headingChainAt(line: number): HeadingRecord[] {
    return this.headings.filter((heading, index) => {
      if (heading.startLine > line) return false;
      const nextBoundary = this.headings
        .slice(index + 1)
        .find((candidate) => candidate.depth <= heading.depth);
      return nextBoundary === undefined || nextBoundary.startLine > line;
    });
  }

  private sectionRangeAt(line: number): MarkdownSourceRange {
    const heading = [...this.headings]
      .reverse()
      .find((candidate) => candidate.startLine <= line);
    if (heading === undefined) {
      return {
        startLine: Math.max(this.bodyStart + 1, line - 6),
        endLine: Math.min(this.lines.length, line + 6),
      };
    }
    const next = this.headings.find(
      (candidate) =>
        candidate.startLine > heading.startLine &&
        candidate.depth <= heading.depth,
    );
    return {
      startLine: heading.endLine + 1,
      endLine: (next?.startLine ?? this.lines.length + 1) - 1,
    };
  }

  private smallestBlockRecordAtLine(line: number): NodeRecord | undefined {
    return this.records
      .filter(({ node }) => {
        if (!isBlockNode(node)) return false;
        const range = sourceRange(node, this.bodyStart);
        return range.startLine <= line && range.endLine >= line;
      })
      .sort((left, right) => {
        const leftRange = sourceRange(left.node, this.bodyStart);
        const rightRange = sourceRange(right.node, this.bodyStart);
        return (
          leftRange.endLine -
          leftRange.startLine -
          (rightRange.endLine - rightRange.startLine)
        );
      })[0];
  }
}

export function createMarkdownSecurityView(
  content: string,
  bodyStart: number,
): MarkdownSecurityView {
  return new MarkdownSecurityView(content, bodyStart);
}

function collectNodeRecords(root: Root): NodeRecord[] {
  const records: NodeRecord[] = [];
  const visit = (parent: Parent, ancestors: Parent[]): void => {
    parent.children.forEach((node, index) => {
      records.push({
        node: node as PositionedNode,
        parent,
        index,
        ancestors,
      });
      if ("children" in node) visit(node, [...ancestors, node]);
    });
  };
  visit(root, [root]);
  return records;
}

function sourceRange(
  node: { position?: Position | undefined },
  bodyStart: number,
): MarkdownSourceRange {
  const position = node.position;
  if (position === undefined) {
    throw new Error(
      "Markdown parser returned a node without a source position",
    );
  }
  return {
    startLine: bodyStart + position.start.line,
    endLine: bodyStart + position.end.line,
  };
}

function listAncestry(
  ancestors: Parent[],
  bodyStart: number,
): MarkdownListItemAncestry[] {
  const ancestry: MarkdownListItemAncestry[] = [];
  for (let index = 0; index < ancestors.length; index += 1) {
    const node = ancestors[index];
    if (node === undefined || node.type !== "listItem") continue;
    const list = [...ancestors.slice(0, index)]
      .reverse()
      .find((ancestor): ancestor is List => ancestor.type === "list");
    ancestry.push({
      ...sourceRange(node, bodyStart),
      depth: ancestry.length + 1,
      ordered: list?.ordered ?? false,
      start: list?.start ?? undefined,
    });
  }
  return ancestry;
}

function nodeText(node: RootContent | Parent): string {
  if (node.type === "text" || node.type === "inlineCode") {
    return (node as Text | InlineCode).value;
  }
  if (node.type === "html") {
    const value = (node as Html).value;
    return value.trimStart().startsWith("<!--") ? "" : value;
  }
  if ("children" in node) return node.children.map(nodeText).join(" ");
  return "";
}

function stripCommentNodes(
  lines: string[],
  comments: HtmlCommentSourceRange[],
): string[] {
  const removals = new Map<number, RemovedRange[]>();
  for (const comment of comments) {
    const startLine = comment.startLine - 1;
    const endLine = comment.endLine - 1;
    for (let line = startLine; line <= endLine; line += 1) {
      const source = lines[line] ?? "";
      const range = {
        start: line === startLine ? comment.startColumn - 1 : 0,
        end: line === endLine ? comment.endColumn - 1 : source.length,
      };
      const existing = removals.get(line) ?? [];
      existing.push(range);
      removals.set(line, existing);
    }
  }
  return lines.map((line, index) => removeRanges(line, removals.get(index)));
}

function htmlCommentSourceRanges(
  node: Html,
  bodyStart: number,
): HtmlCommentSourceRange[] {
  if (/^\s*<(?:script|pre|style|textarea)(?=[\s>])/i.test(node.value)) {
    return [];
  }
  const position = node.position;
  if (position === undefined) return [];
  const ranges: HtmlCommentSourceRange[] = [];
  let cursor = 0;
  while (cursor < node.value.length) {
    const start = node.value.indexOf("<!--", cursor);
    if (start < 0) break;
    const markerEnd = node.value.indexOf("-->", start + 4);
    const end = markerEnd < 0 ? node.value.length : markerEnd + 3;
    const startPoint = relativeSourcePoint(
      node.value,
      start,
      position.start.line + bodyStart,
      position.start.column,
    );
    const endPoint = relativeSourcePoint(
      node.value,
      end,
      position.start.line + bodyStart,
      position.start.column,
    );
    ranges.push({
      startLine: startPoint.line,
      endLine: endPoint.line,
      startColumn: startPoint.column,
      endColumn: endPoint.column,
    });
    cursor = end;
  }
  return ranges;
}

function relativeSourcePoint(
  value: string,
  offset: number,
  startLine: number,
  startColumn: number,
): { line: number; column: number } {
  const prefix = value.slice(0, offset);
  const lineBreaks = prefix.match(/\n/g)?.length ?? 0;
  const lastBreak = prefix.lastIndexOf("\n");
  return {
    line: startLine + lineBreaks,
    column: lineBreaks === 0 ? startColumn + offset : offset - lastBreak,
  };
}

function removeRanges(
  line: string,
  ranges: RemovedRange[] | undefined,
): string {
  if (ranges === undefined || ranges.length === 0) return line;
  let cursor = 0;
  let result = "";
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const visible = line.slice(cursor, range.start);
    result += visible;
    cursor = Math.max(cursor, range.end);
    if (result.length > 0 && !/\s$/.test(result)) result += " ";
  }
  result += line.slice(cursor);
  return result;
}

function lineStartOffset(content: string, lineIndex: number): number {
  let offset = 0;
  for (let line = 0; line < lineIndex; line += 1) {
    const next = content.indexOf("\n", offset);
    if (next < 0) return content.length;
    offset = next + 1;
  }
  return offset;
}

function isBlockNode(node: PositionedNode): boolean {
  return (
    node.type === "paragraph" ||
    node.type === "code" ||
    node.type === "heading" ||
    node.type === "html"
  );
}
