import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Artifact,
  AssetClassificationEvidence,
  ArtifactKind,
  Diagnostic,
  ScanConfig,
} from "./types.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import {
  safeRepositoryPath,
  walkRepositoryFiles,
} from "./repository-boundary.js";

const SKILL_LIKE_FILE_OUTSIDE_SKILLS_DIR_CODE =
  "LAYOUT-SKILL-LIKE-FILE-OUTSIDE-SKILLS-DIR";
const SKILL_ENTRYPOINT_UNDER_RESERVED_SUPPORT_DIR_CODE =
  "LAYOUT-SKILL-ENTRYPOINT-UNDER-RESERVED-SUPPORT-DIR";
export const RESERVED_SKILL_SUPPORT_DIRS = [
  "assets",
  "examples",
  "profiles",
  "references",
  "scripts",
] as const;
export type ReservedSkillSupportDirectory =
  (typeof RESERVED_SKILL_SUPPORT_DIRS)[number];
const SKILL_LIKE_FILE_GLOBS = [
  "SKILL.md",
  "skill.md",
  "*.skill.md",
  "**/SKILL.md",
  "**/skill.md",
  "**/*.skill.md",
  ".agents/**/SKILL.md",
  ".agents/**/skill.md",
  ".agents/**/*.skill.md",
];
const SKILL_SUPPORT_EXISTENCE_GLOBS = [
  "skills/**/profiles/**/*",
  "skills/**/references/**/*",
  "skills/**/examples/**/*",
  "skills/**/scripts/**/*",
  "skills/**/assets/**/*",
  ".agents/skills/**/profiles/**/*",
  ".agents/skills/**/references/**/*",
  ".agents/skills/**/examples/**/*",
  ".agents/skills/**/scripts/**/*",
  ".agents/skills/**/assets/**/*",
];
const SKILL_LIKE_FILE_LLM_HINT =
  "No action is required unless this file is intended to be a Renma skill. If it is intended to be a skill, move it under skills/** or .agents/skills/**.";
const SKILL_ENTRYPOINT_UNDER_RESERVED_SUPPORT_DIR_LLM_HINT =
  "Do not move or rename this file only to reduce diagnostics. Rename the skill directory only if this file is intended to define a Renma skill. For example, use `skills/example-review/SKILL.md` instead of `skills/examples/SKILL.md`.";

export type SkillEntrypointPath =
  | {
      kind: "canonical";
      currentPath: string;
      targetPath: string;
      candidateName: string;
    }
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

export type RepositorySkillPath =
  | {
      kind: "entrypoint";
      currentPath: string;
      root: "skills" | ".agents/skills";
      skillDirectory: string;
      skillName: string;
      domainPath: string[];
      relativeToSkillDirectory: string;
      entrypoint: SkillEntrypointPath;
    }
  | {
      kind: "support";
      currentPath: string;
      root: "skills" | ".agents/skills";
      skillDirectory: string;
      skillName: string;
      domainPath: string[];
      relativeToSkillDirectory: string;
      supportDirectory: ReservedSkillSupportDirectory;
    }
  | {
      kind: "reserved-root";
      currentPath: string;
      root: "skills" | ".agents/skills";
      supportDirectory: ReservedSkillSupportDirectory;
    };

/** Classify canonical, historical, and reserved support paths at explicit Skill roots. */
export function classifyRepositorySkillPath(
  relativePath: string,
): RepositorySkillPath | undefined {
  const currentPath = normalizeRepositoryRelativePath(relativePath);
  if (!currentPath) return undefined;
  const segments = currentPath.split("/").filter(Boolean);
  const rootEndIndex = repositorySkillRootEndIndex(segments);
  if (rootEndIndex === undefined) return undefined;
  const root = repositorySkillRoot(segments);
  const localSegments = segments.slice(rootEndIndex);
  const supportIndex = localSegments.findIndex(isReservedSkillSupportDirectory);

  if (supportIndex >= 0) {
    const supportDirectory = localSegments[
      supportIndex
    ] as ReservedSkillSupportDirectory;
    if (supportIndex === 0) {
      return { kind: "reserved-root", currentPath, root, supportDirectory };
    }
    const skillSegments = localSegments.slice(0, supportIndex);
    const skillName = skillSegments.at(-1);
    if (!skillName) return undefined;
    const skillDirectory = [
      ...segments.slice(0, rootEndIndex),
      ...skillSegments,
    ].join("/");
    return {
      kind: "support",
      currentPath,
      root,
      skillDirectory,
      skillName,
      domainPath: skillSegments.slice(0, -1),
      relativeToSkillDirectory: localSegments.slice(supportIndex).join("/"),
      supportDirectory,
    };
  }

  const entrypoint = classifySkillEntrypointAtRoot(
    currentPath,
    segments,
    rootEndIndex,
  );
  if (!entrypoint) return undefined;
  const skillDirectory = path.posix.dirname(entrypoint.targetPath);
  const skillDirectorySegments = skillDirectory.split("/").filter(Boolean);
  const skillSegments = skillDirectorySegments.slice(rootEndIndex);
  const skillName = skillSegments.at(-1);
  if (!skillName) return undefined;
  return {
    kind: "entrypoint",
    currentPath,
    root,
    skillDirectory,
    skillName,
    domainPath: skillSegments.slice(0, -1),
    relativeToSkillDirectory: path.posix.relative(skillDirectory, currentPath),
    entrypoint,
  };
}

