import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import type { Artifact } from "./types/artifact.js";
import { projectFindingRepairGuidance } from "./finding-repair-guidance.js";
import type {
  Finding,
  RepairConstraint,
  VerificationStep,
} from "./types/diagnostics.js";
import {
  C0_CONTROL_RANGES,
  DELETE_AND_C1_CONTROL_RANGE,
  formatCodePoint,
  isCodePointInRange,
  isCodePointInRanges,
  TAG_BLOCK_RANGE,
  UNICODE_CODE_POINTS,
  VARIATION_SELECTOR_RANGES,
} from "./unicode-primitives.js";

type UnicodeCategory = "bidi-control" | "invisible-character";

interface SuspiciousCharacter {
  readonly codePoint: number;
  readonly name: string;
  readonly category: UnicodeCategory;
}

interface Occurrence {
  readonly character: SuspiciousCharacter;
  readonly scalarIndex: number;
}

interface CharacterDetail {
  readonly codePoint: string;
  readonly name: string;
  readonly count: number;
}

interface EvidenceToken {
  readonly scalarIndex: number;
  readonly text: string;
}

const MAX_SNIPPET_LENGTH = 240;
const ASCII_TOKEN_CHARACTER = /^[A-Za-z0-9_.\-/:@%+=]$/u;

const MIN_CONSECUTIVE_VARIATION_SELECTORS = 2;

// Unicode Emoji currently defines these three exact sequences as the RGI
// subdivision flags. Keep this bounded to reviewed data instead of accepting
// arbitrary tag payloads or implementing general emoji/CLDR validation.
const RGI_EMOJI_TAG_PAYLOADS = ["gbeng", "gbsct", "gbwls"] as const;

// Unicode hidden-text techniques evolve; this candidate list is intentionally
// not exhaustive. Security properties such as Default_Ignorable_Code_Point can
// guide future review, but membership alone is not evidence: legitimate
// language, mathematical, emoji, and formatting uses exist. Add only
// deterministic, high-signal composition or context rules that preserve
// legitimate multilingual Unicode content.
const BIDI_CONTROLS = new Map<number, string>([
  [UNICODE_CODE_POINTS.LEFT_TO_RIGHT_EMBEDDING, "LEFT-TO-RIGHT EMBEDDING"],
  [UNICODE_CODE_POINTS.RIGHT_TO_LEFT_EMBEDDING, "RIGHT-TO-LEFT EMBEDDING"],
  [
    UNICODE_CODE_POINTS.POP_DIRECTIONAL_FORMATTING,
    "POP DIRECTIONAL FORMATTING",
  ],
  [UNICODE_CODE_POINTS.LEFT_TO_RIGHT_OVERRIDE, "LEFT-TO-RIGHT OVERRIDE"],
  [UNICODE_CODE_POINTS.RIGHT_TO_LEFT_OVERRIDE, "RIGHT-TO-LEFT OVERRIDE"],
  [UNICODE_CODE_POINTS.LEFT_TO_RIGHT_ISOLATE, "LEFT-TO-RIGHT ISOLATE"],
  [UNICODE_CODE_POINTS.RIGHT_TO_LEFT_ISOLATE, "RIGHT-TO-LEFT ISOLATE"],
  [UNICODE_CODE_POINTS.FIRST_STRONG_ISOLATE, "FIRST STRONG ISOLATE"],
  [UNICODE_CODE_POINTS.POP_DIRECTIONAL_ISOLATE, "POP DIRECTIONAL ISOLATE"],
]);

