import { createHash } from "node:crypto";
import { glob, lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  Artifact,
  ArtifactKind,
  Diagnostic,
  ScanConfig,
} from "./types.js";

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
  const paths = new Set<string>();
  diagnostics.push(...(await skillLikeLayoutDiagnostics(root, config)));

  for (const pattern of config.globs) {
    try {
      for await (const match of glob(pattern, {
        cwd: root,
        withFileTypes: false,
      })) {
        if (typeof match === "string") paths.add(toPosix(match));
      }
    } catch (error) {
      diagnostics.push({
        severity: "error",
        message: `Could not evaluate glob "${pattern}": ${errorMessage(error)}`,
      });
    }
  }

  const candidates = [...paths]
    .filter((relativePath) => !isExcluded(relativePath, config.exclude))
    .filter((relativePath) => depth(relativePath) <= config.maxDepth)
    .sort((a, b) => a.localeCompare(b));

  const artifacts = await mapLimit(
    candidates,
    config.concurrency,
    async (relativePath) => {
      const absolutePath = path.join(root, relativePath);
      try {
        const linkInfo = await lstat(absolutePath);
        if (linkInfo.isSymbolicLink()) {
          diagnostics.push({
            severity: "warning",
            path: relativePath,
            message: "Skipping symbolic link.",
          });
          return undefined;
        }
        const info = await stat(absolutePath);
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
          kind: classify(relativePath),
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
    discoveredPaths: new Set(candidates),
  };
}

function classify(relativePath: string): ArtifactKind {
  if (isExplicitSkillEntrypoint(relativePath)) return "skill";
  const explicitSkillSupportKind =
    classifyExplicitSkillSupportPath(relativePath);
  if (explicitSkillSupportKind !== undefined) return explicitSkillSupportKind;
  if (classifyRepositorySkillPath(relativePath)?.kind === "reserved-root")
    return "unknown";
  if (relativePath === "AGENTS.md" || relativePath.startsWith(".agents/"))
    return "agent";
  if (relativePath.startsWith("lenses/")) return "context_lens";
  if (
    relativePath.startsWith("context/") ||
    relativePath.startsWith("contexts/")
  )
    return "context";
  if (relativePath.includes("/profiles/")) return "profile";
  if (relativePath.includes("/references/")) return "reference";
  if (relativePath.includes("/examples/")) return "example";
  if (
    relativePath.endsWith("renma.config.json") ||
    relativePath.endsWith(".renma.json")
  ) {
    return "config";
  }
  return "unknown";
}

function classifyExplicitSkillSupportPath(
  relativePath: string,
): ArtifactKind | undefined {
  const classified = classifyRepositorySkillPath(relativePath);
  const supportDirectory =
    classified?.kind === "support" || classified?.kind === "reserved-root"
      ? classified.supportDirectory
      : undefined;
  switch (supportDirectory) {
    case "assets":
      return classified?.kind === "support" ? "asset" : undefined;
    case "profiles":
      return "profile";
    case "references":
      return "reference";
    case "examples":
      return "example";
    case "scripts":
      return classified?.kind === "support" ? "script" : undefined;
    default:
      return undefined;
  }
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

async function skillLikeLayoutDiagnostics(
  root: string,
  config: ScanConfig,
): Promise<Diagnostic[]> {
  const paths = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const pattern of SKILL_LIKE_FILE_GLOBS) {
    try {
      for await (const match of glob(pattern, {
        cwd: root,
        exclude: globExcludes(config.exclude),
        withFileTypes: false,
      })) {
        if (typeof match === "string") paths.add(toPosix(match));
      }
    } catch (error) {
      diagnostics.push({
        severity: "error",
        message: `Could not evaluate glob "${pattern}": ${errorMessage(error)}`,
      });
    }
  }

  for (const relativePath of [...paths].sort((a, b) => a.localeCompare(b))) {
    if (isExcluded(relativePath, config.exclude)) continue;
    if (depth(relativePath) > config.maxDepth) continue;

    try {
      if (!(await stat(path.join(root, relativePath))).isFile()) continue;
    } catch {
      continue;
    }

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

function isExplicitSkillEntrypoint(relativePath: string): boolean {
  return classifyRepositorySkillEntrypointPath(relativePath) !== undefined;
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

function isExcluded(relativePath: string, excludes: string[]): boolean {
  const segments = relativePath.split("/");
  return excludes.some(
    (exclude) =>
      segments.includes(exclude) ||
      relativePath === exclude ||
      relativePath.startsWith(`${exclude}/`),
  );
}

function globExcludes(excludes: string[]): string[] {
  return excludes.flatMap((exclude) => [
    exclude,
    `${exclude}/**`,
    `**/${exclude}`,
    `**/${exclude}/**`,
  ]);
}

function depth(relativePath: string): number {
  return relativePath.split("/").filter(Boolean).length;
}

function toPosix(value: string): string {
  return value.replaceAll("\\", path.posix.sep);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
