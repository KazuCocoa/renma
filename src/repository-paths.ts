import { access } from "node:fs/promises";
import path from "node:path";
import { classifyRepositorySkillPath } from "./discovery.js";
import type { Catalog } from "./model.js";
import type { Artifact, ParsedDocument } from "./types.js";

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
): Promise<ReadonlySet<string>> {
  const paths = new Set<string>(
    artifacts
      .map((artifact) => normalizeRepositoryPath(artifact.path))
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
  const sourceSkill = owningSkillPath(sourcePath);
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

function repositoryPathCandidates(
  documents: ParsedDocument[],
  catalog: Catalog,
): string[] {
  return [
    ...helperCommandPathCandidates(documents),
    ...catalog.dependencies
      .map((dependency) => dependency.to)
      .map(normalizeRepositoryPath)
      .filter((candidate): candidate is string => candidate !== undefined)
      .filter(isRepoPathLike),
  ].filter(
    (candidate, index, candidates) => candidates.indexOf(candidate) === index,
  );
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

function owningSkillPath(
  sourcePath: string,
): { skillDirectory: string } | undefined {
  const classified = classifyRepositorySkillPath(sourcePath);
  if (classified?.kind === "support") return classified;
  if (
    classified?.kind === "entrypoint" &&
    classified.entrypoint.kind === "canonical"
  ) {
    return classified;
  }
  return undefined;
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
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function isRepoPathLike(value: string): boolean {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value);
}
