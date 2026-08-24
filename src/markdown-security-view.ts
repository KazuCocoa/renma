import type {
  Blockquote,
  Code,
  Heading,
  Html,
  InlineCode,
  Nodes,
  Paragraph,
  ThematicBreak,
} from "mdast";

import { boundedClauseRanges } from "./bounded-clause-ranges.js";
import {
  markdownNodeText as nodeText,
  markdownSourceColumnRange as sourceColumnRange,
  markdownSourceRange as sourceRange,
  parseMarkdownSyntax,
  requiredMarkdownPosition as requiredPosition,
  type MarkdownNodeRecord,
  type MarkdownCodeBlockRecord,
  type MarkdownLinkTargetRecord,
  type MarkdownSourceRange,
  type MarkdownSyntax,
} from "./markdown-syntax.js";

export type MarkdownSemanticUnit = MarkdownSourceRange & {
  kind: "paragraph" | "code";
  lines: string[];
  contentStartLine?: number;
};

export type MarkdownSecurityEligibility =
  "markdown-structured" | "plain-text-structured" | "raw-agent-visible";

/** Raw source that an agent can read even though Markdown renderers hide it. */
export type MarkdownHtmlComment = MarkdownSourceRange & {
  startColumn: number;
  endColumn: number;
  content: string;
};

export type SecurityGuardEvidence = MarkdownSourceRange & {
  kind:
    | "same-instruction"
    | "same-list-item"
    | "preceding-paragraph"
    | "safety-section";
  text: string;
};

type PositionedNode = Nodes;
type NodeRecord = MarkdownNodeRecord;
type SecurityNode =
  Blockquote | Code | Heading | Html | InlineCode | Paragraph | ThematicBreak;
type RecordForNode<T extends Nodes> = T extends Nodes
  ? NodeRecord & { node: T }
  : never;
type SecurityNodeRecord = RecordForNode<SecurityNode>;

type HeadingRecord = MarkdownSourceRange & {
  depth: number;
  text: string;
};

type SemanticOffsetRange = { start: number; end: number };

type SourceColumnRange = {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
};

type VisibleLineProjection = {
  text: string;
  sourceToVisibleOffsets: number[];
};

type RemovedRange = { start: number; end: number };

type SemanticCandidate = {
  unit: MarkdownSemanticUnit;
  operational: boolean;
  htmlDerived?: true;
};

type CodeBlockCandidate = SemanticCandidate & {
  contentEndLine: number;
};

const EXAMPLE_BOUNDARY_RE =
  /\b(unsafe|negative|prohibited|forbidden|noncompliant|bad)\s+(?:example|pattern)s?\b|\bwhat not to do\b/i;
const EXAMPLE_LABEL_RE =
  /\b(unsafe|negative|prohibited|forbidden|noncompliant|bad)\s+examples?\s*:\s*$/i;
const OPERATIONAL_BLOCK_ROUTING_RE =
  /\b(use|follow|apply|execute|run|perform|carry out)\b.{0,60}\b(following|below|these)\b.{0,40}\b(instructions?|steps?|procedure|workflow|payload)\b|\b(following|below)\b.{0,40}\b(instructions?|steps?|procedure|workflow|payload)\b.{0,40}\b(exactly|verbatim|as written)\b|\bfollow\b.{0,40}\b(?:this|the)\b.{0,20}\b(?:operational\s+)?instruction\b/i;
const OPERATIONAL_BLOCK_LABEL_RE =
  /^\s*(?:(?:operational|execution)\s+)?(?:instructions?|steps?|procedure|workflow|payload)\s*:\s*$/i;
const OPERATIONAL_BLOCK_HEADING_RE =
  /\b(instructions?|operational instructions?|execution instructions?|procedure|runbook)\b/i;
const NON_OPERATIONAL_QUOTATION_CONTEXT_RE =
  /\b(?:ordinary|illustrative|reported|cited)\s+(?:quotation|quote|excerpt)\b|\b(?:incident|audit|review|source)\s+(?:report|evidence)\b.{0,60}\b(?:quotation|quote|excerpt)\b|\b(?:quotation|quote|excerpt)\b.{0,60}\b(?:incident|report|evidence)\b|\b(?:included|contains?|records?|quoted)\b.{0,40}\b(?:quotation|quote|excerpt)\b/i;
