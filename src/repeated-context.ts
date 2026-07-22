import { createHash } from "node:crypto";

import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import { DEFAULT_QUALITY_PROFILE } from "./quality-profile.js";
import { estimateTokens, estimatedTokenUnits } from "./token-estimator.js";
import type { Finding } from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";

type RepeatKind = "section_hash" | "heading" | "code_block" | "token_shingle";

type RepeatedContextFindingId =
  | typeof DIAGNOSTIC_IDS.MAINT_REPEATED_SECTION
  | typeof DIAGNOSTIC_IDS.MAINT_REPEATED_HEADING
  | typeof DIAGNOSTIC_IDS.MAINT_REPEATED_CODE_BLOCK
  | typeof DIAGNOSTIC_IDS.MAINT_REPEATED_LINK
  | typeof DIAGNOSTIC_IDS.MAINT_REPEATED_CONTEXT_PATTERN;

interface Occurrence {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

interface RepeatGroup {
  kind: RepeatKind;
  key: string;
  label: string;
  occurrences: Occurrence[];
}

const QUALITY = DEFAULT_QUALITY_PROFILE;
const FINDING_CAPS: Record<RepeatedContextFindingId, number> = {
  [DIAGNOSTIC_IDS.MAINT_REPEATED_SECTION]: QUALITY.repeatedContext.findingCap,
  [DIAGNOSTIC_IDS.MAINT_REPEATED_HEADING]: QUALITY.repeatedContext.findingCap,
  [DIAGNOSTIC_IDS.MAINT_REPEATED_CODE_BLOCK]:
    QUALITY.repeatedContext.findingCap,
  [DIAGNOSTIC_IDS.MAINT_REPEATED_LINK]: QUALITY.repeatedContext.findingCap,
  [DIAGNOSTIC_IDS.MAINT_REPEATED_CONTEXT_PATTERN]:
    QUALITY.repeatedContext.findingCap,
};
const SHINGLE_SIZE = QUALITY.repeatedContext.tokenShingleTokens;
const TOKEN_SHINGLE_NEARBY_LINE_WINDOW =
  QUALITY.repeatedContext.tokenShingleNearbyLineWindow;

export function repeatedContextFindingCap(
  id: RepeatedContextFindingId,
): number {
  return FINDING_CAPS[id];
}

const GENERIC_HEADINGS = new Set([
  "overview",
  "usage",
  "examples",
  "example",
  "setup",
  "installation",
  "configuration",
  "config",
  "troubleshooting",
  "notes",
  "references",
  "requirements",
  "prerequisites",
  "next steps",
  "background",
  "appendix",
]);

const COMMON_CONTEXT_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "you",
  "are",
  "must",
  "should",
  "when",
  "then",
  "than",
  "not",
  "use",
  "run",
]);

export function detectRepeatedContextPatterns(
  documents: ParsedDocument[],
): Finding[] {
  const markdownDocuments = documents.filter(
    (document) => document.artifact.markdownParserEligible === true,
  );
  const findings = [
    ...groupsToFindings(
      DIAGNOSTIC_IDS.MAINT_REPEATED_SECTION,
      "Repeated section",
      "section_hash",
      collectRepeatedSections(markdownDocuments),
      "Move the repeated section into an owned source-of-truth context or reference, then replace copies with explicit references where appropriate.",
    ),
    ...groupsToFindings(
      DIAGNOSTIC_IDS.MAINT_REPEATED_HEADING,
      "Repeated heading",
      "heading",
      collectRepeatedHeadings(markdownDocuments),
      "Review whether these similarly named sections are intentional navigation or a sign that knowledge should be consolidated under one owned context.",
    ),
    ...groupsToFindings(
      DIAGNOSTIC_IDS.MAINT_REPEATED_CODE_BLOCK,
      "Repeated code block",
      "code_block",
      collectRepeatedCodeBlocks(markdownDocuments),
      "Move the repeated command or code sample into one maintained reference, then link to it from dependent skills or docs.",
    ),
    ...groupsToFindings(
      DIAGNOSTIC_IDS.MAINT_REPEATED_CONTEXT_PATTERN,
      "Repeated context pattern",
      "token_shingle",
      collectRepeatedTokenShingles(markdownDocuments),
      "Use the repeated token sequence as evidence for a consolidation proposal, then have a human approve any reviewable patch.",
    ),
  ];

  return findings.sort(compareFindings);
}

