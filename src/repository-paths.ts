import path from "node:path";
import {
  classifyRepositorySkillPath,
  isExcluded,
  repositoryPathDepth,
} from "./discovery.js";
import { collectHelperCommandEvidence } from "./helper-command-evidence.js";
import type { Catalog } from "./model.js";
import { staticSupportReferences } from "./static-support.js";
import type { Artifact } from "./types/artifact.js";
import type { ParsedDocument } from "./types/metadata.js";
import type { ScanConfig } from "./types/configuration.js";
import { safeRepositoryPath } from "./repository-boundary.js";
import type { ExecutableDependencyCandidate } from "./executable-dependency-analyzer.js";

export {
  helperScriptPath,
  resolveHelperScriptPath,
  type HelperScriptPathResolution,
} from "./helper-command-evidence.js";

export type RepositoryPathState =
  | "parsed"
  | "excluded"
  | "oversize"
  | "deep"
  | "unsupported"
  | "symlink"
  | "unreadable"
  | "absent";

/** Collect immutable repository-relative path existence evidence for rules. */
export async function collectRepositoryPaths(
  root: string,
  artifacts: Artifact[],
  documents: ParsedDocument[],
  catalog: Catalog,
  discoveredPaths: ReadonlySet<string> = new Set(),
  executableDependencyCandidates: readonly ExecutableDependencyCandidate[] = [],
): Promise<ReadonlySet<string>> {
  const paths = new Set<string>(
    [...discoveredPaths, ...artifacts.map((artifact) => artifact.path)]
      .map(normalizeRepositoryPath)
      .filter((candidate): candidate is string => candidate !== undefined),
  );

  for (const candidate of repositoryPathCandidates(
    documents,
    catalog,
    executableDependencyCandidates,
  )) {
    if (paths.has(candidate)) continue;
    if (await repositoryPathExists(root, candidate)) paths.add(candidate);
  }

  return paths;
}

export function repositoryPathCandidates(
  documents: ParsedDocument[],
  catalog: Catalog,
  executableDependencyCandidates: readonly ExecutableDependencyCandidate[] = [],
): string[] {
  return [
    ...helperCommandPathCandidates(documents),
    ...staticSupportPathCandidates(documents),
    ...catalog.dependencies
      .map((dependency) => dependency.to)
      .map(normalizeRepositoryPath)
      .filter((candidate): candidate is string => candidate !== undefined)
      .filter(isRepoPathLike),
    ...executableDependencyCandidates.flatMap(
      (candidate) => candidate.normalizedTargetCandidates,
    ),
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
        states.set(inspected.boundaryPath, "symlink");
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
  return collectHelperCommandEvidence(documents)
    .map((evidence) =>
      evidence.pathResolution.kind === "candidate"
        ? evidence.pathResolution.path
        : undefined,
    )
    .filter((candidate): candidate is string => candidate !== undefined);
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
