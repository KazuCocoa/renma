import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

export type SafeRepositoryPathResult =
  | { state: "present"; path: string; absolutePath: string; stats: Stats }
  | { state: "symlink" | "absent" | "unreadable" | "outside"; path: string };

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