/** Resolve the logical directory shared by every supported Skill path form. */
export function logicalSkillDirectory(
  relativePath: string,
): string | undefined {
  const classified = classifyRepositorySkillPath(relativePath);
  return classified?.kind === "entrypoint" || classified?.kind === "support"
    ? classified.skillDirectory
    : undefined;
}

/** Classify a repository-relative Skill entrypoint only at an explicit root. */
export function classifyRepositorySkillEntrypointPath(
  relativePath: string,
): SkillEntrypointPath | undefined {
  const classified = classifyRepositorySkillPath(relativePath);
  return classified?.kind === "entrypoint" ? classified.entrypoint : undefined;
}

/** Classify an absolute Skill path only when it contains one unambiguous root. */
export function classifyAbsoluteSkillEntrypointPath(
  absolutePath: string,
): SkillEntrypointPath | undefined {
  const rawPath = toPosix(absolutePath);
  if (!isAbsoluteLike(rawPath)) return undefined;
  const rawRoots = absoluteSkillRoots(rawPath.split("/").filter(Boolean));
  if (rawRoots.length !== 1) return undefined;
  const currentPath = path.posix.normalize(rawPath);
  const segments = currentPath.split("/").filter(Boolean);
  const roots = absoluteSkillRoots(segments);
  if (roots.length !== 1) return undefined;
  return classifySkillEntrypointAtRoot(currentPath, segments, roots[0]!);
}

/** Normalize a repository-relative Skill path without allowing root escape. */
export function normalizeRepositoryRelativePath(
  filePath: string,
): string | undefined {
  const normalizedSeparators = toPosix(filePath);
  if (isAbsoluteLike(normalizedSeparators)) return undefined;
  const rawSegments = normalizedSeparators.split("/");
  while (rawSegments[0] === "." || rawSegments[0] === "") {
    rawSegments.shift();
  }

  const rootEndIndex = repositorySkillRootEndIndex(rawSegments);
  if (rootEndIndex === undefined) return undefined;
  const resolved = rawSegments.slice(0, rootEndIndex);
  for (const segment of rawSegments.slice(rootEndIndex)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length <= rootEndIndex) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  const normalized = resolved.join("/");
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  const normalizedRootEndIndex = repositorySkillRootEndIndex(resolved);
  return normalizedRootEndIndex === rootEndIndex ? normalized : undefined;
}