function collectRepeatedSections(documents: ParsedDocument[]): RepeatGroup[] {
  const groups = new Map<string, RepeatGroup>();

  for (const document of documents) {
    for (let index = 0; index < document.headings.length; index += 1) {
      const heading = document.headings[index];
      if (!heading) continue;

      const endLine = findSectionEndLine(document, index);
      const lines = document.lines.slice(heading.line - 1, endLine);
      const normalized = normalizeWhitespace(lines.join("\n"));
      if (
        estimateTokens(normalized) <
          QUALITY.repeatedContext.exactSectionMinTokens ||
        normalized.length < QUALITY.repeatedContext.exactSectionMinChars
      )
        continue;

      const key = hashText(normalized);
      addOccurrence(groups, {
        kind: "section_hash",
        key,
        label: `section hash ${key.slice(0, 12)}`,
        occurrence: {
          path: document.artifact.path,
          startLine: heading.line,
          endLine,
          snippet: snippet(lines),
        },
      });
    }
  }

  return repeatedCrossFileGroups(
    groups,
    QUALITY.repeatedContext.exactSectionMinFiles,
  );
}

function collectRepeatedHeadings(documents: ParsedDocument[]): RepeatGroup[] {
  const groups = new Map<string, RepeatGroup>();

  for (const document of documents) {
    for (const heading of document.headings) {
      const normalized = normalizeHeading(heading.text);
      if (
        normalized.length < QUALITY.repeatedContext.headingMinChars ||
        estimateTokens(normalized) < QUALITY.repeatedContext.headingMinTokens ||
        GENERIC_HEADINGS.has(normalized)
      ) {
        continue;
      }

      addOccurrence(groups, {
        kind: "heading",
        key: normalized,
        label: heading.text,
        occurrence: {
          path: document.artifact.path,
          startLine: heading.line,
          endLine: heading.line,
          snippet: document.lines[heading.line - 1] ?? heading.text,
        },
      });
    }
  }

  return repeatedCrossFileGroups(
    groups,
    QUALITY.repeatedContext.headingMinFiles,
  );
}

function collectRepeatedCodeBlocks(documents: ParsedDocument[]): RepeatGroup[] {
  const groups = new Map<string, RepeatGroup>();

  for (const document of documents) {
    for (const fence of document.codeFences) {
      const normalized = normalizeWhitespace(fence.content);
      if (
        normalized.length < QUALITY.repeatedContext.exactCodeMinChars ||
        estimateTokens(normalized) < QUALITY.repeatedContext.exactCodeMinTokens
      )
        continue;

      const language = fence.language || "plain";
      const key = hashText(`${language}\n${normalized}`);
      addOccurrence(groups, {
        kind: "code_block",
        key,
        label: `${language} code block ${key.slice(0, 12)}`,
        occurrence: {
          path: document.artifact.path,
          startLine: fence.startLine,
          endLine: fence.endLine,
          snippet: snippet(
            document.lines.slice(fence.startLine - 1, fence.endLine),
          ),
        },
      });
    }
  }

  return repeatedCrossFileGroups(
    groups,
    QUALITY.repeatedContext.exactCodeMinFiles,
  );
}

function collectRepeatedTokenShingles(
  documents: ParsedDocument[],
): RepeatGroup[] {
  const groups = new Map<string, RepeatGroup>();

  for (const document of documents) {
    const tokens = tokenizeDocument(document);
    const seenInDocument = new Set<string>();

    for (let index = 0; index <= tokens.length - SHINGLE_SIZE; index += 1) {
      const shingle = tokens.slice(index, index + SHINGLE_SIZE);
      const words = shingle.map((token) => token.value);
      const key = words.join(" ");
      if (seenInDocument.has(key)) continue;
      if (!isUsefulShingle(words)) continue;

      seenInDocument.add(key);
      const startLine = shingle[0]?.line ?? 1;
      const endLine = shingle[shingle.length - 1]?.line ?? startLine;
      addOccurrence(groups, {
        kind: "token_shingle",
        key,
        label: `${SHINGLE_SIZE}-token pattern`,
        occurrence: {
          path: document.artifact.path,
          startLine,
          endLine,
          snippet: snippet(document.lines.slice(startLine - 1, endLine)),
        },
      });
    }
  }

  return collapseNearDuplicateTokenShingles(
    repeatedCrossFileGroups(
      groups,
      QUALITY.repeatedContext.tokenShingleMinFiles,
    ),
  );
}