const NAMED_INVISIBLE_CHARACTERS = new Map<number, string>([
  [UNICODE_CODE_POINTS.SOFT_HYPHEN, "SOFT HYPHEN"],
  [UNICODE_CODE_POINTS.COMBINING_GRAPHEME_JOINER, "COMBINING GRAPHEME JOINER"],
  [UNICODE_CODE_POINTS.ZERO_WIDTH_SPACE, "ZERO WIDTH SPACE"],
  [UNICODE_CODE_POINTS.ZERO_WIDTH_NON_JOINER, "ZERO WIDTH NON-JOINER"],
  [UNICODE_CODE_POINTS.ZERO_WIDTH_JOINER, "ZERO WIDTH JOINER"],
  [UNICODE_CODE_POINTS.WORD_JOINER, "WORD JOINER"],
  [
    UNICODE_CODE_POINTS.INHIBIT_SYMMETRIC_SWAPPING,
    "INHIBIT SYMMETRIC SWAPPING",
  ],
  [
    UNICODE_CODE_POINTS.ACTIVATE_SYMMETRIC_SWAPPING,
    "ACTIVATE SYMMETRIC SWAPPING",
  ],
  [
    UNICODE_CODE_POINTS.INHIBIT_ARABIC_FORM_SHAPING,
    "INHIBIT ARABIC FORM SHAPING",
  ],
  [
    UNICODE_CODE_POINTS.ACTIVATE_ARABIC_FORM_SHAPING,
    "ACTIVATE ARABIC FORM SHAPING",
  ],
  [UNICODE_CODE_POINTS.NATIONAL_DIGIT_SHAPES, "NATIONAL DIGIT SHAPES"],
  [UNICODE_CODE_POINTS.NOMINAL_DIGIT_SHAPES, "NOMINAL DIGIT SHAPES"],
  [UNICODE_CODE_POINTS.BYTE_ORDER_MARK, "ZERO WIDTH NO-BREAK SPACE"],
  [
    UNICODE_CODE_POINTS.INTERLINEAR_ANNOTATION_ANCHOR,
    "INTERLINEAR ANNOTATION ANCHOR",
  ],
  [
    UNICODE_CODE_POINTS.INTERLINEAR_ANNOTATION_SEPARATOR,
    "INTERLINEAR ANNOTATION SEPARATOR",
  ],
  [
    UNICODE_CODE_POINTS.INTERLINEAR_ANNOTATION_TERMINATOR,
    "INTERLINEAR ANNOTATION TERMINATOR",
  ],
]);

const C0_CONTROL_NAMES = [
  "NULL",
  "START OF HEADING",
  "START OF TEXT",
  "END OF TEXT",
  "END OF TRANSMISSION",
  "ENQUIRY",
  "ACKNOWLEDGE",
  "BELL",
  "BACKSPACE",
  "CHARACTER TABULATION",
  "LINE FEED",
  "LINE TABULATION",
  "FORM FEED",
  "CARRIAGE RETURN",
  "SHIFT OUT",
  "SHIFT IN",
  "DATA LINK ESCAPE",
  "DEVICE CONTROL ONE",
  "DEVICE CONTROL TWO",
  "DEVICE CONTROL THREE",
  "DEVICE CONTROL FOUR",
  "NEGATIVE ACKNOWLEDGE",
  "SYNCHRONOUS IDLE",
  "END OF TRANSMISSION BLOCK",
  "CANCEL",
  "END OF MEDIUM",
  "SUBSTITUTE",
  "ESCAPE",
  "FILE SEPARATOR",
  "GROUP SEPARATOR",
  "RECORD SEPARATOR",
  "UNIT SEPARATOR",
] as const;

