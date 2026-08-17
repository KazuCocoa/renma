import {
  SECURITY_METADATA_FIELD_DEFINITIONS,
  type SecurityMetadataFieldDefinition,
} from "./metadata-definitions.js";
import {
  C0_CONTROL_RANGES,
  DELETE_AND_C1_CONTROL_RANGE,
  formatCodePoint,
  isCodePointInRanges,
  type CodePointRange,
  UNICODE_RANGES,
} from "./unicode-primitives.js";

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

const REVIEWED_DEFAULT_IGNORABLE_RANGES: readonly CodePointRange[] = [
  ...C0_CONTROL_RANGES,
  DELETE_AND_C1_CONTROL_RANGE,
  UNICODE_RANGES.softHyphen,
  UNICODE_RANGES.combiningGraphemeJoiner,
  UNICODE_RANGES.arabicLetterMark,
  UNICODE_RANGES.hangulFillers,
  UNICODE_RANGES.khmerInherentVowels,
  UNICODE_RANGES.mongolianVariationSelectorsAndSeparator,
  UNICODE_RANGES.zeroWidthCharactersAndDirectionalMarks,
  UNICODE_RANGES.bidiEmbeddingsAndOverrides,
  UNICODE_RANGES.wordJoinerAndBidiFormatControls,
  UNICODE_RANGES.hangulFiller,
  UNICODE_RANGES.variationSelectors,
  UNICODE_RANGES.byteOrderMark,
  UNICODE_RANGES.halfwidthHangulFiller,
  UNICODE_RANGES.interlinearAnnotationControls,
  UNICODE_RANGES.tagBaseAndLanguageTag,
  UNICODE_RANGES.tagPayloadAndCancel,
  UNICODE_RANGES.variationSelectorsSupplement,
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
  return isCodePointInRanges(codePoint, REVIEWED_DEFAULT_IGNORABLE_RANGES);
}
