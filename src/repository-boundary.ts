import type { Stats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import path from "node:path";

export type SafeRepositoryPathResult =
  | { state: "present"; path: string; absolutePath: string; stats: Stats }
  | { state: "symlink" | "absent" | "unreadable" | "outside"; path: string };

export interface RepositoryWalkResult {
  files: string[];
  symlinks: string[];
  unreadable: Array<{ path: string; error: string }>;
}

/** Walk repository files without ever following a symbolic link. */
export async function walkRepositoryFiles(
  root: string,
  options: {
    maxDepth: number;
    excluded: (relativePath: string) => boolean;
  },
): Promise<RepositoryWalkResult> {
  const result: RepositoryWalkResult = {
    files: [],
    symlinks: [],
    unreadable: [],
  };
  const absoluteRoot = path.resolve(root);

  async function walk(relativeDirectory: string, depth: number): Promise<void> {
    let directory;
    try {
      directory = await opendir(
        relativeDirectory
          ? path.join(absoluteRoot, relativeDirectory)
          : absoluteRoot,
      );
    } catch (error) {
      result.unreadable.push({
        path: relativeDirectory || ".",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const entries: Array<{
      name: string;
      isSymbolicLink: boolean;
      isDirectory: boolean;
      isFile: boolean;
    }> = [];
    for await (const entry of directory) {
      entries.push({
        name: entry.name,
        isSymbolicLink: entry.isSymbolicLink(),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (options.excluded(relativePath)) continue;
      const entryDepth = depth + 1;
      if (entryDepth > options.maxDepth) continue;
      if (entry.isSymbolicLink) {
        result.symlinks.push(relativePath);
      } else if (entry.isDirectory) {
        await walk(relativePath, entryDepth);
      } else if (entry.isFile) {
        result.files.push(relativePath);
      }
    }
  }

  await walk("", 0);
  return result;
}

/** Inspect every component with lstat, never following a repository symlink. */
export async function safeRepositoryPath(
  root: string,
  candidate: string,
): Promise<SafeRepositoryPathResult> {
  const normalized = normalizeCandidate(candidate);
  if (!normalized) return { state: "outside", path: candidate };
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, normalized);
  if (
    absolutePath === absoluteRoot ||
    !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)
  ) {
    return { state: "outside", path: normalized };
  }

  let current = absoluteRoot;
  const segments = normalized.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        return { state: "symlink", path: normalized };
      }
      if (index === segments.length - 1) {
        return {
          state: "present",
          path: normalized,
          absolutePath,
          stats,
        };
      }
      if (!stats.isDirectory()) {
        return { state: "absent", path: normalized };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        state:
          code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable",
        path: normalized,
      };
    }
  }
  return { state: "absent", path: normalized };
}

function normalizeCandidate(candidate: string): string | undefined {
  const posix = candidate.replaceAll("\\", "/");
  if (path.posix.isAbsolute(posix)) return undefined;
  const rawSegments = posix.split("/");
  if (rawSegments.includes("..")) return undefined;
  const normalized = path.posix.normalize(posix).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../"))
    return undefined;
  return normalized;
}
