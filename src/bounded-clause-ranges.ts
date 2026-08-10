export interface BoundedClauseRange {
  readonly start: number;
  readonly end: number;
}

const BOUNDED_CLAUSE_BOUNDARY_RE =
  /(?:[;!?\n]+|\.(?=\s|$)|\b(?:but|however|yet|then)\b)/giu;

/** Return deterministic punctuation, newline, and conjunction-bounded clauses. */
export function boundedClauseRanges(text: string): BoundedClauseRange[] {
  const clauses: BoundedClauseRange[] = [];
  let start = 0;
  for (const boundary of text.matchAll(BOUNDED_CLAUSE_BOUNDARY_RE)) {
    if (boundary.index === undefined) continue;
    const end = boundary.index;
    if (end > start) clauses.push({ start, end });
    start = end + boundary[0].length;
  }
  if (start < text.length) clauses.push({ start, end: text.length });
  return clauses;
}