const C1_CONTROL_NAMES = [
  "PADDING CHARACTER",
  "HIGH OCTET PRESET",
  "BREAK PERMITTED HERE",
  "NO BREAK HERE",
  "INDEX",
  "NEXT LINE",
  "START OF SELECTED AREA",
  "END OF SELECTED AREA",
  "CHARACTER TABULATION SET",
  "CHARACTER TABULATION WITH JUSTIFICATION",
  "LINE TABULATION SET",
  "PARTIAL LINE FORWARD",
  "PARTIAL LINE BACKWARD",
  "REVERSE LINE FEED",
  "SINGLE SHIFT TWO",
  "SINGLE SHIFT THREE",
  "DEVICE CONTROL STRING",
  "PRIVATE USE ONE",
  "PRIVATE USE TWO",
  "SET TRANSMIT STATE",
  "CANCEL CHARACTER",
  "MESSAGE WAITING",
  "START OF GUARDED AREA",
  "END OF GUARDED AREA",
  "START OF STRING",
  "SINGLE GRAPHIC CHARACTER INTRODUCER",
  "SINGLE CHARACTER INTRODUCER",
  "CONTROL SEQUENCE INTRODUCER",
  "STRING TERMINATOR",
  "OPERATING SYSTEM COMMAND",
  "PRIVACY MESSAGE",
  "APPLICATION PROGRAM COMMAND",
] as const;

const ASCII_PUNCTUATION_NAMES = new Map<number, string>([
  [0x21, "EXCLAMATION MARK"],
  [0x22, "QUOTATION MARK"],
  [0x23, "NUMBER SIGN"],
  [0x24, "DOLLAR SIGN"],
  [0x25, "PERCENT SIGN"],
  [0x26, "AMPERSAND"],
  [0x27, "APOSTROPHE"],
  [0x28, "LEFT PARENTHESIS"],
  [0x29, "RIGHT PARENTHESIS"],
  [0x2a, "ASTERISK"],
  [0x2b, "PLUS SIGN"],
  [0x2c, "COMMA"],
  [0x2d, "HYPHEN-MINUS"],
  [0x2e, "FULL STOP"],
  [0x2f, "SOLIDUS"],
  [0x3a, "COLON"],
  [0x3b, "SEMICOLON"],
  [0x3c, "LESS-THAN SIGN"],
  [0x3d, "EQUALS SIGN"],
  [0x3e, "GREATER-THAN SIGN"],
  [0x3f, "QUESTION MARK"],
  [0x40, "COMMERCIAL AT"],
  [0x5b, "LEFT SQUARE BRACKET"],
  [0x5c, "REVERSE SOLIDUS"],
  [0x5d, "RIGHT SQUARE BRACKET"],
  [0x5e, "CIRCUMFLEX ACCENT"],
  [0x5f, "LOW LINE"],
  [0x60, "GRAVE ACCENT"],
  [0x7b, "LEFT CURLY BRACKET"],
  [0x7c, "VERTICAL LINE"],
  [0x7d, "RIGHT CURLY BRACKET"],
  [0x7e, "TILDE"],
]);

const FINDING_METADATA = {
  "bidi-control": {
    id: DIAGNOSTIC_IDS.SEC_SUSPICIOUS_BIDI_CONTROL,
    severity: "high",
    title: "Suspicious bidirectional formatting control requires review",
    whyItMatters:
      "Bidirectional formatting controls can reorder displayed source text so a reviewer sees commands, identifiers, URLs, metadata, or instructions differently from an LLM or parser.",
  },
  "invisible-character": {
    id: DIAGNOSTIC_IDS.SEC_SUSPICIOUS_INVISIBLE_CHARACTER,
    severity: "medium",
    title: "Suspicious invisible Unicode character requires review",
    whyItMatters:
      "Invisible and deprecated formatting characters can hide source text inside commands, identifiers, URLs, metadata, instructions, scripts, or configuration.",
  },
} as const;

const REMEDIATION =
  "Inspect the exact reported code point, then remove only that character or replace it with the intended visible text. Do not normalize or rewrite the whole file, and preserve legitimate multilingual content. When bidirectional formatting is intentional, request human confirmation. If a reported character is verified as necessary, use an existing narrowly path-scoped suppression with a documented reason.";

const REPAIR_CONSTRAINTS: RepairConstraint[] = [
  {
    kind: "must_preserve",
    text: "Preserve legitimate multilingual text and visible source content.",
  },
  {
    kind: "must_not_change",
    text: "Do not normalize or rewrite the entire file.",
  },
  {
    kind: "requires_human_decision",
    text: "Require human confirmation before retaining intentional bidirectional formatting.",
  },
  {
    kind: "allowed_change",
    text: "Use only an existing narrowly path-scoped suppression with a reason for a verified intentional occurrence.",
  },
];

