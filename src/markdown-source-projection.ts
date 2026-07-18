export type SourceColumnRange = {
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
};

export type VisibleLineProjection = {
  text: string;
  sourceToVisibleOffsets: number[];
};

type RemovedRange = { start: number; end: number };

export function projectVisibleLines(
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
