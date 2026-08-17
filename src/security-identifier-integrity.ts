import {
  SECURITY_METADATA_FIELD_DEFINITIONS,
  type SecurityMetadataFieldDefinition,
} from "./metadata-definitions.js";

export type SecurityIdentifierAuthority = "canonical" | "non-skill";

export interface CorruptedSecurityIdentifier {
  key: string;
  sanitizedKey: string;
  removedCodePoints: string[];
  definition: SecurityMetadataFieldDefinition;
  authority: SecurityIdentifierAuthority;
}

export interface ReviewedDefaultIgnorableProjection {
  sanitized: string;
  removedCodePoints: string[];
}

const REVIEWED_DEFAULT_IGNORABLE_RANGES: ReadonlyArray<
  readonly [start: number, end: number]
> = [
  [0x0000, 0x0008], // C0 controls excluding supported whitespace
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f], // DELETE and C1 controls
  [0x00ad, 0x00ad], // SOFT HYPHEN
  [0x034f, 0x034f], // COMBINING GRAPHEME JOINER
  [0x061c, 0x061c], // ARABIC LETTER MARK
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180b, 0x180f], // Mongolian free variation selectors and separator
  [0x200b, 0x200f], // zero-width characters, LRM, and RLM
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x206f], // word joiner and bidi/deprecated format controls
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // Variation Selectors
  [0xfeff, 0xfeff], // zero-width no-break space
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation controls
  [0xe0000, 0xe0001], // tag base and language tag
  [0xe0020, 0xe007f], // tag characters
  [0xe0100, 0xe01ef], // Variation Selectors Supplement
];

/**
 * Detect only invisible corruption that becomes an exact registered security
 * identifier after reviewed code points are removed. Values never gain
 * authority through this comparison.
 */
export function corruptedSecurityIdentifier(
  key: string,
  authority: SecurityIdentifierAuthority,
): CorruptedSecurityIdentifier | undefined {
  const definitions = SECURITY_METADATA_FIELD_DEFINITIONS.filter(
    (definition) =>
      (authority === "canonical"
        ? definition.skillKey
        : definition.nonSkillKey) !== key,
  );
  const projection = reviewedDefaultIgnorableProjection(key);
  const sanitizedKey = projection.sanitized;
  const removedCodePoints = projection.removedCodePoints;
  if (removedCodePoints.length === 0) return undefined;
  const definition = definitions.find(
    (candidate) =>
      (authority === "canonical"
        ? candidate.skillKey
        : candidate.nonSkillKey) === sanitizedKey,
  );
  if (definition === undefined) return undefined;
  return {
    key,
    sanitizedKey,
    removedCodePoints: [...new Set(removedCodePoints)],
    definition,
    authority,
  };
}

/**
 * Remove only the reviewed characters shared by bounded security-authority
 * integrity checks. Callers must still require an exact trusted identifier or
 * delimiter match before assigning security meaning to the projection.
 */
export function reviewedDefaultIgnorableProjection(
  value: string,
): ReviewedDefaultIgnorableProjection {
  const removedCodePoints: string[] = [];
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (isReviewedDefaultIgnorable(codePoint)) {
      removedCodePoints.push(formatCodePoint(codePoint));
    } else {
      sanitized += character;
    }
  }
  return {
    sanitized,
    removedCodePoints: [...new Set(removedCodePoints)],
  };
}

function isReviewedDefaultIgnorable(codePoint: number): boolean {
  return REVIEWED_DEFAULT_IGNORABLE_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end,
  );
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
