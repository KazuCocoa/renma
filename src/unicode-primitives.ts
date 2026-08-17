/** A closed interval of Unicode code points. */
export interface CodePointRange {
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface NamedCodePointRange extends CodePointRange {
  readonly name: string;
}

export const UNICODE_CODE_POINTS = {
  DELETE: 0x007f,
  C1_CONTROL_START: 0x0080,
  C1_CONTROL_END: 0x009f,
  SOFT_HYPHEN: 0x00ad,
  COMBINING_GRAPHEME_JOINER: 0x034f,
  ARABIC_LETTER_MARK: 0x061c,
  MONGOLIAN_VOWEL_SEPARATOR: 0x180e,
  LEFT_TO_RIGHT_MARK: 0x200e,
  RIGHT_TO_LEFT_MARK: 0x200f,
  ZERO_WIDTH_SPACE: 0x200b,
  ZERO_WIDTH_NON_JOINER: 0x200c,
  ZERO_WIDTH_JOINER: 0x200d,
  LEFT_TO_RIGHT_EMBEDDING: 0x202a,
  RIGHT_TO_LEFT_EMBEDDING: 0x202b,
  POP_DIRECTIONAL_FORMATTING: 0x202c,
  LEFT_TO_RIGHT_OVERRIDE: 0x202d,
  RIGHT_TO_LEFT_OVERRIDE: 0x202e,
  WORD_JOINER: 0x2060,
  LEFT_TO_RIGHT_ISOLATE: 0x2066,
  RIGHT_TO_LEFT_ISOLATE: 0x2067,
  FIRST_STRONG_ISOLATE: 0x2068,
  POP_DIRECTIONAL_ISOLATE: 0x2069,
  INHIBIT_SYMMETRIC_SWAPPING: 0x206a,
  ACTIVATE_SYMMETRIC_SWAPPING: 0x206b,
  INHIBIT_ARABIC_FORM_SHAPING: 0x206c,
  ACTIVATE_ARABIC_FORM_SHAPING: 0x206d,
  NATIONAL_DIGIT_SHAPES: 0x206e,
  NOMINAL_DIGIT_SHAPES: 0x206f,
  BYTE_ORDER_MARK: 0xfeff,
  INTERLINEAR_ANNOTATION_ANCHOR: 0xfff9,
  INTERLINEAR_ANNOTATION_SEPARATOR: 0xfffa,
  INTERLINEAR_ANNOTATION_TERMINATOR: 0xfffb,
  BLACK_FLAG: 0x1f3f4,
  TAG_BLOCK_START: 0xe0000,
  LANGUAGE_TAG: 0xe0001,
  TAG_PAYLOAD_START: 0xe0020,
  TAG_PAYLOAD_END: 0xe007e,
  CANCEL_TAG: 0xe007f,
} as const;

export const C0_CONTROL_RANGES = [
  { startCodePoint: 0x0000, endCodePoint: 0x0008 },
  { startCodePoint: 0x000b, endCodePoint: 0x000c },
  { startCodePoint: 0x000e, endCodePoint: 0x001f },
] as const satisfies readonly CodePointRange[];

export const DELETE_AND_C1_CONTROL_RANGE = {
  startCodePoint: UNICODE_CODE_POINTS.DELETE,
  endCodePoint: UNICODE_CODE_POINTS.C1_CONTROL_END,
} as const satisfies CodePointRange;

export const VARIATION_SELECTOR_RANGES = [
  {
    name: "Mongolian Free Variation Selectors",
    startCodePoint: 0x180b,
    endCodePoint: 0x180d,
  },
  {
    name: "Mongolian Free Variation Selectors",
    startCodePoint: 0x180f,
    endCodePoint: 0x180f,
  },
  {
    name: "Variation Selectors",
    startCodePoint: 0xfe00,
    endCodePoint: 0xfe0f,
  },
  {
    name: "Variation Selectors Supplement",
    startCodePoint: 0xe0100,
    endCodePoint: 0xe01ef,
  },
] as const satisfies readonly NamedCodePointRange[];

export const UNICODE_RANGES = {
  softHyphen: {
    startCodePoint: UNICODE_CODE_POINTS.SOFT_HYPHEN,
    endCodePoint: UNICODE_CODE_POINTS.SOFT_HYPHEN,
  },
  combiningGraphemeJoiner: {
    startCodePoint: UNICODE_CODE_POINTS.COMBINING_GRAPHEME_JOINER,
    endCodePoint: UNICODE_CODE_POINTS.COMBINING_GRAPHEME_JOINER,
  },
  arabicLetterMark: {
    startCodePoint: UNICODE_CODE_POINTS.ARABIC_LETTER_MARK,
    endCodePoint: UNICODE_CODE_POINTS.ARABIC_LETTER_MARK,
  },
  hangulFillers: { startCodePoint: 0x115f, endCodePoint: 0x1160 },
  khmerInherentVowels: { startCodePoint: 0x17b4, endCodePoint: 0x17b5 },
  mongolianVariationSelectorsAndSeparator: {
    startCodePoint: 0x180b,
    endCodePoint: 0x180f,
  },
  zeroWidthCharactersAndDirectionalMarks: {
    startCodePoint: UNICODE_CODE_POINTS.ZERO_WIDTH_SPACE,
    endCodePoint: UNICODE_CODE_POINTS.RIGHT_TO_LEFT_MARK,
  },
  bidiEmbeddingsAndOverrides: {
    startCodePoint: UNICODE_CODE_POINTS.LEFT_TO_RIGHT_EMBEDDING,
    endCodePoint: UNICODE_CODE_POINTS.RIGHT_TO_LEFT_OVERRIDE,
  },
  wordJoinerAndBidiFormatControls: {
    startCodePoint: UNICODE_CODE_POINTS.WORD_JOINER,
    endCodePoint: UNICODE_CODE_POINTS.NOMINAL_DIGIT_SHAPES,
  },
  hangulFiller: { startCodePoint: 0x3164, endCodePoint: 0x3164 },
  variationSelectors: VARIATION_SELECTOR_RANGES[2],
  byteOrderMark: {
    startCodePoint: UNICODE_CODE_POINTS.BYTE_ORDER_MARK,
    endCodePoint: UNICODE_CODE_POINTS.BYTE_ORDER_MARK,
  },
  halfwidthHangulFiller: { startCodePoint: 0xffa0, endCodePoint: 0xffa0 },
  interlinearAnnotationControls: {
    startCodePoint: UNICODE_CODE_POINTS.INTERLINEAR_ANNOTATION_ANCHOR,
    endCodePoint: UNICODE_CODE_POINTS.INTERLINEAR_ANNOTATION_TERMINATOR,
  },
  tagBaseAndLanguageTag: {
    startCodePoint: UNICODE_CODE_POINTS.TAG_BLOCK_START,
    endCodePoint: UNICODE_CODE_POINTS.LANGUAGE_TAG,
  },
  tagPayloadAndCancel: {
    startCodePoint: UNICODE_CODE_POINTS.TAG_PAYLOAD_START,
    endCodePoint: UNICODE_CODE_POINTS.CANCEL_TAG,
  },
  variationSelectorsSupplement: VARIATION_SELECTOR_RANGES[3],
} as const satisfies Readonly<Record<string, CodePointRange>>;

export const TAG_BLOCK_RANGE = {
  startCodePoint: UNICODE_CODE_POINTS.TAG_BLOCK_START,
  endCodePoint: UNICODE_CODE_POINTS.CANCEL_TAG,
} as const satisfies CodePointRange;

export function isCodePointInRange(
  codePoint: number,
  range: CodePointRange,
): boolean {
  return codePoint >= range.startCodePoint && codePoint <= range.endCodePoint;
}

export function isCodePointInRanges(
  codePoint: number,
  ranges: readonly CodePointRange[],
): boolean {
  return ranges.some((range) => isCodePointInRange(codePoint, range));
}

export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