/** Normalize any repository-relative path without permitting root traversal. */
export function normalizeAssetRepositoryRelativePath(
  filePath: string,
): string | undefined {
  const normalizedSeparators = toPosix(filePath);
  if (isAbsoluteLike(normalizedSeparators)) return undefined;
  if (normalizedSeparators.split("/").includes("..")) return undefined;
  const resolved: string[] = [];
  for (const segment of normalizedSeparators.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.length > 0 ? resolved.join("/") : undefined;
}

/** Infer a repository root only from cwd containment or one explicit boundary. */
export function repositoryClassificationPath(
  filePath: string,
  cwd = process.cwd(),
): { root: string; relativePath: string } | undefined {
  const absolutePath = path.resolve(filePath);
  const absoluteCwd = path.resolve(cwd);
  const relativeToCwd = path.relative(absoluteCwd, absolutePath);
  if (
    relativeToCwd &&
    !relativeToCwd.startsWith("..") &&
    !path.isAbsolute(relativeToCwd)
  ) {
    const relativePath = normalizeAssetRepositoryRelativePath(relativeToCwd);
    return relativePath ? { root: absoluteCwd, relativePath } : undefined;
  }

  const posixAbsolute = toPosix(absolutePath);
  const segments = posixAbsolute.split("/").filter(Boolean);
  const boundaryIndexes: number[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === ".agents" && segments[index + 1] === "skills") {
      boundaryIndexes.push(index);
      index += 1;
      continue;
    }
    if (
      segments[index] === "skills" ||
      segments[index] === "contexts" ||
      segments[index] === "context" ||
      segments[index] === "lenses" ||
      segments[index] === "tools"
    ) {
      boundaryIndexes.push(index);
    }
  }
  if (boundaryIndexes.length !== 1) return undefined;
  const boundaryIndex = boundaryIndexes[0]!;
  const rootPrefix = posixAbsolute.startsWith("/") ? "/" : "";
  const root = path.resolve(
    `${rootPrefix}${segments.slice(0, boundaryIndex).join("/")}`,
  );
  const relativePath = normalizeAssetRepositoryRelativePath(
    segments.slice(boundaryIndex).join("/"),
  );
  return relativePath ? { root, relativePath } : undefined;
}

/**
 * Classify one normalized repository path using the documented precedence.
 * Metadata may refine a Context Asset to Context Lens without changing the
 * path rule that established its repository boundary.
 */