const NON_OPERATIONAL_ATTRIBUTION_CONTEXT_RE =
  /^\s*(?:(?:the\s+)?(?:(?:incident|security|audit|review|source)\s+)?(?:report|audit|evidence|record|transcript|log|finding)s?\s+(?:says?|states?|reports?|notes?|records?|reads?|shows?)|according\s+to\s+(?:the\s+)?(?:(?:incident|security|audit|review|source)\s+)?(?:report|audit|evidence|record|transcript|log|finding)s?)\s*:\s*$/i;
const SAFETY_HEADING_RE =
  /\b(human approval|safety|constraints?|guardrails?)\b/i;

/** Remove comments while retaining source-to-visible offset mapping. */
function projectVisibleLines(
  lines: string[],
  comments: SourceColumnRange[],
): VisibleLineProjection[] {
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
      removals.set(line, [...(removals.get(line) ?? []), range]);
    }
  }

  return lines.map((line, index) => {
    const sourceToVisibleOffsets = Array<number>(line.length + 1).fill(0);
    const ranges = (removals.get(index) ?? []).sort(
      (left, right) => left.start - right.start,
    );
    let sourceOffset = 0;
    let text = "";
    const appendSourceThrough = (end: number): void => {
      while (sourceOffset < end) {
        sourceToVisibleOffsets[sourceOffset] = text.length;
        text += line[sourceOffset] ?? "";
        sourceOffset += 1;
      }
      sourceToVisibleOffsets[sourceOffset] = text.length;
    };
    for (const range of ranges) {
      const start = Math.max(sourceOffset, Math.min(line.length, range.start));
      const end = Math.max(start, Math.min(line.length, range.end));
      appendSourceThrough(start);
      while (sourceOffset < end) {
        sourceToVisibleOffsets[sourceOffset] = text.length;
        sourceOffset += 1;
      }
      if (text.length > 0 && !/\s$/.test(text)) text += " ";
      sourceToVisibleOffsets[sourceOffset] = text.length;
    }
    appendSourceThrough(line.length);
    return { text, sourceToVisibleOffsets };
  });
}

export class MarkdownSecurityView {
  readonly semanticUnits: MarkdownSemanticUnit[];
  readonly htmlComments: MarkdownHtmlComment[];
  readonly resolvedDestinations: readonly MarkdownLinkTargetRecord[];

  private readonly sourceLines: string[];
  readonly bodyStartLine: number;
  private readonly records: SecurityNodeRecord[];
  private readonly visibleLines: string[];
  private readonly headings: HeadingRecord[];
  private readonly thematicBreaks: MarkdownSourceRange[];
  private readonly blockQuoteLines = new Set<number>();
  private readonly operationalBlockQuoteLines = new Set<number>();
  private readonly nonOperationalExampleLines = new Set<number>();
  private readonly nonOperationalExampleRangesByLine = new Map<
    number,
    SemanticOffsetRange[]
  >();
  private readonly codeBlockLines = new Set<number>();
  private readonly codeContentLines = new Set<number>();
  private readonly codeBlocksByNode: ReadonlyMap<Code, MarkdownCodeBlockRecord>;
  private readonly codeBlocks: readonly MarkdownCodeBlockRecord[];
  private readonly definitionLines = new Set<number>();
  private readonly visibleLineProjections: readonly VisibleLineProjection[];
  private readonly eligibility: MarkdownSecurityEligibility;
  private readonly inlineCodeByUnit = new WeakMap<
    MarkdownSemanticUnit,
    SemanticOffsetRange[]
  >();

