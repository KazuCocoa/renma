import type {
  LogicalShellCommand,
  ShellProjection,
  SourceSpan,
} from "./types.js";

type Quote = "'" | '"' | undefined;
type OffsetSpan = { start: number; end: number };

export function activeShellContinuation(
  line: string,
  initialQuote: Quote,
): { active: boolean; quote: Quote } {
  let quote = initialQuote;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === "'") {
      if (character === quote) quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (character === quote) {
        quote = undefined;
        continue;
      }
      if (character === "\\") {
        if (index === line.length - 1) return { active: true, quote };
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\") {
      if (index === line.length - 1) return { active: true, quote };
      index += 1;
    }
  }
  return { active: false, quote };
}

export function projectShellContinuations(input: string): ShellProjection {
  const physicalLines = input.split("\n");
  const projection: string[] = [];
  const sourceOffsetByProjectionOffset: number[] = [];
  const sourceLineByProjectionOffset: number[] = [];
  let sourceOffset = 0;
  let quote: Quote;

  const append = (value: string, line: number, offset: number): void => {
    projection.push(value);
    for (let index = 0; index < value.length; index += 1) {
      sourceOffsetByProjectionOffset.push(offset + index);
      sourceLineByProjectionOffset.push(line);
    }
  };

  for (let index = 0; index < physicalLines.length; index += 1) {
    const physicalLine = physicalLines[index] ?? "";
    const continuation = activeShellContinuation(physicalLine, quote);
    const joinsNext = continuation.active && index + 1 < physicalLines.length;
    append(
      joinsNext ? physicalLine.slice(0, -1) : physicalLine,
      index + 1,
      sourceOffset,
    );
    sourceOffset += physicalLine.length;
    if (joinsNext) {
      sourceOffset += 1;
      quote = continuation.quote;
      continue;
    }
    quote = undefined;
    if (index + 1 < physicalLines.length) {
      append("\n", index + 1, sourceOffset);
      sourceOffset += 1;
    }
  }

  return {
    projection: projection.join(""),
    sourceOffsetByProjectionOffset,
    sourceLineByProjectionOffset,
  };
}

export function projectionSpanToSourceSpan(
  span: OffsetSpan,
  projection: ShellProjection,
  sourceLength: number,
): SourceSpan {
  const firstOffset =
    projection.sourceOffsetByProjectionOffset[span.start] ?? sourceLength;
  const lastProjectionOffset = Math.max(span.start, span.end - 1);
  const lastOffset =
    projection.sourceOffsetByProjectionOffset[lastProjectionOffset] ??
    firstOffset - 1;
  const startLine = projection.sourceLineByProjectionOffset[span.start];
  const endLine =
    projection.sourceLineByProjectionOffset[lastProjectionOffset] ?? startLine;
  return {
    startOffset: firstOffset,
    endOffset: Math.max(firstOffset, lastOffset + 1),
    ...(startLine === undefined ? {} : { startLine }),
    ...(endLine === undefined ? {} : { endLine }),
  };
}

export function unquotedShellSeparatorSpans(
  projection: string,
  bounds: OffsetSpan,
): OffsetSpan[] {
  const separators: OffsetSpan[] = [];
  let quote: Quote;

  for (let index = bounds.start; index < bounds.end; index += 1) {
    const character = projection[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    const previous = projection[index - 1];
    const next = projection[index + 1];
    const length =
      character === ";" || character === "|"
        ? character === "|" && next === "|"
          ? 2
          : 1
        : character === "&" && next === "&"
          ? 2
          : character === "&" && next !== ">" && previous !== ">"
            ? 1
            : 0;
    if (length === 0) continue;
    separators.push({ start: index, end: index + length });
    index += length - 1;
  }

  return separators;
}

export function unquotedCurlNextSpans(
  projection: string,
  bounds: OffsetSpan,
): OffsetSpan[] {
  const boundaries: OffsetSpan[] = [];
  let quote: Quote;

  for (let index = bounds.start; index < bounds.end; index += 1) {
    const character = projection[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (!projection.startsWith("--next", index)) continue;

    const before = projection[index - 1];
    const after = projection[index + "--next".length];
    const startsToken = index === bounds.start || /\s/u.test(before ?? "");
    const endsToken =
      index + "--next".length === bounds.end || /\s/u.test(after ?? "");
    if (!startsToken || !endsToken) continue;
    boundaries.push({ start: index, end: index + "--next".length });
    index += "--next".length - 1;
  }

  return boundaries;
}

type LogicalShellContext = {
  isLineEligible: (lineIndex: number) => boolean;
  sameBlock: (firstLineIndex: number, secondLineIndex: number) => boolean;
  isCodeContentLine: (lineIndex: number) => boolean;
};

export function logicalShellCommands(
  sourceLines: string[],
  visibleLines: string[],
  scanStart: number,
  context: LogicalShellContext,
): LogicalShellCommand[] {
  const commands: LogicalShellCommand[] = [];
  let index = scanStart;

  while (index < visibleLines.length) {
    const firstLine = visibleLines[index] ?? "";
    if (
      !isLogicalShellCommandStart(firstLine) ||
      !context.isLineEligible(index)
    ) {
      index += 1;
      continue;
    }

    const projection: string[] = [];
    const sourceLineByOffset: number[] = [];
    const memberLineIndexes = [index];
    let cursor = index;
    let quote: Quote;
    const append = (value: string, sourceLine: number): void => {
      projection.push(value);
      for (let offset = 0; offset < value.length; offset += 1) {
        sourceLineByOffset.push(sourceLine);
      }
    };

    while (cursor < visibleLines.length) {
      const physicalLine = visibleLines[cursor] ?? "";
      const continuation = activeShellContinuation(physicalLine, quote);
      const next = cursor + 1;
      const joinsNext =
        continuation.active &&
        next < visibleLines.length &&
        context.isLineEligible(next) &&
        context.sameBlock(cursor, next) &&
        context.isCodeContentLine(cursor) === context.isCodeContentLine(next);
      append(joinsNext ? physicalLine.slice(0, -1) : physicalLine, cursor + 1);
      if (!joinsNext) break;
      quote = continuation.quote;
      cursor = next;
      memberLineIndexes.push(cursor);
    }

    if (memberLineIndexes.length > 1) {
      commands.push({
        projection: projection.join(""),
        sourceLineByOffset,
        memberLineIndexes,
        sourceLines: memberLineIndexes.map(
          (lineIndex) => sourceLines[lineIndex] ?? "",
        ),
      });
    }
    index = cursor + 1;
  }

  return commands;
}

function isLogicalShellCommandStart(line: string): boolean {
  return /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:[$>%]\s*)?(?:(?:sudo|command|env)\s+|[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*curl\b/i.test(
    line,
  );
}

export function logicalShellCommandEvidence(command: LogicalShellCommand): {
  startLine: number;
  endLine: number;
  snippet: string;
} {
  const fallbackStart = (command.memberLineIndexes[0] ?? 0) + 1;
  const fallbackEnd =
    (command.memberLineIndexes[command.memberLineIndexes.length - 1] ??
      fallbackStart - 1) + 1;
  return {
    startLine: command.sourceLineByOffset[0] ?? fallbackStart,
    endLine:
      command.sourceLineByOffset[command.sourceLineByOffset.length - 1] ??
      fallbackEnd,
    snippet: command.sourceLines.join("\n"),
  };
}
