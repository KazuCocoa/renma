import type { InspectionCoverageChange } from "../inspection-coverage.js";
import { formatMarkdownInlineCode } from "./markdown-inline-code.js";

export function formatInspectionCoverageChange(
  change: InspectionCoverageChange,
): string {
  const subtree =
    change.scope === "subtree"
      ? ` (subtree; ${change.affectedBoundary ?? "agent-facing"} boundary)`
      : "";
  const prior =
    change.previouslyInspectedPaths.length > 0
      ? `; previously inspected ${change.previouslyInspectedPaths
          .map(formatMarkdownInlineCode)
          .join(", ")}`
      : "";
  return `${formatMarkdownInlineCode(change.path)}: ${change.fromState} -> ${change.toState}${subtree}${prior}`;
}