  constructor(
    syntax: MarkdownSyntax,
    eligibility: MarkdownSecurityEligibility = "markdown-structured",
  ) {
    this.sourceLines = syntax.sourceLines;
    this.bodyStartLine = syntax.bodyStartLine;
    this.resolvedDestinations = syntax.linkTargets;
    this.eligibility = eligibility;
    for (const definition of syntax.definitions) {
      for (
        let line = definition.startLine;
        line <= definition.endLine;
        line += 1
      ) {
        this.definitionLines.add(line - 1);
      }
    }
    this.codeBlocks =
      eligibility === "raw-agent-visible" ? [] : syntax.codeBlocks;
    this.codeBlocksByNode = new Map(
      this.codeBlocks.map((block) => [block.node, block]),
    );
    this.records =
      eligibility === "raw-agent-visible"
        ? []
        : syntax.records.filter(isSecurityRecord);
    if (eligibility === "raw-agent-visible") {
      this.headings = [];
      this.thematicBreaks = [];
      this.htmlComments = [];
      this.visibleLines = [...this.sourceLines];
      this.visibleLineProjections = this.sourceLines.map((text) => ({
        text,
        sourceToVisibleOffsets: Array.from(
          { length: text.length + 1 },
          (_, index) => index,
        ),
      }));
      this.semanticUnits = this.sourceLines.some((line) => line.trim())
        ? [
            {
              kind: "paragraph",
              startLine: this.bodyStartLine,
              endLine: this.sourceLines.length,
              lines: this.sourceLines.slice(this.bodyStartLine - 1),
            },
          ]
        : [];
      return;
    }
    const headings: HeadingRecord[] = [];
    const thematicBreaks: MarkdownSourceRange[] = [];
    const inlineCodeRanges: SourceColumnRange[] = [];
    const htmlRecords: Array<NodeRecord & { node: Html }> = [];
    const paragraphRecords: Array<NodeRecord & { node: Paragraph }> = [];
    const codeRecords: Array<NodeRecord & { node: Code }> = [];
    for (const record of this.records) {
      switch (record.node.type) {
        case "heading": {
          const node = record.node;
          headings.push({
            ...sourceRange(node, this.bodyStartLine),
            depth: node.depth,
            text: nodeText(node),
          });
          break;
        }
        case "thematicBreak":
          thematicBreaks.push(sourceRange(record.node, this.bodyStartLine));
          break;
        case "blockquote":
          addLines(
            this.blockQuoteLines,
            sourceRange(record.node, this.bodyStartLine),
          );
          break;
        case "inlineCode":
          inlineCodeRanges.push(
            sourceColumnRange(record.node, this.bodyStartLine),
          );
          break;
        case "html":
          htmlRecords.push({ ...record, node: record.node });
          break;
        case "paragraph":
          paragraphRecords.push({ ...record, node: record.node });
          break;
        case "code":
          codeRecords.push({ ...record, node: record.node });
      }
    }
    this.headings = headings;
    this.thematicBreaks = thematicBreaks;
    this.htmlComments =
      eligibility === "plain-text-structured"
        ? []
        : htmlRecords.flatMap(({ node }) =>
            htmlComments(node, this.bodyStartLine),
          );
    const visibleLineProjections = projectVisibleLines(
      this.sourceLines,
      this.htmlComments,
    );
    this.visibleLineProjections = visibleLineProjections;
    this.visibleLines = visibleLineProjections.map(({ text }) => text);

    const paragraphCandidates = paragraphRecords.map((record) =>
      this.paragraphCandidate(record),
    );
    const htmlCandidates = htmlRecords
      .filter(
        (record) =>
          !record.ancestors.some(
            (ancestor) =>
              ancestor.type === "paragraph" || ancestor.type === "heading",
          ),
      )
      .flatMap((record) => this.htmlProseCandidates(record));

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

    const semanticCandidates = [
      ...paragraphCandidates,
      ...htmlCandidates,
      ...codeBlocks,
    ]
      .flatMap((candidate) => this.operationalCandidateSegments(candidate))
      .sort((left, right) => left.unit.startLine - right.unit.startLine);
    this.semanticUnits = semanticCandidates.map((candidate) => candidate.unit);
    for (const candidate of semanticCandidates) {
      this.inlineCodeByUnit.set(
        candidate.unit,
        semanticInlineCodeRanges(
          candidate.unit,
          visibleLineProjections,
          inlineCodeRanges,
          candidate.htmlDerived === true,
        ),
      );
    }
  }

  visibleLine(lineIndex: number): string {
    return this.visibleLines[lineIndex] ?? "";
  }

  usesRawAgentVisibleEligibility(): boolean {
    return this.eligibility === "raw-agent-visible";
  }

  isBlockQuotedLine(lineIndex: number): boolean {
    return this.blockQuoteLines.has(lineIndex);
  }

  isOperationalBlockQuotedLine(lineIndex: number): boolean {
    return this.operationalBlockQuoteLines.has(lineIndex);
  }