const VERIFICATION_STEPS: VerificationStep[] = [
  { text: "Inspect the exact reported code point in the original source." },
  {
    text: "Run renma scan and confirm the intended finding is removed or narrowly suppressed.",
    command: "renma scan",
  },
];

const LLM_HINT =
  "Review the exact escaped code point in the reported source line. Make the smallest character-level edit supported by the intended visible text, preserve legitimate multilingual content, and ask for human confirmation when bidirectional formatting or another reported format character is intentional. Do not automatically delete every Unicode formatting character in the repository.";

/**
 * Detect high-signal hidden Unicode directly in one already-discovered artifact.
 *
 * This intentionally operates on original UTF-8 text before Markdown parsing,
 * visibility filtering, normalization, or command analysis.
 */
export function hiddenUnicodeFindings(artifact: Artifact): Finding[] {
  if (!hiddenUnicodeAnalysisApplies(artifact)) return [];

  const findings: Finding[] = [];
  const lines = artifact.content.split(/\r\n|\n|\r/u);

  for (const [lineIndex, line] of lines.entries()) {
    const scalars = [...line];
    const occurrences = suspiciousOccurrences(scalars, lineIndex);
    if (occurrences.length === 0) continue;

    for (const category of ["bidi-control", "invisible-character"] as const) {
      const categoryOccurrences = occurrences.filter(
        (occurrence) => occurrence.character.category === category,
      );
      if (categoryOccurrences.length === 0) continue;
      findings.push(
        findingForLine(
          artifact,
          lineIndex + 1,
          scalars,
          occurrences,
          categoryOccurrences,
          category,
        ),
      );
    }
  }

  return findings.map((finding) => projectFindingRepairGuidance(finding));
}

/** Shared eligibility predicate for raw hidden-Unicode analysis and coverage. */
export function hiddenUnicodeAnalysisApplies(artifact: Artifact): boolean {
  return artifact.contentClassification === "text";
}

function suspiciousOccurrences(
  scalars: string[],
  lineIndex: number,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const suspiciousVariationSelectorIndexes =
    consecutiveVariationSelectorIndexes(scalars);
  const allowedEmojiTagIndexes = allowedEmojiTagSequenceIndexes(scalars);
  for (const [scalarIndex, scalar] of scalars.entries()) {
    const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined) continue;
    const character = suspiciousCharacter(
      codePoint,
      scalars,
      scalarIndex,
      lineIndex,
      suspiciousVariationSelectorIndexes,
      allowedEmojiTagIndexes,
    );
    if (character) occurrences.push({ character, scalarIndex });
  }
  return occurrences;
}

function suspiciousCharacter(
  codePoint: number,
  scalars: string[],
  scalarIndex: number,
  lineIndex: number,
  suspiciousVariationSelectorIndexes: ReadonlySet<number>,
  allowedEmojiTagIndexes: ReadonlySet<number>,
): SuspiciousCharacter | undefined {
  const bidiName = BIDI_CONTROLS.get(codePoint);
  if (bidiName) {
    return { codePoint, name: bidiName, category: "bidi-control" };
  }

  const variationSelectorName = suspiciousVariationSelectorIndexes.has(
    scalarIndex,
  )
    ? variationSelectorNameForCodePoint(codePoint)
    : undefined;
  if (variationSelectorName) {
    return {
      codePoint,
      name: variationSelectorName,
      category: "invisible-character",
    };
  }

  if (allowedEmojiTagIndexes.has(scalarIndex)) return undefined;

  if (
    codePoint === UNICODE_CODE_POINTS.ZERO_WIDTH_NON_JOINER ||
    codePoint === UNICODE_CODE_POINTS.ZERO_WIDTH_JOINER
  ) {
    if (!insideAsciiLikeToken(scalars, scalarIndex)) return undefined;
    return {
      codePoint,
      name: NAMED_INVISIBLE_CHARACTERS.get(codePoint) as string,
      category: "invisible-character",
    };
  }

  if (codePoint === UNICODE_CODE_POINTS.BYTE_ORDER_MARK) {
    if (lineIndex === 0 && scalarIndex === 0) return undefined;
    return {
      codePoint,
      name: NAMED_INVISIBLE_CHARACTERS.get(codePoint) as string,
      category: "invisible-character",
    };
  }

  const name = alwaysDetectedInvisibleName(codePoint);
  return name
    ? { codePoint, name, category: "invisible-character" }
    : undefined;
}

