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
const RESERVED_SKILL_SUPPORT_DIRS = [
  "examples",
  "profiles",
  "references",
  "scripts",
];
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

/** Discover and read scan artifacts according to the provided scan configuration. */
export async function discoverArtifacts(
  root: string,
  config: ScanConfig,
): Promise<{ artifacts: Artifact[]; diagnostics: Diagnostic[] }> {
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
        const content = await readFile(absolutePath, "utf8");
        return {
          path: relativePath,
          absolutePath,
          kind: classify(relativePath),
          sizeBytes: info.size,
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
      (artifact): artifact is Artifact => artifact !== undefined,
    ),
    diagnostics,
  };
}

function classify(relativePath: string): ArtifactKind {
  if (isExplicitSkillEntrypoint(relativePath)) return "skill";
  const explicitSkillSupportKind =
    classifyExplicitSkillSupportPath(relativePath);
  if (explicitSkillSupportKind !== undefined) return explicitSkillSupportKind;
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
  switch (skillSupportPathSegment(relativePath)) {
    case "profiles":
      return "profile";
    case "references":
      return "reference";
    case "examples":
      return "example";
    default:
      return undefined;
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
  const normalized = toPosix(relativePath);
  const basename = path.posix.basename(normalized);
  const lowerBasename = basename.toLowerCase();
  if (!isSkillLikeFilename(lowerBasename)) return false;
  if (!isExplicitSkillsPath(normalized)) return false;
  if (skillSupportPathSegment(normalized) !== undefined) return false;
  return true;
}

function isExplicitSkillsPath(relativePath: string): boolean {
  return (
    relativePath.startsWith("skills/") ||
    relativePath.startsWith(".agents/skills/")
  );
}

function isSkillLikeFilename(lowerBasename: string): boolean {
  return lowerBasename === "skill.md" || lowerBasename.endsWith(".skill.md");
}

function skillSupportPathSegment(relativePath: string): string | undefined {
  const normalized = toPosix(relativePath);
  if (!isExplicitSkillsPath(normalized)) return undefined;

  const segments = normalized.split("/");
  const rootSegmentCount = normalized.startsWith(".agents/skills/") ? 2 : 1;
  const skillLocalSegments = segments.slice(rootSegmentCount, -1);
  return skillLocalSegments.find((segment) =>
    RESERVED_SKILL_SUPPORT_DIRS.includes(segment),
  );
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
  return value.split(path.sep).join(path.posix.sep);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