  isNonOperationalExampleLine(lineIndex: number): boolean {
    return this.nonOperationalExampleLines.has(lineIndex);
  }

  isLinkDefinitionLine(lineIndex: number): boolean {
    return this.definitionLines.has(lineIndex);
  }

  /** Map a one-based original source column into the visible projection. */
  visibleOffsetForSourceColumn(lineIndex: number, column: number): number {
    const projection = this.visibleLineProjections[lineIndex];
    if (projection === undefined) return 0;
    const sourceOffset = Math.max(
      0,
      Math.min(projection.sourceToVisibleOffsets.length - 1, column - 1),
    );
    return projection.sourceToVisibleOffsets[sourceOffset] ?? 0;
  }

  instructionLine(lineIndex: number): string {
    const line = this.nonOperationalExampleProjection(lineIndex);
    if (!this.isOperationalBlockQuotedLine(lineIndex)) return line;
    return line.replace(/^(?:\s{0,3}>[ \t]?)+/u, (prefix) =>
      " ".repeat(prefix.length),
    );
  }

  isCodeBlockLine(lineIndex: number): boolean {
    return this.codeBlockLines.has(lineIndex);
  }

  isCodeContentLine(lineIndex: number): boolean {
    return this.codeContentLines.has(lineIndex);
  }

  languageAt(lineIndex: number): string | undefined {
    const line = lineIndex + 1;
    return this.codeBlocks.find(
      (block) => block.contentStartLine <= line && block.contentEndLine >= line,
    )?.language;
  }

  sameMarkdownBlock(firstLineIndex: number, lastLineIndex: number): boolean {
    if (this.usesRawAgentVisibleEligibility()) {
      return (
        firstLineIndex >= this.bodyStartLine - 1 &&
        lastLineIndex >= firstLineIndex &&
        lastLineIndex < this.sourceLines.length
      );
    }
    const first = this.smallestBlockRecordAtLine(firstLineIndex + 1);
    const last = this.smallestBlockRecordAtLine(lastLineIndex + 1);
    return first !== undefined && first === last;
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
    if (this.usesRawAgentVisibleEligibility()) return true;
    if (
      this.isBlockQuotedLine(firstLineIndex) !==
      this.isBlockQuotedLine(lastLineIndex)
    ) {
      return false;
    }
    const startLine = firstLineIndex + 1;
    const endLine = lastLineIndex + 1;
    return ![...this.headings, ...this.thematicBreaks].some(
      (boundary) =>
        boundary.startLine > startLine && boundary.startLine <= endLine,
    );
  }

  associatedGuardLines(lineIndex: number): string[] {
    const lines = this.associatedGuardEvidence(lineIndex).flatMap((evidence) =>
      evidence.text.split("\n"),
    );
    return [...new Set(lines)];
  }

