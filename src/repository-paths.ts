import path from "node:path";
import {
  classifyRepositorySkillPath,
  isExcluded,
  logicalSkillDirectory,
  repositoryPathDepth,
} from "./discovery.js";
import type { Catalog } from "./model.js";
import { staticSupportReferences } from "./static-support.js";
import type { Artifact, ParsedDocument, ScanConfig } from "./types.js";
import { safeRepositoryPath } from "./repository-boundary.js";

export type RepositoryPathState =
  | "parsed"
  | "excluded"
  | "oversize"
  | "deep"
  | "unsupported"
  | "symlink"
  | "unreadable"
  | "absent";

export type HelperScriptPathResolution =
  | {
      kind: "candidate";
      path: string;
      source: "repository-root" | "skill-relative";
    }
  | { kind: "unsafe"; path: string }
  | { kind: "unscoped"; path: string };

/** Collect immutable repository-relative path existence evidence for rules. */
export async function collectRepositoryPaths(
  root: string,
  artifacts: Artifact[],
  documents: ParsedDocument[],
  catalog: Catalog,
  discoveredPaths: ReadonlySet<string> = new Set(),
): Promise<ReadonlySet<string>> {
  const paths = new Set<string>(
    [...discoveredPaths, ...artifacts.map((artifact) => artifact.path)]
      .map(normalizeRepositoryPath)
      .filter((candidate): candidate is string => candidate !== undefined),
  );

  for (const candidate of repositoryPathCandidates(documents, catalog)) {
    if (paths.has(candidate)) continue;
    if (await repositoryPathExists(root, candidate)) paths.add(candidate);
  }

  return paths;
}

export function helperScriptPath(command: string): string | undefined {
  const parts = command.split(/\s+/).slice(1);
  const target = parts.find((part) => !part.startsWith("-"));
  if (!target) return undefined;

  const hasSupportedExtension = /\.(?:mjs|js|cjs|sh|bash|py)$/.test(target);
  if (!hasSupportedExtension) return undefined;
  const startsAtSupportedRoot = /^(?:(?:\.\.?\/)+)?(?:scripts|tools)\//.test(
    target,
  );
  const isExplicitSkillScript = /(?:^|\/)scripts\//.test(target);
  return startsAtSupportedRoot || isExplicitSkillScript ? target : undefined;
}

