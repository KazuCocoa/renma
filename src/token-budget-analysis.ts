import { estimateTokens } from "./token-estimator.js";
import type { ParsedDocument } from "./types/metadata.js";

export const TOKEN_BUDGET_SECTION_CANDIDATE_LIMIT = 3;

export interface TokenBudgetOverage {
  overBy: number;
  overPercent: number;
}

export interface TokenBudgetSectionCandidate {
  heading: string;
  line: number;
  estimatedTokens: number;
  sharePercent: number;
}

/** Derive stable non-negative overage facts for an exceeded advisory limit. */
export function tokenBudgetOverage(
  measured: number,
  limit: number,
): TokenBudgetOverage {
  const overBy = Math.max(0, measured - limit);
  return {
    overBy,
    overPercent:
      limit > 0 ? Math.max(0, Math.round((overBy / limit) * 100)) : 0,
  };
}

/**
 * Rank a small set of heading-backed review candidates without treating
 * nested headings as independent candidates inside an already measured parent.
 */
export function tokenBudgetSectionCandidates(
  document: ParsedDocument,
): TokenBudgetSectionCandidate[] {
  if (document.artifact.markdownParserEligible !== true) return [];

  const headings = [...document.headings]
    .filter((heading) => heading.text.trim().length > 0)
    .sort((left, right) => left.line - right.line || left.depth - right.depth);
  const candidateDepth = tokenBudgetCandidateDepth(headings);
  if (candidateDepth === undefined) return [];

  const sections = headings
    .filter((heading) => heading.depth === candidateDepth)
    .map((heading) => {
      const nextBoundary = headings.find(
        (candidate) =>
          candidate.line > heading.line && candidate.depth <= candidateDepth,
      );
      const sectionText = document.lines
        .slice(
          heading.line - 1,
          (nextBoundary?.line ?? document.lines.length + 1) - 1,
        )
        .join("\n");
      return {
        heading: heading.text.trim(),
        line: heading.line,
        estimatedTokens: estimateTokens(sectionText),
      };
    })
    .filter((section) => section.estimatedTokens > 0);
  const analyzedTokens = sections.reduce(
    (total, section) => total + section.estimatedTokens,
    0,
  );
  if (analyzedTokens === 0) return [];

  return sections
    .map((section) => ({
      ...section,
      sharePercent: Math.round(
        (section.estimatedTokens / analyzedTokens) * 100,
      ),
    }))
    .sort(
      (left, right) =>
        right.estimatedTokens - left.estimatedTokens || left.line - right.line,
    )
    .slice(0, TOKEN_BUDGET_SECTION_CANDIDATE_LIMIT);
}

/** Render deterministic section evidence for existing remediation fields. */
export function formatTokenBudgetSectionReview(
  candidates: TokenBudgetSectionCandidate[],
): string {
  if (candidates.length === 0) {
    return "No clear heading-based split candidates were detected. Review the content manually for semantic progressive-disclosure boundaries rather than splitting by token count.";
  }

  return `Largest heading-based sections to review: ${candidates
    .map(
      (candidate) =>
        `${candidate.heading} (~${candidate.estimatedTokens} estimated tokens; ~${candidate.sharePercent}% of analyzed sections)`,
    )
    .join("; ")}.`;
}

function tokenBudgetCandidateDepth(
  headings: ParsedDocument["headings"],
): number | undefined {
  if (headings.length === 0) return undefined;

  const h1Headings = headings.filter((heading) => heading.depth === 1);
  const hasSingleLeadingH1Title =
    h1Headings.length === 1 && headings[0] === h1Headings[0];
  if (
    hasSingleLeadingH1Title &&
    headings.some((heading) => heading.depth === 2)
  ) {
    return 2;
  }

  const nonTitleDepths = hasSingleLeadingH1Title
    ? headings
        .filter((heading) => heading !== h1Headings[0])
        .map((heading) => heading.depth)
    : headings.map((heading) => heading.depth);
  return nonTitleDepths.length > 0 ? Math.min(...nonTitleDepths) : undefined;
}
