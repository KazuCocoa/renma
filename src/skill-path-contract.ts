import path from "node:path";

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

interface SkillEntrypointPathFields {
  currentPath: string;
  targetPath: string;
  candidateName: string;
}

/** Exact operational Agent Skills entrypoint recognized by Renma discovery. */
export interface CanonicalSkillEntrypointPath extends SkillEntrypointPathFields {
  kind: "canonical";
}

/** Historical entrypoint states recognized only by explicit migration tooling. */
export type SkillMigrationEntrypointPath =
  | CanonicalSkillEntrypointPath
  | {
      kind: "lowercase-entrypoint";
      currentPath: string;
      targetPath: string;
      candidateName: string;
    }
  | {
      kind: "flat-legacy-entrypoint";
      currentPath: string;
      targetPath: string;
      candidateName: string;
    };

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

/** Canonical Skill entrypoint globs used by default operational scans. */
export const DEFAULT_SKILL_ENTRYPOINT_GLOBS = SKILL_ROOTS.flatMap((root) => [
  `${root}/**/SKILL.md`,
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

/** Internal migration-only recognition for an explicit repository-relative target. */
export function classifyRepositorySkillMigrationEntrypointPath(
  relativePath: string,
): SkillMigrationEntrypointPath | undefined {
  const currentPath = normalizeMigrationRelativePath(relativePath);
  if (!currentPath) return undefined;
  const segments = currentPath.split("/").filter(Boolean);
  const rootMatch = matchRepositorySkillRoot(segments);
  if (!rootMatch) return undefined;
  return classifySkillEntrypointAtRoot(
    currentPath,
    segments,
    rootMatch.endIndex,
    true,
  );
}

/** Internal migration-only recognition for an explicit absolute target. */
export function classifyAbsoluteSkillMigrationEntrypointPath(
  absolutePath: string,
): SkillMigrationEntrypointPath | undefined {
  const rawPath = absolutePath.replaceAll("\\", "/");
  if (!isAbsoluteLike(rawPath)) return undefined;
  const rawRoots = findAbsoluteSkillRoots(rawPath.split("/").filter(Boolean));
  if (rawRoots.length !== 1) return undefined;
  const currentPath = path.posix.normalize(rawPath);
  const segments = currentPath.split("/").filter(Boolean);
  const roots = findAbsoluteSkillRoots(segments);
  if (roots.length !== 1) return undefined;
  return classifySkillEntrypointAtRoot(
    currentPath,
    segments,
    roots[0]!.endIndex,
    true,
  );
}

/** Classify one exact canonical entrypoint after its supported root is known. */
export function classifyCanonicalSkillEntrypointAtRoot(
  currentPath: string,
  segments: string[],
  rootEndIndex: number,
): CanonicalSkillEntrypointPath | undefined {
  const classified = classifySkillEntrypointAtRoot(
    currentPath,
    segments,
    rootEndIndex,
    false,
  );
  return classified?.kind === "canonical" ? classified : undefined;
}

function classifySkillEntrypointAtRoot(
  currentPath: string,
  segments: string[],
  rootEndIndex: number,
  includeHistorical: boolean,
): SkillMigrationEntrypointPath | undefined {
  const basename = path.posix.basename(currentPath);
  const directory = path.posix.dirname(currentPath);
  const localDirectories = segments.slice(rootEndIndex, -1);
  if (
    localDirectories.some((segment) =>
      (RESERVED_SKILL_SUPPORT_DIRS as readonly string[]).includes(segment),
    )
  ) {
    return undefined;
  }

  if (
    basename === "SKILL.md" ||
    (includeHistorical && basename === "skill.md")
  ) {
    if (localDirectories.length === 0) return undefined;
    const candidateName = path.posix.basename(directory);
    if (!candidateName || candidateName === ".") return undefined;
    return {
      kind: basename === "SKILL.md" ? "canonical" : "lowercase-entrypoint",
      currentPath,
      targetPath:
        basename === "SKILL.md"
          ? currentPath
          : path.posix.join(directory, "SKILL.md"),
      candidateName,
    };
  }

  if (!includeHistorical || !basename.endsWith(".skill.md")) return undefined;
  const candidateName = basename.slice(0, -".skill.md".length);
  if (!candidateName) return undefined;
  return {
    kind: "flat-legacy-entrypoint",
    currentPath,
    targetPath: path.posix.join(directory, candidateName, "SKILL.md"),
    candidateName,
  };
}

function normalizeMigrationRelativePath(filePath: string): string | undefined {
  const normalizedSeparators = filePath.replaceAll("\\", "/");
  if (isAbsoluteLike(normalizedSeparators)) return undefined;
  const rawSegments = normalizedSeparators.split("/");
  while (rawSegments[0] === "" || rawSegments[0] === ".") {
    rawSegments.shift();
  }
  const rootMatch = matchRepositorySkillRoot(rawSegments);
  if (!rootMatch) return undefined;
  const resolved = rawSegments.slice(0, rootMatch.endIndex);
  for (const segment of rawSegments.slice(rootMatch.endIndex)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length <= rootMatch.endIndex) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const normalizedRoot = matchRepositorySkillRoot(resolved);
  if (
    normalizedRoot?.root !== rootMatch.root ||
    normalizedRoot.endIndex !== rootMatch.endIndex
  ) {
    return undefined;
  }
  return resolved.join("/");
}

function isAbsoluteLike(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);
}
