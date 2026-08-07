/** Repository roots that may contain canonical Agent Skills entrypoints. */
export const SKILL_ROOTS = ["skills", ".agents/skills"] as const;
export type SkillRoot = (typeof SKILL_ROOTS)[number];

/** Directory names reserved for support within a logical Skill directory. */
export const RESERVED_SKILL_SUPPORT_DIRS = [
  "assets",
  "examples",
  "profiles",
  "references",
  "scripts",
] as const;
export type ReservedSkillSupportDirectory =
  (typeof RESERVED_SKILL_SUPPORT_DIRS)[number];

/** Default discovery breadth for each reserved Skill-support directory. */
export const SKILL_SUPPORT_DISCOVERY_MODE = {
  assets: "all-files",
  examples: "markdown",
  profiles: "markdown",
  references: "all-files",
  scripts: "all-files",
} as const satisfies Record<
  ReservedSkillSupportDirectory,
  "all-files" | "markdown"
>;

/** Canonical and historical Skill entrypoint globs used by default scans. */
export const DEFAULT_SKILL_ENTRYPOINT_GLOBS = SKILL_ROOTS.flatMap((root) => [
  `${root}/**/SKILL.md`,
  `${root}/**/skill.md`,
  `${root}/**/*.skill.md`,
]);

/** Symmetric default support-resource globs for both recognized Skill roots. */
export const DEFAULT_SKILL_SUPPORT_GLOBS = SKILL_ROOTS.flatMap((root) =>
  RESERVED_SKILL_SUPPORT_DIRS.map((directory) =>
    SKILL_SUPPORT_DISCOVERY_MODE[directory] === "markdown"
      ? `${root}/**/${directory}/**/*.md`
      : `${root}/**/${directory}/**/*`,
  ),
);

/** Broad existence evidence used independently from configured scan globs. */
export const SKILL_SUPPORT_EXISTENCE_GLOBS = SKILL_ROOTS.flatMap((root) =>
  RESERVED_SKILL_SUPPORT_DIRS.map(
    (directory) => `${root}/**/${directory}/**/*`,
  ),
);

export interface SkillRootMatch {
  root: SkillRoot;
  startIndex: number;
  endIndex: number;
}

const SKILL_ROOT_SEGMENTS = SKILL_ROOTS.map((root) => ({
  root,
  segments: root.split("/"),
})).sort((left, right) => right.segments.length - left.segments.length);

/** Match one recognized Skill root at the start of a repository-relative path. */
export function matchRepositorySkillRoot(
  segments: readonly string[],
): SkillRootMatch | undefined {
  return matchSkillRootAt(segments, 0);
}

/** Find non-overlapping recognized Skill roots within an absolute path. */
export function findAbsoluteSkillRoots(
  segments: readonly string[],
): SkillRootMatch[] {
  const matches: SkillRootMatch[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const match = matchSkillRootAt(segments, index);
    if (!match) continue;
    matches.push(match);
    index = match.endIndex - 1;
  }
  return matches;
}

function matchSkillRootAt(
  segments: readonly string[],
  startIndex: number,
): SkillRootMatch | undefined {
  for (const { root, segments: rootSegments } of SKILL_ROOT_SEGMENTS) {
    if (
      rootSegments.every(
        (segment, offset) => segments[startIndex + offset] === segment,
      )
    ) {
      return {
        root,
        startIndex,
        endIndex: startIndex + rootSegments.length,
      };
    }
  }
  return undefined;
}