export function classifyAssetPath(
  relativePath: string,
  options: { metadataType?: string } = {},
): AssetClassificationEvidence {
  const currentPath = normalizeAssetRepositoryRelativePath(relativePath);
  if (!currentPath) {
    return classification(
      "unknown",
      "unknown",
      "unknown",
      "outside-recognized-asset-boundary",
      "The path is absolute, empty, or escapes the repository boundary; repository-relative classification is unavailable.",
    );
  }

  // 1. Explicit Skill entrypoint.
  const skillPath = classifyRepositorySkillPath(currentPath);
  if (skillPath?.kind === "entrypoint") {
    return {
      ...classification(
        "skill",
        "independent",
        "skill-entrypoint",
        "under-canonical-skill-root",
        `The file is a Skill entrypoint under the recognized ${skillPath.root}/** root.`,
      ),
      recognizedRoot: skillPath.root,
    };
  }

  // 2. Explicit Skill-local support inside a recognized Skill boundary.
  if (skillPath?.kind === "support") {
    return {
      ...classification(
        supportArtifactKind(skillPath.supportDirectory),
        "skill-local",
        "skill-local-support",
        "under-skill-support-directory",
        `The file is inside the ${skillPath.supportDirectory}/ directory of the containing Skill.`,
      ),
      recognizedRoot: skillPath.root,
      parentAssetPath: `${skillPath.skillDirectory}/SKILL.md`,
      supportDirectory: skillPath.supportDirectory,
    };
  }
  if (skillPath?.kind === "reserved-root") {
    const compatibleKind =
      skillPath.supportDirectory === "assets" ||
      skillPath.supportDirectory === "scripts"
        ? "unknown"
        : supportArtifactKind(skillPath.supportDirectory);
    return {
      ...classification(
        compatibleKind,
        "unknown",
        compatibleKind === "unknown"
          ? "unknown"
          : `generic-${skillPath.supportDirectory.replace(/s$/, "")}`,
        "outside-recognized-asset-boundary",
        `The ${skillPath.supportDirectory}/ directory is reserved for support inside a containing Skill, but this path has no Skill parent.`,
      ),
      recognizedRoot: skillPath.root,
      supportDirectory: skillPath.supportDirectory,
    };
  }

  // Paths below a Skill root that did not match the canonical support set are
  // repository files, not implicitly governed Skill-local resources.
  if (isUnderSkillRoot(currentPath)) {
    const segments = currentPath.split("/");
    const rootEnd = repositorySkillRootEndIndex(segments) ?? 0;
    const localSegments = segments.slice(rootEnd);
    if (localSegments.includes("tools")) {
      return {
        ...classification(
          "unknown",
          "repository-support",
          "unknown",
          "unsupported-skill-local-directory",
          "The tools/ directory is not a canonical Skill-local support directory; use scripts/ for Skill-local executable support.",
        ),
        recognizedRoot: repositorySkillRoot(segments),
        competingRules: [
          {
            rule: "skill-local-support",
            matched: false,
            reasonCode: "unsupported-skill-local-directory",
            reason:
              "Canonical Skill-local support is limited to references, profiles, examples, scripts, and assets.",
          },
        ],
      };
    }
  }

  // 3. Recognized top-level asset roots.
  const segments = currentPath.split("/");
  const root = segments[0] ?? "";
  if (root === "contexts" || root === "context") {
    const ignoredNestedSegments = RESERVED_SKILL_SUPPORT_DIRS.filter(
      (segment) => segments.slice(1).includes(segment),
    );
    const kind =
      options.metadataType === "context_lens" ? "context_lens" : "context";
    const result: AssetClassificationEvidence = {
      ...classification(
        kind,
        "independent",
        root === "contexts" ? "context-root" : "context-root-legacy",
        root === "contexts"
          ? "under-recognized-context-root"
          : "under-legacy-context-root",
        root === "contexts"
          ? "The file is under the recognized contexts/** root."
          : "The file is under the supported legacy context/** root.",
      ),
      recognizedRoot: root,
    };
    if (ignoredNestedSegments.length > 0) {
      result.ignoredNestedSegments = ignoredNestedSegments;
      result.competingRules = [
        {
          rule: "skill-local-support",
          matched: false,
          reasonCode: "outside-recognized-skill-boundary",
          reason:
            "The path is not inside skills/** or .agents/skills/**, so nested support-like names do not establish Skill-local governance.",
        },
      ];
      result.reason += ` The nested ${ignoredNestedSegments.join(", ")}/ segment${ignoredNestedSegments.length === 1 ? " does" : "s do"} not change its classification.`;
    }
    return result;
  }
  if (root === "lenses") {
    return {
      ...classification(
        "context_lens",
        "independent",
        "lens-root",
        "under-recognized-lens-root",
        "The file is under the recognized lenses/** root.",
      ),
      recognizedRoot: root,
    };
  }
  if (currentPath === "AGENTS.md" || root === ".agents") {
    return {
      ...classification(
        "agent",
        "independent",
        "agent-root",
        "under-recognized-agent-root",
        "The file is repository agent guidance under the recognized Agent boundary.",
      ),
      recognizedRoot: currentPath === "AGENTS.md" ? "AGENTS.md" : ".agents",
    };
  }

  // 4. Recognized repository support and configuration.
  if (root === "tools") {
    return {
      ...classification(
        "unknown",
        "repository-support",
        "repository-tool",
        "repository-tool-not-context",
        "The tools/** root is repository implementation and is not a Context Asset root.",
      ),
      recognizedRoot: root,
      competingRules: [
        {
          rule: "context-root",
          matched: false,
          reasonCode: "outside-recognized-context-root",
          reason: "The path is not under contexts/** or context/**.",
        },
      ],
    };
  }
  const basename = path.posix.basename(currentPath);
  if (basename === "renma.config.json" || basename === ".renma.json") {
    return classification(
      "config",
      "repository-support",
      "config-file",
      "recognized-config-file",
      "The filename matches a supported Renma configuration file.",
    );
  }

  // 5. Compatibility rules for nested generic support-like paths.
  for (const [segment, kind, rule] of [
    ["profiles", "profile", "generic-profile"],
    ["references", "reference", "generic-reference"],
    ["examples", "example", "generic-example"],
  ] as const) {
    if (segments.slice(1, -1).includes(segment)) {
      return classification(
        kind,
        "unknown",
        rule,
        "under-generic-support-directory",
        `The file is under a nested ${segment}/ directory outside a recognized independent or Skill-local asset boundary.`,
      );
    }
  }

  // 6. Unknown.
  return classification(
    "unknown",
    "unknown",
    "unknown",
    "outside-recognized-asset-boundary",
    "The file is outside Renma's recognized asset and repository-support boundaries.",
  );
}

function classification(
  kind: ArtifactKind,
  scope: AssetClassificationEvidence["scope"],
  matchedRule: string,
  reasonCode: string,
  reason: string,
): AssetClassificationEvidence {
  return { kind, scope, matchedRule, reasonCode, reason };
}

function supportArtifactKind(
  directory: ReservedSkillSupportDirectory,
): ArtifactKind {
  switch (directory) {
    case "assets":
      return "asset";
    case "examples":
      return "example";
    case "profiles":
      return "profile";
    case "references":
      return "reference";
    case "scripts":
      return "script";
  }
}

