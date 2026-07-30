import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import type { Artifact } from "./types/artifact.js";
import type { Finding } from "./types/diagnostics.js";

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

const BIDI_CONTROLS = new Map<number, string>([
  [0x202a, "LEFT-TO-RIGHT EMBEDDING"],
  [0x202b, "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "POP DIRECTIONAL FORMATTING"],
  [0x202d, "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "RIGHT-TO-LEFT OVERRIDE"],
  [0x2066, "LEFT-TO-RIGHT ISOLATE"],
  [0x2067, "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "FIRST STRONG ISOLATE"],
  [0x2069, "POP DIRECTIONAL ISOLATE"],
]);

const NAMED_INVISIBLE_CHARACTERS = new Map<number, string>([
  [0x00ad, "SOFT HYPHEN"],
  [0x034f, "COMBINING GRAPHEME JOINER"],
  [0x180e, "MONGOLIAN VOWEL SEPARATOR"],
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x2060, "WORD JOINER"],
  [0x206a, "INHIBIT SYMMETRIC SWAPPING"],
  [0x206b, "ACTIVATE SYMMETRIC SWAPPING"],
  [0x206c, "INHIBIT ARABIC FORM SHAPING"],
  [0x206d, "ACTIVATE ARABIC FORM SHAPING"],
  [0x206e, "NATIONAL DIGIT SHAPES"],
  [0x206f, "NOMINAL DIGIT SHAPES"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE"],
  [0xfff9, "INTERLINEAR ANNOTATION ANCHOR"],
  [0xfffa, "INTERLINEAR ANNOTATION SEPARATOR"],
  [0xfffb, "INTERLINEAR ANNOTATION TERMINATOR"],
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

const CONSTRAINTS = [
  "Preserve legitimate multilingual text and visible source content.",
  "Do not normalize or rewrite the entire file.",
  "Require human confirmation before retaining intentional bidirectional formatting.",
  "Use only an existing narrowly path-scoped suppression with a reason for a verified intentional occurrence.",
];

const VERIFICATION_STEPS = [
  "Inspect the exact reported code point in the original source.",
  "Run renma scan and confirm the intended finding is removed or narrowly suppressed.",
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
  if (artifact.contentClassification !== "text") return [];

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

  return findings;
}

function suspiciousOccurrences(
  scalars: string[],
  lineIndex: number,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const [scalarIndex, scalar] of scalars.entries()) {
    const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined) continue;
    const character = suspiciousCharacter(
      codePoint,
      scalars,
      scalarIndex,
      lineIndex,
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
): SuspiciousCharacter | undefined {
  const bidiName = BIDI_CONTROLS.get(codePoint);
  if (bidiName) {
    return { codePoint, name: bidiName, category: "bidi-control" };
  }

  if (codePoint === 0x200c || codePoint === 0x200d) {
    if (!insideAsciiLikeToken(scalars, scalarIndex)) return undefined;
    return {
      codePoint,
      name: NAMED_INVISIBLE_CHARACTERS.get(codePoint) as string,
      category: "invisible-character",
    };
  }

  if (codePoint === 0xfeff) {
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

function alwaysDetectedInvisibleName(codePoint: number): string | undefined {
  if (
    (codePoint >= 0x0000 && codePoint <= 0x0008) ||
    (codePoint >= 0x000b && codePoint <= 0x000c) ||
    (codePoint >= 0x000e && codePoint <= 0x001f)
  ) {
    return C0_CONTROL_NAMES[codePoint];
  }
  if (codePoint >= 0x007f && codePoint <= 0x009f) {
    if (codePoint === 0x007f) return "DELETE";
    return C1_CONTROL_NAMES[codePoint - 0x0080];
  }
  if (codePoint >= 0xe0000 && codePoint <= 0xe007f) {
    return tagCharacterName(codePoint);
  }
  return NAMED_INVISIBLE_CHARACTERS.get(codePoint);
}

function tagCharacterName(codePoint: number): string {
  if (codePoint === 0xe0001) return "LANGUAGE TAG";
  if (codePoint === 0xe007f) return "CANCEL TAG";
  if (codePoint >= 0xe0020 && codePoint <= 0xe007e) {
    return `TAG ${asciiCharacterName(codePoint - 0xe0000)}`;
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
    constraints: CONSTRAINTS,
    verificationSteps: VERIFICATION_STEPS,
    llmHint: LLM_HINT,
    details: {
      unicodeCategory: category,
      totalCount: categoryOccurrences.length,
      characters: characterDetails(categoryOccurrences),
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
      codePoint: formattedCodePoint(codePoint),
      name,
      count,
    }));
}

function escapedEvidenceSnippet(
  scalars: string[],
  allOccurrences: Occurrence[],
  categoryOccurrences: Occurrence[],
): string {
  const byIndex = new Map(
    allOccurrences.map((occurrence) => [occurrence.scalarIndex, occurrence]),
  );
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
  return `<${formattedCodePoint(character.codePoint)} ${character.name}>`;
}

function formattedCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
