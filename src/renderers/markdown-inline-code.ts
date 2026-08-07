const MARKDOWN_LINE_BREAK_ESCAPES = new Map<string, string>([
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
    /[\r\n\v\f\u0085\u2028\u2029]/g,
    (character) => MARKDOWN_LINE_BREAK_ESCAPES.get(character) ?? character,
  );
}
