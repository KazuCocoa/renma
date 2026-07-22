import type { Artifact } from "./types/artifact.js";
import { agentSkillFrontmatterEnvelope } from "./yaml-frontmatter.js";

export interface FrontmatterEnvelope {
  present: boolean;
  closingIndex: number | undefined;
}

/** Locate the exact delimiter contract used by general Renma metadata. */
export function renmaFrontmatterEnvelope(lines: string[]): FrontmatterEnvelope {
  if (lines[0] !== "---") {
    return { present: false, closingIndex: undefined };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line === "---",
  );
  return {
    present: true,
    closingIndex: closingIndex < 0 ? undefined : closingIndex,
  };
}

/** Select the frontmatter contract from the artifact's discovered role. */
export function frontmatterEnvelopeForArtifact(
  artifact: Pick<Artifact, "kind">,
  lines: string[],
): FrontmatterEnvelope {
  return artifact.kind === "skill"
    ? agentSkillFrontmatterEnvelope(lines)
    : renmaFrontmatterEnvelope(lines);
}

/** Return the Markdown body start while preserving unclosed-envelope behavior. */
export function markdownBodyStartLineForArtifact(
  artifact: Pick<Artifact, "kind">,
  lines: string[],
): number {
  const envelope = frontmatterEnvelopeForArtifact(artifact, lines);
  return envelope.closingIndex === undefined ? 1 : envelope.closingIndex + 2;
}

/** Return a closed frontmatter range under the artifact-selected contract. */
export function frontmatterRangeForArtifact(
  artifact: Pick<Artifact, "kind">,
  lines: string[],
): { startLine: number; endLine: number } | undefined {
  const envelope = frontmatterEnvelopeForArtifact(artifact, lines);
  return envelope.closingIndex === undefined
    ? undefined
    : { startLine: 1, endLine: envelope.closingIndex + 1 };
}
