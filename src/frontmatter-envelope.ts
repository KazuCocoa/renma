import type { Artifact } from "./types/artifact.js";

export const YAML_FRONTMATTER_MARKER = "---";
export const LEADING_ENCODING_BOM = "\uFEFF";

export type FrontmatterContract = "agent-skill" | "renma";

export interface FrontmatterEnvelope {
  present: boolean;
  closingIndex: number | undefined;
}

export interface LeadingEncodingBomResult {
  content: string;
  consumed: boolean;
}

const AGENT_SKILL_CLOSER_SUFFIX = /^\s*$/u;

/** Consume at most one absolute leading encoding BOM. */
export function consumeOneLeadingEncodingBom(
  line: string,
): LeadingEncodingBomResult {
  if (!line.startsWith(LEADING_ENCODING_BOM)) {
    return { content: line, consumed: false };
  }
  return {
    content: line.slice(LEADING_ENCODING_BOM.length),
    consumed: true,
  };
}

/** Normalize only syntax that the selected opener contract already accepts. */
export function normalizeFrontmatterOpener(
  line: string,
  contract: FrontmatterContract,
): string {
  const { content } = consumeOneLeadingEncodingBom(line);
  return contract === "agent-skill" ? content.trim() : content;
}

/** Test an opener without granting authority to a sanitized approximation. */
export function isFrontmatterOpener(
  line: string,
  contract: FrontmatterContract,
): boolean {
  return normalizeFrontmatterOpener(line, contract) === YAML_FRONTMATTER_MARKER;
}

/** Test a closer under the selected, intentionally distinct contract. */
export function isFrontmatterCloser(
  line: string,
  contract: FrontmatterContract,
): boolean {
  if (contract === "renma") return line === YAML_FRONTMATTER_MARKER;
  return (
    line.startsWith(YAML_FRONTMATTER_MARKER) &&
    AGENT_SKILL_CLOSER_SUFFIX.test(line.slice(YAML_FRONTMATTER_MARKER.length))
  );
}

/**
 * Return the opener text inspected for bounded corruption evidence.
 *
 * Renma's one accepted absolute encoding BOM is excluded before integrity
 * projection. Agent Skills retain their established whitespace/BOM contract.
 * The returned text is evidence only and must never be parsed for authority.
 */
export function frontmatterOpenerIntegrityInput(
  line: string,
  contract: FrontmatterContract,
): string {
  return contract === "renma"
    ? consumeOneLeadingEncodingBom(line).content
    : line;
}

/** Locate one envelope without parsing or repairing its contents. */
export function frontmatterEnvelope(
  lines: readonly string[],
  contract: FrontmatterContract,
): FrontmatterEnvelope {
  if (!isFrontmatterOpener(lines[0] ?? "", contract)) {
    return { present: false, closingIndex: undefined };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && isFrontmatterCloser(line, contract),
  );
  return {
    present: true,
    closingIndex: closingIndex < 0 ? undefined : closingIndex,
  };
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
  return frontmatterEnvelope(lines, "agent-skill");
}

/**
 * Locate the general Renma metadata envelope after consuming one absolute
 * leading Unicode BOM. The delimiter itself remains exact: visible whitespace
 * and any remaining characters are noncanonical.
 */
export function renmaFrontmatterEnvelope(
  lines: readonly string[],
): FrontmatterEnvelope {
  return frontmatterEnvelope(lines, "renma");
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