function groupsToFindings(
  id: RepeatedContextFindingId,
  title: string,
  kind: RepeatKind,
  groups: RepeatGroup[],
  remediation: string,
): Finding[] {
  return groups
    .filter((group) => group.kind === kind)
    .sort(compareGroups)
    .slice(0, repeatedContextFindingCap(id))
    .flatMap((group) => {
      const occurrences = sortOccurrences(group.occurrences);
      const first = occurrences[0];
      if (!first) return [];
      const others = occurrences.slice(1, 5);
      const alsoAppears = formatOtherOccurrences(others);

      return [
        {
          id,
          title,
          category: "maintenance",
          severity: kind === "heading" ? "low" : "medium",
          confidence: confidenceForKind(kind),
          evidence: {
            path: first.path,
            startLine: first.startLine,
            endLine: first.endLine,
            snippet: first.snippet,
          },
          remediation,
          whyItMatters:
            "Repeated agent context can drift across skills, agents, references, and examples. Renma reports deterministic evidence so an LLM or maintainer can propose consolidation and a human can approve it.",
          llmHint: `${title} detected for ${group.label}. ${alsoAppears} Use these locations as evidence for a consolidation proposal, but do not treat them as an automatic source-of-truth decision.`,
          constraints: [
            "Do not delete or rewrite content solely because this finding exists.",
            "Preserve procedural details and ownership boundaries while consolidating.",
            "Treat this as deterministic evidence, not a semantic source-of-truth decision.",
          ],
          verificationSteps: [
            "Review all reported occurrences and choose an owned source of truth.",
            "Run renma scan after any consolidation patch.",
          ],
          details: {
            profile: QUALITY.profile,
            unit: "estimated_tokens",
            occurrenceCount: occurrences.length,
          },
        },
      ];
    });
}

function addOccurrence(
  groups: Map<string, RepeatGroup>,
  input: {
    kind: RepeatKind;
    key: string;
    label: string;
    occurrence: Occurrence;
  },
): void {
  const groupKey = `${input.kind}:${input.key}`;
  const existing = groups.get(groupKey);
  if (existing) {
    existing.occurrences.push(input.occurrence);
    return;
  }

  groups.set(groupKey, {
    kind: input.kind,
    key: input.key,
    label: input.label,
    occurrences: [input.occurrence],
  });
}

function repeatedCrossFileGroups(
  groups: Map<string, RepeatGroup>,
  minimumPaths: number,
): RepeatGroup[] {
  return [...groups.values()].filter(
    (group) => distinctPaths(group.occurrences).size >= minimumPaths,
  );
}

function collapseNearDuplicateTokenShingles(
  groups: RepeatGroup[],
): RepeatGroup[] {
  const selected: RepeatGroup[] = [];

  for (const group of [...groups].sort(compareTokenShingleRepresentatives)) {
    if (
      selected.some((representative) =>
        isNearDuplicateTokenShingleGroup(group, representative),
      )
    ) {
      continue;
    }

    selected.push(group);
  }

  return selected;
}

function isNearDuplicateTokenShingleGroup(
  candidate: RepeatGroup,
  representative: RepeatGroup,
): boolean {
  const candidatePrimary = sortOccurrences(candidate.occurrences)[0];
  const representativePrimary = sortOccurrences(representative.occurrences)[0];
  if (!candidatePrimary || !representativePrimary) return false;

  if (
    candidatePrimary.path === representativePrimary.path &&
    Math.abs(candidatePrimary.startLine - representativePrimary.startLine) <=
      TOKEN_SHINGLE_NEARBY_LINE_WINDOW
  ) {
    return true;
  }

  return (
    alsoAppearsSignature(candidate.occurrences) ===
    alsoAppearsSignature(representative.occurrences)
  );
}