function variationSelectorNameForCodePoint(
  codePoint: number,
): string | undefined {
  const range = variationSelectorRange(codePoint);
  if (range === undefined) return undefined;
  if (range.name === "Mongolian Free Variation Selectors") {
    return mongolianVariationSelectorName(codePoint);
  }
  const firstSelectorNumber =
    range.name === "Variation Selectors Supplement" ? 17 : 1;
  return `VARIATION SELECTOR-${
    codePoint - range.startCodePoint + firstSelectorNumber
  }`;
}

function mongolianVariationSelectorName(codePoint: number): string {
  switch (codePoint) {
    case 0x180b:
      return "MONGOLIAN FREE VARIATION SELECTOR ONE";
    case 0x180c:
      return "MONGOLIAN FREE VARIATION SELECTOR TWO";
    case 0x180d:
      return "MONGOLIAN FREE VARIATION SELECTOR THREE";
    case 0x180f:
      return "MONGOLIAN FREE VARIATION SELECTOR FOUR";
    default:
      return "MONGOLIAN FREE VARIATION SELECTOR";
  }
}

function consecutiveVariationSelectorIndexes(
  scalars: string[],
): ReadonlySet<number> {
  const indexes = new Set<number>();
  let runStart: number | undefined;

  for (let scalarIndex = 0; scalarIndex <= scalars.length; scalarIndex += 1) {
    const codePoint = scalars[scalarIndex]?.codePointAt(0);
    if (isVariationSelector(codePoint)) {
      runStart ??= scalarIndex;
      continue;
    }
    if (
      runStart !== undefined &&
      scalarIndex - runStart >= MIN_CONSECUTIVE_VARIATION_SELECTORS
    ) {
      for (let index = runStart; index < scalarIndex; index += 1) {
        indexes.add(index);
      }
    }
    runStart = undefined;
  }

  return indexes;
}

function isVariationSelector(codePoint: number | undefined): boolean {
  return (
    codePoint !== undefined && variationSelectorRange(codePoint) !== undefined
  );
}

function variationSelectorRange(
  codePoint: number,
): (typeof VARIATION_SELECTOR_RANGES)[number] | undefined {
  return VARIATION_SELECTOR_RANGES.find((range) =>
    isCodePointInRange(codePoint, range),
  );
}

function allowedEmojiTagSequenceIndexes(
  scalars: string[],
): ReadonlySet<number> {
  const indexes = new Set<number>();

  for (const [baseIndex, scalar] of scalars.entries()) {
    if (scalar.codePointAt(0) !== UNICODE_CODE_POINTS.BLACK_FLAG) continue;

    for (const payload of RGI_EMOJI_TAG_PAYLOADS) {
      const terminatorIndex = baseIndex + payload.length + 1;
      if (
        !emojiTagPayloadMatches(scalars, baseIndex + 1, payload) ||
        scalars[terminatorIndex]?.codePointAt(0) !==
          UNICODE_CODE_POINTS.CANCEL_TAG ||
        embeddedInsideAsciiLikeToken(scalars, baseIndex, terminatorIndex)
      ) {
        continue;
      }
      for (let index = baseIndex + 1; index <= terminatorIndex; index += 1) {
        indexes.add(index);
      }
    }
  }

  return indexes;
}