function isUnderSkillRoot(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return repositorySkillRootEndIndex(segments) !== undefined;
}

function classifySkillEntrypointAtRoot(
  currentPath: string,
  segments: string[],
  rootEndIndex: number,
): SkillEntrypointPath | undefined {
  const basename = path.posix.basename(currentPath);
  const directory = path.posix.dirname(currentPath);
  const localDirectories = segments.slice(rootEndIndex, -1);
  if (localDirectories.some(isReservedSkillSupportDirectory)) {
    return undefined;
  }

  if (basename === "SKILL.md" || basename === "skill.md") {
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

  if (!basename.endsWith(".skill.md")) return undefined;
  const candidateName = basename.slice(0, -".skill.md".length);
  if (!candidateName) return undefined;
  return {
    kind: "flat-legacy-entrypoint",
    currentPath,
    targetPath: path.posix.join(directory, candidateName, "SKILL.md"),
    candidateName,
  };
}

/** Discover and read scan artifacts according to the provided scan configuration. */
export async function discoverArtifacts(
  root: string,
  config: ScanConfig,
): Promise<{
  artifacts: Artifact[];
  diagnostics: Diagnostic[];
  discoveredPaths: ReadonlySet<string>;
}> {
  const diagnostics: Diagnostic[] = [];
  const walked = await walkRepositoryFiles(root, {
    maxDepth: config.maxDepth,
    excluded: (relativePath) => isExcluded(relativePath, config.exclude),
  });
  diagnostics.push(...skillLikeLayoutDiagnostics(walked.files));
  diagnostics.push(
    ...walked.symlinks.map((symlinkPath) => ({
      code: DIAGNOSTIC_IDS.SUPPORT_SYMLINK_PATH,
      severity: "warning" as const,
      path: symlinkPath,
      message:
        "Skipping symbolic link; repository discovery never follows symlink targets.",
      details: { state: "symlink" },
    })),
  );
  diagnostics.push(
    ...walked.unreadable.map(({ path: unreadablePath, error }) => ({
      severity: "error" as const,
      path: unreadablePath,
      message: `Could not safely enumerate repository path: ${error}`,
    })),
  );
  const paths = new Set(
    walked.files.filter((relativePath) =>
      config.globs.some((pattern) => path.matchesGlob(relativePath, pattern)),
    ),
  );
  const discoveredPaths = new Set([
    ...paths,
    ...walked.files.filter((relativePath) =>
      SKILL_SUPPORT_EXISTENCE_GLOBS.some((pattern) =>
        path.matchesGlob(relativePath, pattern),
      ),
    ),
  ]);

  const candidates = [...paths]
    .filter((relativePath) => !isExcluded(relativePath, config.exclude))
    .filter(
      (relativePath) => repositoryPathDepth(relativePath) <= config.maxDepth,
    )
    .sort((a, b) => a.localeCompare(b));

  const artifacts = await mapLimit(
    candidates,
    config.concurrency,
    async (relativePath) => {
      const absolutePath = path.join(root, relativePath);
      try {
        const inspected = await safeRepositoryPath(root, relativePath);
        if (inspected.state === "symlink") {
          diagnostics.push({
            severity: "warning",
            path: relativePath,
            message: "Skipping path reached through a symbolic link.",
          });
          return undefined;
        }
        if (inspected.state !== "present") {
          diagnostics.push({
            severity: "error",
            path: relativePath,
            message: `Could not safely inspect file (${inspected.state}).`,
          });
          return undefined;
        }
        const info = inspected.stats;
        if (!info.isFile()) return undefined;
        if (info.size > config.maxFileSizeBytes) {
          diagnostics.push({
            severity: "warning",
            path: relativePath,
            message: `Skipping file larger than max_file_size_bytes (${config.maxFileSizeBytes}).`,
          });
          return undefined;
        }
        const bytes = await readFile(absolutePath);
        const contentClassification = classifyContent(bytes, relativePath);
        const content =
          contentClassification === "text" ? bytes.toString("utf8") : "";
        return {
          path: relativePath,
          absolutePath,
          kind: classifyAssetPath(relativePath).kind,
          sizeBytes: info.size,
          contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          contentClassification,
          markdownParserEligible:
            contentClassification === "text" &&
            /(?:^|\/)(?:[^/]+\.)?mdx?$/i.test(relativePath),
          content,
        } satisfies Artifact;
      } catch (error) {
        diagnostics.push({
          severity: "error",
          path: relativePath,
          message: `Could not read file: ${errorMessage(error)}`,
        });
        return undefined;
      }
    },
  );

  return {
    artifacts: artifacts.filter(
      (artifact) => artifact !== undefined,
    ) as Artifact[],
    diagnostics,
    // Preserve existence evidence before exclusion/depth/content parsing.
    discoveredPaths,
  };
}

const OPAQUE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".eot",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".otf",
  ".pdf",
  ".png",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

function classifyContent(
  bytes: Uint8Array,
  relativePath: string,
): "text" | "binary" {
  if (OPAQUE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase()))
    return "binary";
  if (bytes.includes(0)) return "binary";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text";
  } catch {
    return "binary";
  }
}

