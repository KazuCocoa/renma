const VISIBLE_CONTROL_ESCAPES = new Map<string, string>([
  ["\0", "\\0"],
  ["\b", "\\b"],
  ["\t", "\\t"],
  ["\r", "\\r"],
  ["\n", "\\n"],
  ["\v", "\\v"],
  ["\f", "\\f"],
  ["\u0085", "\\u0085"],
  ["\u2028", "\\u2028"],
  ["\u2029", "\\u2029"],
]);

/** Render one deterministic CommonMark code span without allowing line breaks. */
export function formatMarkdownInlineCode(value: string): string {
  const visibleValue = visibleMarkdownInlineValue(value);
  const longestBacktickRun = Math.max(
    0,
    ...[...visibleValue.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const delimiter = "`".repeat(longestBacktickRun + 1);
  const allSpaces = /^ *$/.test(visibleValue);
  const needsPadding =
    !allSpaces &&
    (visibleValue.startsWith(" ") ||
      visibleValue.endsWith(" ") ||
      visibleValue.startsWith("`") ||
      visibleValue.endsWith("`"));
  const content = needsPadding ? ` ${visibleValue} ` : visibleValue;
  return `${delimiter}${content}${delimiter}`;
}

export function visibleMarkdownInlineValue(value: string): string {
  return value.replace(
    /[\p{Cc}\u2028\u2029]/gu,
    (character) =>
      VISIBLE_CONTROL_ESCAPES.get(character) ??
      `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
  );
}