function emojiTagPayloadMatches(
  scalars: string[],
  payloadStartIndex: number,
  payload: string,
): boolean {
  return [...payload].every(
    (character, offset) =>
      scalars[payloadStartIndex + offset]?.codePointAt(0) ===
      UNICODE_CODE_POINTS.TAG_BLOCK_START + character.charCodeAt(0),
  );
}

function embeddedInsideAsciiLikeToken(
  scalars: string[],
  sequenceStartIndex: number,
  sequenceEndIndex: number,
): boolean {
  const previous = scalars[sequenceStartIndex - 1];
  const next = scalars[sequenceEndIndex + 1];
  return (
    previous !== undefined &&
    next !== undefined &&
    ASCII_TOKEN_CHARACTER.test(previous) &&
    ASCII_TOKEN_CHARACTER.test(next)
  );
}

function alwaysDetectedInvisibleName(codePoint: number): string | undefined {
  if (isCodePointInRanges(codePoint, C0_CONTROL_RANGES)) {
    return C0_CONTROL_NAMES[codePoint];
  }
  if (isCodePointInRange(codePoint, DELETE_AND_C1_CONTROL_RANGE)) {
    if (codePoint === UNICODE_CODE_POINTS.DELETE) return "DELETE";
    return C1_CONTROL_NAMES[codePoint - UNICODE_CODE_POINTS.C1_CONTROL_START];
  }
  if (isTagCharacter(codePoint)) {
    return tagCharacterName(codePoint);
  }
  return NAMED_INVISIBLE_CHARACTERS.get(codePoint);
}

function tagCharacterName(codePoint: number): string {
  if (codePoint === UNICODE_CODE_POINTS.LANGUAGE_TAG) return "LANGUAGE TAG";
  if (codePoint === UNICODE_CODE_POINTS.CANCEL_TAG) return "CANCEL TAG";
  if (
    codePoint >= UNICODE_CODE_POINTS.TAG_PAYLOAD_START &&
    codePoint <= UNICODE_CODE_POINTS.TAG_PAYLOAD_END
  ) {
    return `TAG ${asciiCharacterName(
      codePoint - UNICODE_CODE_POINTS.TAG_BLOCK_START,
    )}`;
  }
  return "TAG CHARACTER";
}

function asciiCharacterName(codePoint: number): string {
  if (codePoint === 0x20) return "SPACE";
  if (codePoint >= 0x30 && codePoint <= 0x39) {
    return `DIGIT ${
      [
        "ZERO",
        "ONE",
        "TWO",
        "THREE",
        "FOUR",
        "FIVE",
        "SIX",
        "SEVEN",
        "EIGHT",
        "NINE",
      ][codePoint - 0x30]
    }`;
  }
  if (codePoint >= 0x41 && codePoint <= 0x5a) {
    return `LATIN CAPITAL LETTER ${String.fromCodePoint(codePoint)}`;
  }
  if (codePoint >= 0x61 && codePoint <= 0x7a) {
    return `LATIN SMALL LETTER ${String.fromCodePoint(codePoint).toUpperCase()}`;
  }
  return ASCII_PUNCTUATION_NAMES.get(codePoint) ?? "CHARACTER";
}

function insideAsciiLikeToken(scalars: string[], scalarIndex: number): boolean {
  const previous = scalars[scalarIndex - 1];
  const next = scalars[scalarIndex + 1];
  return (
    previous !== undefined &&
    next !== undefined &&
    ASCII_TOKEN_CHARACTER.test(previous) &&
    ASCII_TOKEN_CHARACTER.test(next)
  );
}