/** Resolve a helper command path without escaping an unambiguous owning Skill. */
export function resolveHelperScriptPath(
  sourcePath: string,
  scriptPath: string,
): HelperScriptPathResolution {
  const rawPath = scriptPath.replace(/\\/g, "/");
  const skillDirectory = logicalSkillDirectory(sourcePath);
  const sourceSkill = skillDirectory ? { skillDirectory } : undefined;
  const isSkillRelative = /^(?:\.\/)?scripts\//.test(rawPath);
  const hasTraversal = rawPath.split("/").includes("..");

  if (isSkillRelative) {
    if (!sourceSkill) return { kind: "unscoped", path: rawPath };
    if (hasTraversal) return { kind: "unsafe", path: rawPath };
    const relativePath = rawPath.replace(/^\.\//, "");
    const candidate = normalizeRepositoryPath(
      path.posix.join(sourceSkill.skillDirectory, relativePath),
    );
    if (!candidate || !isWithinSkill(candidate, sourceSkill.skillDirectory)) {
      return { kind: "unsafe", path: rawPath };
    }
    return { kind: "candidate", path: candidate, source: "skill-relative" };
  }

  if (hasTraversal) {
    return sourceSkill
      ? { kind: "unsafe", path: rawPath }
      : { kind: "unscoped", path: rawPath };
  }

  const candidate = normalizeRepositoryPath(rawPath);
  if (!candidate) {
    return sourceSkill
      ? { kind: "unsafe", path: rawPath }
      : { kind: "unscoped", path: rawPath };
  }
  return { kind: "candidate", path: candidate, source: "repository-root" };
}

export function repositoryPathCandidates(
  documents: ParsedDocument[],
  catalog: Catalog,
): string[] {
  return [
    ...helperCommandPathCandidates(documents),
    ...staticSupportPathCandidates(documents),
    ...catalog.dependencies
      .map((dependency) => dependency.to)
      .map(normalizeRepositoryPath)
      .filter((candidate): candidate is string => candidate !== undefined)
      .filter(isRepoPathLike),
  ].filter(
    (candidate, index, candidates) => candidates.indexOf(candidate) === index,
  );
}

function staticSupportPathCandidates(documents: ParsedDocument[]): string[] {
  return documents.flatMap((document) => {
    const classified = classifyRepositorySkillPath(document.artifact.path);
    if (classified?.kind !== "entrypoint" && classified?.kind !== "support") {
      return [];
    }
    const localCandidates = documents
      .filter((candidate) => {
        const candidatePath = classifyRepositorySkillPath(
          candidate.artifact.path,
        );
        return (
          candidatePath?.kind === "support" &&
          candidatePath.skillDirectory === classified.skillDirectory
        );
      })
      .map((candidate) => candidate.artifact.path);
    return staticSupportReferences(
      document,
      classified.skillDirectory,
      localCandidates,
    ).map((reference) => reference.targetPath);
  });
}

/** Capture exact lstat-based states once without following symbolic links. */
export async function collectRepositoryPathStates(
  root: string,
  candidates: Iterable<string>,
  artifacts: Artifact[],
  config: ScanConfig,
): Promise<ReadonlyMap<string, RepositoryPathState>> {
  const parsed = new Set(artifacts.map((artifact) => artifact.path));
  const states = new Map<string, RepositoryPathState>();
  for (const candidate of [...new Set(candidates)].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const normalized = normalizeRepositoryPath(candidate);
    if (!normalized) continue;
    try {
      const inspected = await safeRepositoryPath(root, normalized);
      if (inspected.state === "symlink") {
        states.set(normalized, "symlink");
      } else if (inspected.state === "outside") {
        states.set(normalized, "absent");
      } else if (inspected.state === "absent") {
        states.set(normalized, "absent");
      } else if (inspected.state === "unreadable") {
        states.set(normalized, "unreadable");
      } else if (inspected.state === "present") {
        if (isExcluded(normalized, config.exclude)) {
          states.set(normalized, "excluded");
        } else if (repositoryPathDepth(normalized) > config.maxDepth) {
          states.set(normalized, "deep");
        } else if (
          inspected.stats.isFile() &&
          inspected.stats.size > config.maxFileSizeBytes
        ) {
          states.set(normalized, "oversize");
        } else if (parsed.has(normalized)) {
          states.set(normalized, "parsed");
        } else {
          states.set(normalized, "unsupported");
        }
      }
    } catch {
      states.set(normalized, "unreadable");
    }
  }
  return states;
}

function helperCommandPathCandidates(documents: ParsedDocument[]): string[] {
  return documents.flatMap((document) =>
    document.codeFences.flatMap((fence) =>
      fence.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((command) => /^(node|bash|sh|python|python3)\s+/.test(command))
        .map(helperScriptPath)
        .map((candidate) => {
          if (!candidate) return undefined;
          const resolution = resolveHelperScriptPath(
            document.artifact.path,
            candidate,
          );
          return resolution.kind === "candidate" ? resolution.path : undefined;
        })
        .filter((candidate): candidate is string => candidate !== undefined),
    ),
  );
}

function isWithinSkill(candidate: string, skillDirectory: string): boolean {
  return (
    candidate === skillDirectory || candidate.startsWith(`${skillDirectory}/`)
  );
}

function normalizeRepositoryPath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");

  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }

  return normalized;
}

async function repositoryPathExists(
  root: string,
  relativePath: string,
): Promise<boolean> {
  return (await safeRepositoryPath(root, relativePath)).state === "present";
}

function isRepoPathLike(value: string): boolean {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value);
}