  associatedGuardEvidence(lineIndex: number): SecurityGuardEvidence[] {
    if (this.usesRawAgentVisibleEligibility()) return [];
    const line = lineIndex + 1;
    const record = this.smallestBlockRecordAtLine(line);
    if (record === undefined) return [];
    const candidates: Array<{
      kind: SecurityGuardEvidence["kind"];
      range: MarkdownSourceRange;
      includeCodeContent: boolean;
    }> = [];

    const recordRange = sourceRange(record.node, this.bodyStartLine);
    if (recordRange.startLine < line) {
      candidates.push({
        kind: "same-instruction",
        range: { ...recordRange, endLine: line - 1 },
        includeCodeContent: record.node.type === "code",
      });
    }

    const listItem = [...record.ancestors]
      .reverse()
      .find((ancestor) => ancestor.type === "listItem");
    if (listItem !== undefined) {
      const range = sourceRange(listItem, this.bodyStartLine);
      if (range.startLine < line) {
        candidates.push({
          kind: "same-list-item",
          range: this.guardRangeAfterBoundaries(
            { ...range, endLine: line - 1 },
            true,
          ),
          includeCodeContent: false,
        });
      }
    }

    const previous = record.parent.children[record.index - 1];
    if (previous?.type === "paragraph") {
      candidates.push({
        kind: "preceding-paragraph",
        range: sourceRange(previous, this.bodyStartLine),
        includeCodeContent: false,
      });
    }

    const safetyHeading = [...this.headingChainAt(line)]
      .reverse()
      .find((heading) => SAFETY_HEADING_RE.test(heading.text));
    if (safetyHeading !== undefined) {
      candidates.push({
        kind: "safety-section",
        range: this.guardRangeAfterBoundaries(
          {
            startLine: safetyHeading.endLine + 1,
            endLine: line - 1,
          },
          false,
        ),
        includeCodeContent: false,
      });
    }

    return candidates.flatMap(({ kind, range, includeCodeContent }) =>
      this.guardEvidenceForRange(kind, range, includeCodeContent),
    );
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
    const range = sourceRange(record.node, this.bodyStartLine);
    const nonOperationalExample = this.classifyNonOperationalExampleLines(
      record,
      range,
    );
    const lines = Array.from(
      { length: range.endLine - range.startLine + 1 },
      (_, index) =>
        this.nonOperationalExampleProjection(
          range.startLine - 1 + index,
        ).trim(),
    );
    const blockQuoted = record.ancestors.some(
      (ancestor) => ancestor.type === "blockquote",
    );
    const operationalBlockQuote =
      blockQuoted && this.isOperationalBlockQuote(record, range.startLine);
    if (operationalBlockQuote) {
      addLines(this.operationalBlockQuoteLines, range);
    }
    return {
      unit: { kind: "paragraph", ...range, lines },
      operational:
        (!blockQuoted || operationalBlockQuote) &&
        !lines.every((line) => /^\s*\/\//.test(line)) &&
        !nonOperationalExample,
    };
  }

  private codeBlockCandidate(
    record: NodeRecord & { node: Code },
  ): CodeBlockCandidate {
    const block = this.codeBlocksByNode.get(record.node);
    if (block === undefined) {
      throw new Error(
        "Markdown code node is missing its structural projection",
      );
    }
    const range = {
      startLine: block.startLine,
      endLine: block.endLine,
    };
    const nonOperationalExample = this.classifyNonOperationalExampleLines(
      record,
      range,
    );
    const fenced = block.kind === "fenced";
    const contentStartLine = block.contentStartLine;
    const contentEndLine = block.contentEndLine;
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
    const operationalBlockQuote =
      blockQuoted && this.isOperationalBlockQuote(record, range.startLine);
    if (operationalBlockQuote) {
      addLines(this.operationalBlockQuoteLines, range);
    }
    return {
      unit: { kind: "code", ...range, contentStartLine, lines },
      contentEndLine,
      operational:
        fenced &&
        semanticLanguage &&
        (!blockQuoted || operationalBlockQuote) &&
        !nonOperationalExample &&
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
    const range = sourceRange(record.node, this.bodyStartLine);
    const visible = this.visibleLines.slice(range.startLine - 1, range.endLine);
    const candidates: SemanticCandidate[] = [];
    let runStart = -1;
    let runLines: string[] = [];
    const flush = (): void => {
      if (runStart < 0 || runLines.length === 0) return;
      const startLine = range.startLine + runStart;
      const candidateRange = {
        startLine,
        endLine: startLine + runLines.length - 1,
      };
      const nonOperationalExample = this.classifyNonOperationalExampleLines(
        record,
        candidateRange,
      );
      const lines = runLines.map((_, index) =>
        this.nonOperationalExampleProjection(startLine - 1 + index).trim(),
      );
      if (runLines.join(" ").trim().length > 0) {
        const blockQuoted = record.ancestors.some(
          (ancestor) => ancestor.type === "blockquote",
        );
        const operationalBlockQuote =
          blockQuoted && this.isOperationalBlockQuote(record, startLine);
        if (operationalBlockQuote) {
          addLines(this.operationalBlockQuoteLines, {
            startLine,
            endLine: startLine + lines.length - 1,
          });
        }
        candidates.push({
          unit: {
            kind: "paragraph",
            ...candidateRange,
            lines,
          },
          operational:
            (!blockQuoted || operationalBlockQuote) &&
            !nonOperationalExample &&
            !lines.every((line) => /^\s*\/\//.test(line)),
          htmlDerived: true,
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
    const container = this.routedContainerRecord(record);
    const previous = container.parent.children[container.index - 1];
    const previousText = previous === undefined ? "" : nodeText(previous);
    return (
      OPERATIONAL_BLOCK_ROUTING_RE.test(previousText) ||
      OPERATIONAL_BLOCK_LABEL_RE.test(previousText) ||
      this.headingChainAt(line).some((heading) =>
        OPERATIONAL_BLOCK_HEADING_RE.test(heading.text),
      )
    );
  }

  private isOperationalBlockQuote(record: NodeRecord, line: number): boolean {
    if (this.isNonOperationalExample(record, line)) return false;
    const container = this.routedContainerRecord(record);
    const previous = container.parent.children[container.index - 1];
    const previousText = previous === undefined ? "" : nodeText(previous);
    const explicitlyRouted =
      OPERATIONAL_BLOCK_ROUTING_RE.test(previousText) ||
      OPERATIONAL_BLOCK_LABEL_RE.test(previousText);
    if (explicitlyRouted) return true;
    if (
      NON_OPERATIONAL_QUOTATION_CONTEXT_RE.test(previousText) ||
      NON_OPERATIONAL_ATTRIBUTION_CONTEXT_RE.test(previousText)
    ) {
      return false;
    }
    return this.headingChainAt(line).some((heading) =>
      OPERATIONAL_BLOCK_HEADING_RE.test(heading.text),
    );
  }

  private isNonOperationalExample(record: NodeRecord, line: number): boolean {
    const range = sourceRange(record.node, this.bodyStartLine);
    return this.classifyNonOperationalExampleLines(record, range, line);
  }

  private classifyNonOperationalExampleLines(
    record: NodeRecord,
    range: MarkdownSourceRange,
    line = range.startLine,
  ): boolean {
    const container = this.routedContainerRecord(record);
    const previous = container.parent.children[container.index - 1];
    const structuralBoundary =
      (record.node.type === "code" &&
        EXAMPLE_BOUNDARY_RE.test(nodeText(record.node))) ||
      (previous !== undefined && EXAMPLE_LABEL_RE.test(nodeText(previous))) ||
      this.headingChainAt(line).some((heading) =>
        EXAMPLE_BOUNDARY_RE.test(heading.text),
      );
    const lineIndexes = Array.from(
      { length: Math.max(0, range.endLine - range.startLine + 1) },
      (_, index) => range.startLine - 1 + index,
    );
    if (structuralBoundary) {
      for (const lineIndex of lineIndexes) {
        this.nonOperationalExampleLines.add(lineIndex);
      }
      return true;
    }

    const lineStarts: number[] = [];
    let text = "";
    for (const [index, lineIndex] of lineIndexes.entries()) {
      if (index > 0) text += "\n";
      lineStarts.push(text.length);
      text += this.visibleLine(lineIndex);
    }
    const clauses = boundedClauseRanges(text);
    let classifiedInlineExample = false;
    for (const marker of text.matchAll(
      new RegExp(EXAMPLE_BOUNDARY_RE.source, "giu"),
    )) {
      if (marker.index === undefined) continue;
      const markerStart = marker.index;
      const markerEnd = markerStart + marker[0].length;
      const clauseIndex = clauses.findIndex(
        (clause) => clause.start < markerEnd && clause.end > markerStart,
      );
      const clause = clauses[clauseIndex];
      if (clause === undefined) continue;
      classifiedInlineExample = true;
      this.addNonOperationalExampleRange(
        lineIndexes,
        lineStarts,
        clause.start,
        clauses[clauseIndex + 1]?.start ?? text.length,
      );
    }
    for (const lineIndex of lineIndexes) {
      if (
        this.nonOperationalExampleRangesByLine.has(lineIndex) &&
        !/[\p{L}\p{N}]/u.test(this.nonOperationalExampleProjection(lineIndex))
      ) {
        this.nonOperationalExampleLines.add(lineIndex);
      }
    }
    return (
      classifiedInlineExample &&
      !/[\p{L}\p{N}]/u.test(
        lineIndexes
          .map((lineIndex) => this.nonOperationalExampleProjection(lineIndex))
          .join("\n"),
      )
    );
  }

  private addNonOperationalExampleRange(
    lineIndexes: readonly number[],
    lineStarts: readonly number[],
    start: number,
    end: number,
  ): void {
    for (const [index, lineIndex] of lineIndexes.entries()) {
      const lineStart = lineStarts[index] ?? 0;
      const lineEnd = lineStart + this.visibleLine(lineIndex).length;
      const localStart = Math.max(start, lineStart) - lineStart;
      const localEnd = Math.min(end, lineEnd) - lineStart;
      if (localStart >= localEnd) continue;
      const ranges =
        this.nonOperationalExampleRangesByLine.get(lineIndex) ?? [];
      if (
        !ranges.some(
          (range) => range.start === localStart && range.end === localEnd,
        )
      ) {
        ranges.push({ start: localStart, end: localEnd });
      }
      this.nonOperationalExampleRangesByLine.set(lineIndex, ranges);
    }
  }

  private nonOperationalExampleProjection(lineIndex: number): string {
    const line = this.visibleLine(lineIndex);
    const ranges = this.nonOperationalExampleRangesByLine.get(lineIndex);
    if (ranges === undefined) {
      return this.nonOperationalExampleLines.has(lineIndex)
        ? " ".repeat(line.length)
        : line;
    }
    let projection = line;
    for (const range of [...ranges].sort(
      (left, right) => right.start - left.start || right.end - left.end,
    )) {
      projection =
        projection.slice(0, range.start) +
        " ".repeat(range.end - range.start) +
        projection.slice(range.end);
    }
    return projection;
  }

  private operationalCandidateSegments(
    candidate: SemanticCandidate,
  ): SemanticCandidate[] {
    if (!candidate.operational) return [];
    if (candidate.unit.kind !== "paragraph") return [candidate];
    const { unit } = candidate;
    if (
      !unit.lines.some((_, index) =>
        this.nonOperationalExampleLines.has(unit.startLine - 1 + index),
      )
    ) {
      return [candidate];
    }

    const segments: SemanticCandidate[] = [];
    let runStart = -1;
    const flush = (exclusiveEnd: number): void => {
      if (runStart < 0) return;
      segments.push({
        ...candidate,
        unit: {
          kind: "paragraph",
          startLine: unit.startLine + runStart,
          endLine: unit.startLine + exclusiveEnd - 1,
          lines: unit.lines.slice(runStart, exclusiveEnd),
        },
      });
      runStart = -1;
    };
    for (const [index] of unit.lines.entries()) {
      if (this.nonOperationalExampleLines.has(unit.startLine - 1 + index)) {
        flush(index);
      } else if (runStart < 0) {
        runStart = index;
      }
    }
    flush(unit.lines.length);
    return segments;
  }

  private routedContainerRecord(record: NodeRecord): NodeRecord {
    const blockQuote = [...record.ancestors]
      .reverse()
      .find((ancestor) => ancestor.type === "blockquote");
    if (blockQuote === undefined) return record;
    return (
      this.records.find((candidate) => candidate.node === blockQuote) ?? record
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
        startLine: Math.max(this.bodyStartLine, line - 6),
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
      const range = sourceRange(node, this.bodyStartLine);
      return range.startLine <= line && range.endLine >= line;
    });
  }

  private guardEvidenceForRange(
    kind: SecurityGuardEvidence["kind"],
    range: MarkdownSourceRange,
    includeCodeContent: boolean,
  ): SecurityGuardEvidence[] {
    const evidence: SecurityGuardEvidence[] = [];
    let startLine: number | undefined;
    let lines: string[] = [];
    const flush = (endLine: number): void => {
      while (lines.length > 0 && !(lines[0] ?? "").trim()) {
        lines.shift();
        if (startLine !== undefined) startLine += 1;
      }
      while (lines.length > 0 && !(lines[lines.length - 1] ?? "").trim()) {
        lines.pop();
        endLine -= 1;
      }
      if (startLine !== undefined && lines.length > 0) {
        evidence.push({
          kind,
          startLine,
          endLine,
          text: lines.join("\n"),
        });
      }
      startLine = undefined;
      lines = [];
    };

    for (let line = range.startLine; line <= range.endLine; line += 1) {
      const lineIndex = line - 1;
      const excluded =
        this.isBlockQuotedLine(lineIndex) ||
        (includeCodeContent
          ? !this.isCodeContentLine(lineIndex)
          : this.isCodeBlockLine(lineIndex));
      if (excluded) {
        flush(line - 1);
        continue;
      }
      startLine ??= line;
      lines.push(this.visibleLine(lineIndex));
    }
    flush(range.endLine);
    return evidence;
  }

  private guardRangeAfterBoundaries(
    range: MarkdownSourceRange,
    includeHeadings: boolean,
  ): MarkdownSourceRange {
    const boundaries = [
      ...this.thematicBreaks,
      ...(includeHeadings ? this.headings : []),
    ].filter(
      (boundary) =>
        boundary.startLine >= range.startLine &&
        boundary.startLine <= range.endLine,
    );
    const lastBoundary = boundaries.sort(
      (left, right) => left.startLine - right.startLine,
    )[boundaries.length - 1];
    return {
      startLine:
        lastBoundary === undefined ? range.startLine : lastBoundary.endLine + 1,
      endLine: range.endLine,
    };
  }
}

function isSecurityRecord(record: NodeRecord): record is SecurityNodeRecord {
  return /^(?:blockquote|code|heading|html|inlineCode|paragraph|thematicBreak)$/.test(
    record.node.type,
  );
}

function semanticInlineCodeRanges(
  unit: MarkdownSemanticUnit,
  visibleLines: VisibleLineProjection[],
  inlineCodeRanges: SourceColumnRange[],
  htmlDerived: boolean,
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
    const visibleLine = visibleLines[line - 1];
    if (visibleLine === undefined) return lineOffsets[lineIndex] ?? 0;
    const leadingWhitespace =
      visibleLine.text.length - visibleLine.text.trimStart().length;
    const sourceOffset = Math.max(
      0,
      Math.min(visibleLine.sourceToVisibleOffsets.length - 1, column - 1),
    );
    const visibleOffset = visibleLine.sourceToVisibleOffsets[sourceOffset] ?? 0;
    const columnOffset = Math.max(
      0,
      Math.min(semanticLine.length, visibleOffset - leadingWhitespace),
    );
    return (lineOffsets[lineIndex] ?? 0) + columnOffset;
  };
  const sourceRanges = inlineCodeRanges
    .filter(
      (range) =>
        range.startLine >= unit.startLine && range.endLine <= unit.endLine,
    )
    .map((range) => ({
      start: semanticOffset(range.startLine, range.startColumn),
      end: semanticOffset(range.endLine, range.endColumn),
    }));
  if (
    sourceRanges.length > 0 ||
    !htmlDerived ||
    !unit.lines.some((line) => line.includes("`"))
  ) {
    return sourceRanges;
  }

  // Raw flow HTML can expose visible Markdown prose that is not represented by
  // the primary tree. Keep this deliberately bounded secondary parse.
  return parseMarkdownSyntax(unit.lines.join("\n"), 1)
    .records.filter(({ node }) => node.type === "inlineCode")
    .map(({ node }) => {
      const position = requiredPosition(node);
      return {
        start:
          (lineOffsets[position.start.line - 1] ?? 0) +
          position.start.column -
          1,
        end:
          (lineOffsets[position.end.line - 1] ?? 0) + position.end.column - 1,
      };
    });
}

function htmlComments(
  node: Html,
  bodyStartLine: number,
): MarkdownHtmlComment[] {
  if (/^\s*<(?:script|pre|style|textarea)(?=[\s>])/i.test(node.value)) {
    return [];
  }
  const position = node.position;
  if (position === undefined) return [];
  const comments: MarkdownHtmlComment[] = [];
  let cursor = 0;
  while (cursor < node.value.length) {
    const start = node.value.indexOf("<!--", cursor);
    if (start < 0) break;
    const markerEnd = node.value.indexOf("-->", start + 4);
    const end = markerEnd < 0 ? node.value.length : markerEnd + 3;
    const startPoint = relativeSourcePoint(
      node.value,
      start,
      position.start.line + bodyStartLine - 1,
      position.start.column,
    );
    const endPoint = relativeSourcePoint(
      node.value,
      end,
      position.start.line + bodyStartLine - 1,
      position.start.column,
    );
    comments.push({
      startLine: startPoint.line,
      endLine: endPoint.line,
      startColumn: startPoint.column,
      endColumn: endPoint.column,
      content: node.value.slice(start + 4, markerEnd < 0 ? end : markerEnd),
    });
    cursor = end;
  }
  return comments;
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
