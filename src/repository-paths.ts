import { access } from "node:fs/promises";
import path from "node:path";
import type { Catalog } from "./model.js";
import type { Artifact, ParsedDocument } from "./types.js";

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
  return parts.find((part) =>
    /(?:^|\/)scripts\/.+\.(?:mjs|js|cjs|sh|bash|py)$/.test(part),
  );
}

function repositoryPathCandidates(
  documents: ParsedDocument[],
  catalog: Catalog,
): string[] {
  return [
    ...helperCommandPathCandidates(documents),
    ...catalog.dependencies
      .map((dependency) => dependency.to)
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
        .map((candidate) =>
          candidate ? normalizeRepositoryPath(candidate) : undefined,
        )
        .filter((candidate): candidate is string => candidate !== undefined),
    ),
  );
}

function normalizeRepositoryPath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, path.posix.sep).replace(/^\.\//, "");
  if (!normalized || normalized.startsWith(path.posix.sep)) return undefined;
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