function findingForLine(
  artifact: Artifact,
  lineNumber: number,
  scalars: string[],
  allOccurrences: Occurrence[],
  categoryOccurrences: Occurrence[],
  category: UnicodeCategory,
): Finding {
  const metadata = FINDING_METADATA[category];
  return {
    id: metadata.id,
    title: metadata.title,
    category: "safety",
    severity: metadata.severity,
    confidence: "high",
    riskClass: "suspicious",
    evidence: {
      path: artifact.path,
      startLine: lineNumber,
      endLine: lineNumber,
      snippet: escapedEvidenceSnippet(
        scalars,
        allOccurrences,
        categoryOccurrences,
      ),
    },
    whyItMatters: metadata.whyItMatters,
    remediation: REMEDIATION,
    repairConstraints: REPAIR_CONSTRAINTS,
    verificationStepsV2: VERIFICATION_STEPS,
    llmHint: LLM_HINT,
    details: {
      unicodeCategory: category,
      totalCount: categoryOccurrences.length,
      characters: characterDetails(categoryOccurrences),
      ...variationSelectorDetails(categoryOccurrences),
    },
  };
}

function variationSelectorDetails(
  occurrences: Occurrence[],
): Record<string, unknown> {
  const variationOccurrences = occurrences.filter(({ character }) =>
    isVariationSelector(character.codePoint),
  );
  if (variationOccurrences.length === 0) return {};

  let sequenceCount = 0;
  let longestSequenceLength = 0;
  let currentSequenceLength = 0;
  let previousScalarIndex: number | undefined;
  for (const { scalarIndex } of variationOccurrences) {
    if (
      previousScalarIndex === undefined ||
      scalarIndex !== previousScalarIndex + 1
    ) {
      sequenceCount += 1;
      currentSequenceLength = 1;
    } else {
      currentSequenceLength += 1;
    }
    longestSequenceLength = Math.max(
      longestSequenceLength,
      currentSequenceLength,
    );
    previousScalarIndex = scalarIndex;
  }

  const reportedRanges = VARIATION_SELECTOR_RANGES.filter((range) =>
    variationOccurrences.some(({ character }) =>
      isCodePointInRange(character.codePoint, range),
    ),
  ).map(({ name, startCodePoint, endCodePoint }) => ({
    name,
    startCodePoint: formatCodePoint(startCodePoint),
    endCodePoint: formatCodePoint(endCodePoint),
  }));

  return {
    variationSelectorAnalysis: {
      heuristic: "consecutive-run",
      minimumConsecutiveCount: MIN_CONSECUTIVE_VARIATION_SELECTORS,
      suspiciousSequenceCount: sequenceCount,
      longestSequenceLength,
      reportedRanges,
    },
  };
}

function characterDetails(occurrences: Occurrence[]): CharacterDetail[] {
  const counts = new Map<number, { name: string; count: number }>();
  for (const { character } of occurrences) {
    const existing = counts.get(character.codePoint);
    counts.set(character.codePoint, {
      name: character.name,
      count: (existing?.count ?? 0) + 1,
    });
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([codePoint, { name, count }]) => ({
      codePoint: formatCodePoint(codePoint),
      name,
      count,
    }));
}

function escapedEvidenceSnippet(
  scalars: string[],
  allOccurrences: Occurrence[],
  categoryOccurrences: Occurrence[],
): string {
  const byIndex = new Map<number, Occurrence>(
    allOccurrences.map((occurrence) => [occurrence.scalarIndex, occurrence]),
  );
  for (const [scalarIndex, scalar] of scalars.entries()) {
    if (byIndex.has(scalarIndex)) continue;
    const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined || !isTagCharacter(codePoint)) continue;
    byIndex.set(scalarIndex, {
      scalarIndex,
      character: {
        codePoint,
        name: tagCharacterName(codePoint),
        category: "invisible-character",
      },
    });
  }
  const tokens = evidenceTokens(scalars, byIndex);
  const escapedLine = tokens.map(({ text }) => text).join("");
  if (escapedLine.length <= MAX_SNIPPET_LENGTH) return escapedLine;

  const summary = characterDetails(categoryOccurrences)
    .map(
      ({ codePoint, name, count }) =>
        `<${codePoint} ${name}>${count > 1 ? ` x${count}` : ""}`,
    )
    .join(" ");
  const firstCategoryOccurrence = categoryOccurrences[0];
  if (firstCategoryOccurrence === undefined) return escapedLine;
  const focusIndex = tokens.findIndex(
    ({ scalarIndex }) => scalarIndex === firstCategoryOccurrence.scalarIndex,
  );
  if (focusIndex < 0) return escapedLine;

  const focusToken = tokens[focusIndex] as EvidenceToken;
  const summaryPrefix =
    summary.length + " | ".length + focusToken.text.length + 2 <=
    MAX_SNIPPET_LENGTH
      ? `${summary} | `
      : "";
  return `${summaryPrefix}${boundedEvidenceWindow(
    tokens,
    focusIndex,
    MAX_SNIPPET_LENGTH - summaryPrefix.length,
  )}`;
}