function compareTokenShingleRepresentatives(
  left: RepeatGroup,
  right: RepeatGroup,
): number {
  const leftPrimary = sortOccurrences(left.occurrences)[0];
  const rightPrimary = sortOccurrences(right.occurrences)[0];

  return (
    (leftPrimary?.path ?? "").localeCompare(rightPrimary?.path ?? "") ||
    (leftPrimary?.startLine ?? 0) - (rightPrimary?.startLine ?? 0) ||
    (leftPrimary?.endLine ?? 0) - (rightPrimary?.endLine ?? 0) ||
    left.key.localeCompare(right.key)
  );
}

function alsoAppearsSignature(occurrences: Occurrence[]): string {
  const sorted = sortOccurrences(occurrences);
  const primary = sorted[0];

  return sorted
    .filter((occurrence) => occurrence !== primary)
    .map((occurrence) => `${occurrence.path}:L${occurrence.startLine}`)
    .sort()
    .join("|");
}

function findSectionEndLine(
  document: ParsedDocument,
  headingIndex: number,
): number {
  const heading = document.headings[headingIndex];
  if (!heading) return document.lines.length;

  const nextPeer = document.headings
    .slice(headingIndex + 1)
    .find((candidate) => candidate.depth <= heading.depth);
  return nextPeer ? nextPeer.line - 1 : document.lines.length;
}

function tokenizeDocument(
  document: ParsedDocument,
): Array<{ value: string; line: number }> {
  const codeLines = new Set<number>();
  for (const fence of document.codeFences) {
    for (let line = fence.startLine; line <= fence.endLine; line += 1) {
      codeLines.add(line);
    }
  }

  const tokens: Array<{ value: string; line: number }> = [];
  for (let index = 0; index < document.lines.length; index += 1) {
    const lineNumber = index + 1;
    if (codeLines.has(lineNumber)) continue;

    const line = document.lines[index] ?? "";
    for (const unit of estimatedTokenUnits(line)) {
      if (!unit.value) continue;
      tokens.push({ value: unit.value, line: lineNumber });
    }
  }

  return tokens;
}

function isUsefulShingle(words: string[]): boolean {
  const uniqueWords = new Set(words);
  if (uniqueWords.size < QUALITY.repeatedContext.tokenShingleMinUniqueTokens)
    return false;

  const usefulWords = words.filter((word) => !COMMON_CONTEXT_TOKENS.has(word));
  if (usefulWords.length < QUALITY.repeatedContext.tokenShingleMinUsefulTokens)
    return false;

  return words.join(" ").length >= QUALITY.repeatedContext.tokenShingleMinChars;
}

function normalizeHeading(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^#+\s*/, "")
    .replace(/\s+#+$/, "")
    .toLowerCase();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function snippet(lines: string[]): string {
  return lines.join("\n").trim().slice(0, 600);
}

function sortOccurrences(occurrences: Occurrence[]): Occurrence[] {
  return [...occurrences].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.startLine - right.startLine,
  );
}

function distinctPaths(occurrences: Occurrence[]): Set<string> {
  return new Set(occurrences.map((occurrence) => occurrence.path));
}

function compareGroups(left: RepeatGroup, right: RepeatGroup): number {
  return (
    distinctPaths(right.occurrences).size -
      distinctPaths(left.occurrences).size ||
    right.occurrences.length - left.occurrences.length ||
    left.label.localeCompare(right.label) ||
    left.key.localeCompare(right.key)
  );
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    left.id.localeCompare(right.id) ||
    left.evidence.path.localeCompare(right.evidence.path) ||
    left.evidence.startLine - right.evidence.startLine
  );
}

function confidenceForKind(kind: RepeatKind): Finding["confidence"] {
  switch (kind) {
    case "section_hash":
    case "code_block":
      return "high";
    case "token_shingle":
      return "medium";
    case "heading":
      return "low";
  }
}

function formatOtherOccurrences(occurrences: Occurrence[]): string {
  const locations = occurrences.map(
    (occurrence) => `${occurrence.path}:L${occurrence.startLine}`,
  );
  return `Also appears in ${locations.join("; ")}.`;
}
