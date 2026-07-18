import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  Code,
  Heading,
  Html,
  InlineCode,
  Paragraph,
  Parent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type { Position } from "unist";

type MarkdownSourceRange = {
  startLine: number;
  endLine: number;
};

export type MarkdownSemanticUnit = MarkdownSourceRange & {
  kind: "paragraph" | "code";
  lines: string[];
  contentStartLine?: number;
};

type PositionedNode = RootContent;

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

type SourceColumnRange = MarkdownSourceRange & {
  startColumn: number;
  endColumn: number;
};

type SemanticOffsetRange = { start: number; end: number };
type RemovedRange = { start: number; end: number };

type SemanticCandidate = {
  unit: MarkdownSemanticUnit;
  operational: boolean;
};

type CodeBlockCandidate = SemanticCandidate & {
  contentEndLine: number;
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
  readonly semanticUnits: MarkdownSemanticUnit[];

  private readonly sourceLines: string[];
  private readonly bodyStart: number;
  private readonly records: NodeRecord[];
  private readonly visibleLines: string[];
  private readonly headings: HeadingRecord[];
  private readonly thematicBreaks: MarkdownSourceRange[];
  private readonly blockQuoteLines = new Set<number>();
  private readonly codeBlockLines = new Set<number>();
  private readonly codeContentLines = new Set<number>();
  private readonly inlineCodeByUnit = new WeakMap<
    MarkdownSemanticUnit,
    SemanticOffsetRange[]
  >();

  constructor(content: string, bodyStart: number) {
    this.sourceLines = content.split(/\r?\n/);
    this.bodyStart = bodyStart;
    const body = this.sourceLines.slice(bodyStart).join("\n");
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
    const headings: HeadingRecord[] = [];
    const thematicBreaks: MarkdownSourceRange[] = [];
    const inlineCodeRanges: SourceColumnRange[] = [];
    const htmlRecords: Array<NodeRecord & { node: Html }> = [];
    const paragraphRecords: Array<NodeRecord & { node: Paragraph }> = [];
    const codeRecords: Array<NodeRecord & { node: Code }> = [];
    for (const record of this.records) {
      switch (record.node.type) {
        case "heading": {
          const node = record.node as Heading;
          headings.push({
            ...sourceRange(node, bodyStart),
            depth: node.depth,
            text: nodeText(node),
          });
          break;
        }
        case "thematicBreak":
          thematicBreaks.push(sourceRange(record.node, bodyStart));
          break;
        case "blockquote":
          addLines(this.blockQuoteLines, sourceRange(record.node, bodyStart));
          break;
        case "inlineCode":
          inlineCodeRanges.push(sourceColumnRange(record.node, bodyStart));
          break;
        case "html":
          htmlRecords.push(record as NodeRecord & { node: Html });
          break;
        case "paragraph":
          paragraphRecords.push(record as NodeRecord & { node: Paragraph });
          break;
        case "code":
          codeRecords.push(record as NodeRecord & { node: Code });
      }
    }
    this.headings = headings;
    this.thematicBreaks = thematicBreaks;
    const commentRanges = htmlRecords.flatMap(({ node }) =>
      htmlCommentSourceRanges(node, bodyStart),
    );
    this.visibleLines = stripCommentRanges(this.sourceLines, commentRanges);

    const paragraphCandidates = paragraphRecords.map((record) =>
      this.paragraphCandidate(record),
    );
    paragraphCandidates.push(
      ...htmlRecords
        .filter(
          (record) =>
            !record.ancestors.some(
              (ancestor) =>
                ancestor.type === "paragraph" || ancestor.type === "heading",
            ),
        )
        .flatMap((record) => this.htmlProseCandidates(record)),
    );

    const codeBlocks = codeRecords.map((record) =>
      this.codeBlockCandidate(record),
    );
    for (const code of codeBlocks) {
      addLines(this.codeBlockLines, code.unit);
      const contentStartLine = code.unit.contentStartLine;
      if (contentStartLine === undefined) continue;
      if (code.contentEndLine >= contentStartLine) {
        addLines(this.codeContentLines, {
          startLine: contentStartLine,
          endLine: code.contentEndLine,
        });
      }
    }

    this.semanticUnits = [...paragraphCandidates, ...codeBlocks]
      .filter((candidate) => candidate.operational)
      .map((candidate) => candidate.unit)
      .sort((left, right) => left.startLine - right.startLine);
    for (const unit of this.semanticUnits) {
      this.inlineCodeByUnit.set(
        unit,
        semanticInlineCodeRanges(unit, this.sourceLines, inlineCodeRanges),
      );
    }
  }

  visibleLine(lineIndex: number): string {
    return this.visibleLines[lineIndex] ?? "";
  }

  isBlockQuotedLine(lineIndex: number): boolean {
    return this.blockQuoteLines.has(lineIndex);
  }

  isCodeBlockLine(lineIndex: number): boolean {
    return this.codeBlockLines.has(lineIndex);
  }

  isCodeContentLine(lineIndex: number): boolean {
    return this.codeContentLines.has(lineIndex);
  }

  inlineCodeProse(unit: MarkdownSemanticUnit, text: string): string {
    let projection = text;
    for (const range of this.inlineCodeByUnit.get(unit) ?? []) {
      const start = Math.max(0, Math.min(projection.length, range.start));
      const end = Math.max(start, Math.min(projection.length, range.end));
      projection =
        projection.slice(0, start) +
        " ".repeat(end - start) +
        projection.slice(end);
    }
    return projection;
  }

  sameStructuralSection(
    firstLineIndex: number,
    lastLineIndex: number,
  ): boolean {
    const startLine = firstLineIndex + 1;
    const endLine = lastLineIndex + 1;
    return ![...this.headings, ...this.thematicBreaks].some(
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
      addLines(candidates, { ...range, endLine: line });
    }

    const previous = record.parent.children[record.index - 1];
    if (previous?.type === "paragraph") {
      addLines(candidates, sourceRange(previous, this.bodyStart));
    }

    const safetyHeading = [...this.headingChainAt(line)]
      .reverse()
      .find((heading) => SAFETY_HEADING_RE.test(heading.text));
    if (safetyHeading !== undefined) {
      addLines(candidates, {
        startLine: safetyHeading.endLine + 1,
        endLine: line,
      });
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

  private paragraphCandidate(
    record: NodeRecord & { node: Paragraph },
  ): SemanticCandidate {
    const range = sourceRange(record.node, this.bodyStart);
    const lines = this.visibleLines
      .slice(range.startLine - 1, range.endLine)
      .map((line) => line.trim());
    const blockQuoted = record.ancestors.some(
      (ancestor) => ancestor.type === "blockquote",
    );
    return {
      unit: { kind: "paragraph", ...range, lines },
      operational:
        !blockQuoted &&
        !lines.every((line) => /^\s*\/\//.test(line)) &&
        !this.isNonOperationalExample(record, range.startLine),
    };
  }

  private codeBlockCandidate(
    record: NodeRecord & { node: Code },
  ): CodeBlockCandidate {
    const range = sourceRange(record.node, this.bodyStart);
    const opening = this.sourceLines[range.startLine - 1]?.slice(
      (record.node.position?.start.column ?? 1) - 1,
    );
    const fenced = /^(?:`{3,}|~{3,})/.test(opening ?? "");
    const closed =
      fenced &&
      range.endLine > range.startLine &&
      /^(?:`{3,}|~{3,})\s*$/.test(
        this.sourceLines[range.endLine - 1]?.trim() ?? "",
      );
    const contentStartLine = fenced ? range.startLine + 1 : range.startLine;
    const contentEndLine = fenced && closed ? range.endLine - 1 : range.endLine;
    const lines =
      contentEndLine < contentStartLine
        ? []
        : this.sourceLines.slice(contentStartLine - 1, contentEndLine);
    const language = record.node.lang?.toLowerCase();
    const semanticLanguage =
      language === undefined ||
      language === "text" ||
      language === "markdown" ||
      language === "md";
    const blockQuoted = record.ancestors.some(
      (ancestor) => ancestor.type === "blockquote",
    );
    return {
      unit: { kind: "code", ...range, contentStartLine, lines },
      contentEndLine,
      operational:
        fenced &&
        semanticLanguage &&
        !blockQuoted &&
        !this.isNonOperationalExample(record, range.startLine) &&
        this.isOperationalFence(record, range.startLine),
    };
  }

  private htmlProseCandidates(
    record: NodeRecord & { node: Html },
  ): SemanticCandidate[] {
    if (
      /^\s*<(?:script|pre|style|textarea)(?=[\s>])/i.test(record.node.value)
    ) {
      return [];
    }
    const range = sourceRange(record.node, this.bodyStart);
    const visible = this.visibleLines.slice(range.startLine - 1, range.endLine);
    const candidates: SemanticCandidate[] = [];
    let runStart = -1;
    let runLines: string[] = [];
    const flush = (): void => {
      if (runStart < 0 || runLines.length === 0) return;
      const startLine = range.startLine + runStart;
      const lines = runLines.map((line) => line.trim());
      if (lines.join(" ").trim().length > 0) {
        const blockQuoted = record.ancestors.some(
          (ancestor) => ancestor.type === "blockquote",
        );
        candidates.push({
          unit: {
            kind: "paragraph",
            startLine,
            endLine: startLine + lines.length - 1,
            lines,
          },
          operational:
            !blockQuoted &&
            !this.isNonOperationalExample(record, startLine) &&
            !lines.every((line) => /^\s*\/\//.test(line)),
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
    return candidates;
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
        endLine: Math.min(this.sourceLines.length, line + 6),
      };
    }
    const next = this.headings.find(
      (candidate) =>
        candidate.startLine > heading.startLine &&
        candidate.depth <= heading.depth,
    );
    return {
      startLine: heading.endLine + 1,
      endLine: (next?.startLine ?? this.sourceLines.length + 1) - 1,
    };
  }

  private smallestBlockRecordAtLine(line: number): NodeRecord | undefined {
    return this.records.findLast(({ node }) => {
      if (!isBlockNode(node)) return false;
      const range = sourceRange(node, this.bodyStart);
      return range.startLine <= line && range.endLine >= line;
    });
  }
}

function collectNodeRecords(root: Root): NodeRecord[] {
  const records: NodeRecord[] = [];
  const visit = (parent: Parent, ancestors: Parent[]): void => {
    parent.children.forEach((node, index) => {
      if (isSecurityRecordType(node.type)) {
        records.push({
          node: node as PositionedNode,
          parent,
          index,
          ancestors,
        });
      }
      if ("children" in node) visit(node, [...ancestors, node]);
    });
  };
  visit(root, [root]);
  return records;
}

function isSecurityRecordType(type: string): boolean {
  return /^(?:blockquote|code|heading|html|inlineCode|paragraph|thematicBreak)$/.test(
    type,
  );
}

function sourceRange(
  node: { position?: Position | undefined },
  bodyStart: number,
): MarkdownSourceRange {
  const position = requiredPosition(node);
  return {
    startLine: bodyStart + position.start.line,
    endLine: bodyStart + position.end.line,
  };
}

function sourceColumnRange(
  node: { position?: Position | undefined },
  bodyStart: number,
): SourceColumnRange {
  const position = requiredPosition(node);
  return {
    startLine: bodyStart + position.start.line,
    endLine: bodyStart + position.end.line,
    startColumn: position.start.column,
    endColumn: position.end.column,
  };
}

function requiredPosition(node: { position?: Position | undefined }): Position {
  if (node.position !== undefined) return node.position;
  throw new Error("Markdown parser returned a node without a source position");
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

function semanticInlineCodeRanges(
  unit: MarkdownSemanticUnit,
  sourceLines: string[],
  inlineCodeRanges: SourceColumnRange[],
): SemanticOffsetRange[] {
  if (unit.kind === "code") return [];
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of unit.lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  const semanticOffset = (line: number, column: number): number => {
    const lineIndex = line - unit.startLine;
    const semanticLine = unit.lines[lineIndex] ?? "";
    const sourceLine = sourceLines[line - 1] ?? "";
    const leadingWhitespace = sourceLine.length - sourceLine.trimStart().length;
    const columnOffset = Math.max(
      0,
      Math.min(semanticLine.length, column - 1 - leadingWhitespace),
    );
    return (lineOffsets[lineIndex] ?? 0) + columnOffset;
  };
  return inlineCodeRanges
    .filter(
      (range) =>
        range.startLine >= unit.startLine && range.endLine <= unit.endLine,
    )
    .map((range) => ({
      start: semanticOffset(range.startLine, range.startColumn),
      end: semanticOffset(range.endLine, range.endColumn),
    }));
}

function stripCommentRanges(
  lines: string[],
  comments: SourceColumnRange[],
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
  return lines.map((line, index) => {
    const ranges = removals.get(index);
    if (ranges === undefined) return line;
    let cursor = 0;
    let result = "";
    for (const range of ranges.sort(
      (left, right) => left.start - right.start,
    )) {
      result += line.slice(cursor, range.start);
      cursor = Math.max(cursor, range.end);
      if (result.length > 0 && !/\s$/.test(result)) result += " ";
    }
    return result + line.slice(cursor);
  });
}

function htmlCommentSourceRanges(
  node: Html,
  bodyStart: number,
): SourceColumnRange[] {
  if (/^\s*<(?:script|pre|style|textarea)(?=[\s>])/i.test(node.value)) {
    return [];
  }
  const position = node.position;
  if (position === undefined) return [];
  const ranges: SourceColumnRange[] = [];
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

function addLines(target: Set<number>, range: MarkdownSourceRange): void {
  for (let line = range.startLine; line <= range.endLine; line += 1) {
    target.add(line - 1);
  }
}

function isBlockNode(node: PositionedNode): boolean {
  return (
    node.type === "paragraph" ||
    node.type === "code" ||
    node.type === "heading" ||
    node.type === "html"
  );
}