function evidenceTokens(
  scalars: string[],
  occurrencesByIndex: ReadonlyMap<number, Occurrence>,
): EvidenceToken[] {
  const tokens: EvidenceToken[] = [];
  for (const [scalarIndex, scalar] of scalars.entries()) {
    const occurrence = occurrencesByIndex.get(scalarIndex);
    const text = occurrence ? escapedCharacter(occurrence.character) : scalar;
    if (/^[ \t]$/u.test(text)) {
      if (tokens.length > 0 && tokens.at(-1)?.text !== " ") {
        tokens.push({ scalarIndex, text: " " });
      }
      continue;
    }
    tokens.push({ scalarIndex, text });
  }
  if (tokens.at(-1)?.text === " ") tokens.pop();
  return tokens;
}

function boundedEvidenceWindow(
  tokens: EvidenceToken[],
  focusIndex: number,
  budget: number,
): string {
  const focus = tokens[focusIndex];
  if (focus === undefined || focus.text.length > budget) return "";

  let start = focusIndex;
  let end = focusIndex + 1;
  let contentLength = focus.text.length;
  let leftLength = 0;
  let rightLength = 0;

  while (true) {
    const leadingOmitted = start > 0;
    const trailingOmitted = end < tokens.length;
    const markerLength =
      (leadingOmitted ? "…".length : 0) + (trailingOmitted ? "…".length : 0);
    const contentBudget = budget - markerLength;
    const preferLeft = leftLength <= rightLength;
    const expanded = preferLeft
      ? expandEvidenceWindow("left", contentBudget)
      : expandEvidenceWindow("right", contentBudget);
    if (expanded) continue;
    const fallbackExpanded = preferLeft
      ? expandEvidenceWindow("right", contentBudget)
      : expandEvidenceWindow("left", contentBudget);
    if (!fallbackExpanded) break;
  }

  const leadingOmitted = start > 0;
  const trailingOmitted = end < tokens.length;
  return [
    leadingOmitted ? "…" : "",
    ...tokens.slice(start, end).map(({ text }) => text),
    trailingOmitted ? "…" : "",
  ].join("");

  function expandEvidenceWindow(
    direction: "left" | "right",
    contentBudget: number,
  ): boolean {
    const candidateIndex = direction === "left" ? start - 1 : end;
    const candidate = tokens[candidateIndex];
    if (
      candidate === undefined ||
      contentLength + candidate.text.length > contentBudget
    ) {
      return false;
    }
    contentLength += candidate.text.length;
    if (direction === "left") {
      start = candidateIndex;
      leftLength += candidate.text.length;
    } else {
      end = candidateIndex + 1;
      rightLength += candidate.text.length;
    }
    return true;
  }
}

function escapedCharacter(character: SuspiciousCharacter): string {
  return `<${formatCodePoint(character.codePoint)} ${character.name}>`;
}

function isTagCharacter(codePoint: number): boolean {
  return isCodePointInRange(codePoint, TAG_BLOCK_RANGE);
}