function skillLikeLayoutDiagnostics(walkedFiles: string[]): Diagnostic[] {
  const paths = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const relativePath of walkedFiles) {
    if (
      SKILL_LIKE_FILE_GLOBS.some((pattern) =>
        path.matchesGlob(relativePath, pattern),
      )
    ) {
      paths.add(relativePath);
    }
  }

  for (const relativePath of [...paths].sort((a, b) => a.localeCompare(b))) {
    const reservedSupportSegment = skillSupportPathSegment(relativePath);
    if (reservedSupportSegment !== undefined) {
      diagnostics.push({
        code: SKILL_ENTRYPOINT_UNDER_RESERVED_SUPPORT_DIR_CODE,
        severity: "info",
        path: relativePath,
        message: `Detected a skill entrypoint under a reserved support directory name: ${relativePath}. The path segment "${reservedSupportSegment}" is reserved for skill-local support files. Rename the skill directory if this file is intended to define a Renma skill.`,
        llmHint: SKILL_ENTRYPOINT_UNDER_RESERVED_SUPPORT_DIR_LLM_HINT,
        details: {
          guidanceOnly: true,
          repairRequired: false,
          reservedSupportSegment,
        },
      });
      continue;
    }

    if (isExplicitSkillsPath(relativePath)) continue;

    diagnostics.push({
      code: SKILL_LIKE_FILE_OUTSIDE_SKILLS_DIR_CODE,
      severity: "info",
      path: relativePath,
      message: `Detected a skill-like file outside an explicit skills directory: ${relativePath}. Renma only treats files under skills/** or .agents/skills/** as skill assets by default. Move this file under skills/ or .agents/skills/ if it is intended to be a Renma skill.`,
      llmHint: SKILL_LIKE_FILE_LLM_HINT,
      details: {
        guidanceOnly: true,
        repairRequired: false,
      },
    });
  }

  return diagnostics;
}

function isExplicitSkillsPath(relativePath: string): boolean {
  return normalizeRepositoryRelativePath(relativePath) !== undefined;
}

function skillSupportPathSegment(relativePath: string): string | undefined {
  const classified = classifyRepositorySkillPath(relativePath);
  return classified?.kind === "support" || classified?.kind === "reserved-root"
    ? classified.supportDirectory
    : undefined;
}

function isReservedSkillSupportDirectory(
  segment: string,
): segment is ReservedSkillSupportDirectory {
  return (RESERVED_SKILL_SUPPORT_DIRS as readonly string[]).includes(segment);
}

function repositorySkillRoot(segments: string[]): "skills" | ".agents/skills" {
  return segments[0] === "skills" ? "skills" : ".agents/skills";
}

function repositorySkillRootEndIndex(segments: string[]): number | undefined {
  if (segments[0] === "skills") return 1;
  if (segments[0] === ".agents" && segments[1] === "skills") return 2;
  return undefined;
}

function absoluteSkillRoots(segments: string[]): number[] {
  const roots: number[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] === ".agents" && segments[index + 1] === "skills") {
      roots.push(index + 2);
      index += 1;
    } else if (segments[index] === "skills") {
      roots.push(index + 1);
    }
  }
  return roots;
}

function isAbsoluteLike(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index] as T);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function isExcluded(relativePath: string, excludes: string[]): boolean {
  const segments = relativePath.split("/");
  return excludes.some(
    (exclude) =>
      segments.includes(exclude) ||
      relativePath === exclude ||
      relativePath.startsWith(`${exclude}/`),
  );
}

export function repositoryPathDepth(relativePath: string): number {
  return relativePath.split("/").filter(Boolean).length;
}

function toPosix(value: string): string {
  return value.replaceAll("\\", path.posix.sep);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
