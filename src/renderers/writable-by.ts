import { formatMarkdownInlineCode } from "./markdown-inline-code.js";

/** Render local declarations only; omission carries no authorization decision. */
export function formatWritableByEvidence(
  to: { writableBy?: string[] },
  from?: { writableBy?: string[] },
  maxItems = Infinity,
): string[] {
  if (to.writableBy === undefined && from?.writableBy === undefined) return [];
  const render = (values: string[] | undefined): string => {
    if (values === undefined) return "Not declared";
    const overflow =
      values.length > maxItems
        ? `; ${values.length - maxItems} more not shown; see JSON for the full list`
        : "";
    return (
      values.slice(0, maxItems).map(formatMarkdownInlineCode).join(", ") +
      overflow
    );
  };
  const value =
    from && JSON.stringify(from.writableBy) !== JSON.stringify(to.writableBy)
      ? `${render(from.writableBy)} -> ${render(to.writableBy)}`
      : render(to.writableBy);
  return [`  - Writable by (declared): ${value}`];
}
