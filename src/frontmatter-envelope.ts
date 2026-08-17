import type { Artifact } from "./types/artifact.js";

export interface FrontmatterEnvelope {
  present: boolean;
  closingIndex: number | undefined;
}

/**
 * Locate an Agent Skills YAML envelope without parsing its contents.
 *
 * The opening delimiter retains the established BOM and surrounding-whitespace
 * handling. A closing delimiter must begin in column one, but may retain
 * trailing whitespace. Indented delimiter-looking text therefore remains YAML
 * content, including inside block scalars.
 */
export function agentSkillFrontmatterEnvelope(
  lines: readonly string[],
): FrontmatterEnvelope {
  const firstLine = lines[0]?.replace(/^\uFEFF/, "").trim();
  if (firstLine !== "---") {
    return { present: false, closingIndex: undefined };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && /^---\s*$/.test(line),
  );
  return {
    present: true,
    closingIndex: closingIndex < 0 ? undefined : closingIndex,
  };
}

/**
 * Locate the general Renma metadata envelope after consuming one absolute
 * leading Unicode BOM. The delimiter itself remains exact: visible whitespace
 * and any remaining characters are noncanonical.
 */
export function renmaFrontmatterEnvelope(
  lines: readonly string[],
): FrontmatterEnvelope {
  const firstLine = lines[0]?.replace(/^\uFEFF/u, "");
  if (firstLine !== "---") {
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
  lines: readonly string[],
): FrontmatterEnvelope {
  return artifact.kind === "skill"
    ? agentSkillFrontmatterEnvelope(lines)
    : renmaFrontmatterEnvelope(lines);
}

/** Return the Markdown body start while preserving unclosed-envelope behavior. */
export function markdownBodyStartLineForArtifact(
  artifact: Pick<Artifact, "kind">,
  lines: readonly string[],
): number {
  const envelope = frontmatterEnvelopeForArtifact(artifact, lines);
  return envelope.closingIndex === undefined ? 1 : envelope.closingIndex + 2;
}

/** Return a closed frontmatter range under the artifact-selected contract. */
export function frontmatterRangeForArtifact(
  artifact: Pick<Artifact, "kind">,
  lines: readonly string[],
): { startLine: number; endLine: number } | undefined {
  const envelope = frontmatterEnvelopeForArtifact(artifact, lines);
  return envelope.closingIndex === undefined
    ? undefined
    : { startLine: 1, endLine: envelope.closingIndex + 1 };
}
