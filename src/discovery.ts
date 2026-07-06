import { glob, lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  Artifact,
  ArtifactKind,
  Diagnostic,
  ScanConfig,
} from "./types.js";

/** Discover and read scan artifacts according to the provided scan configuration. */
export async function discoverArtifacts(
  root: string,
  config: ScanConfig,
): Promise<{ artifacts: Artifact[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const paths = new Set<string>();

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
  if (relativePath.endsWith("/SKILL.md")) return "skill";
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

function depth(relativePath: string): number {
  return relativePath.split("/").filter(Boolean).length;
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
