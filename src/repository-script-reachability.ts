import { repositorySupportReferences } from "./static-support.js";
import path from "node:path";
import {
  buildRepositoryScriptParentIndex,
  resolveRepositoryScriptParent,
  type RepositoryScriptParentIndex,
} from "./repository-script-parent.js";
import type { ParsedDocument } from "./types/metadata.js";

/** Exact document references, bounded to one README package, with cycle-safe BFS.
 * Script imports keep their separate executable dependency reachability model.
 */
export function repositoryScriptReachability(
  documents: readonly ParsedDocument[],
  parents: RepositoryScriptParentIndex = buildRepositoryScriptParentIndex(
    documents,
  ),
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const resolvedParents = [...parents.values()]
    .filter((candidates) => candidates.length === 1)
    .map((candidates) => candidates[0]!);
  if (resolvedParents.length === 0) return new Map();
  const documentsByPath = new Map(
    documents.map((document) => [document.artifact.path, document]),
  );
  const references = new Map(
    documents
      .filter(
        (document) =>
          document.artifact.markdownParserEligible &&
          resolvedParents.some((parent) =>
            document.artifact.path.startsWith(`${parent.directory}/`),
          ),
      )
      .map((document) => [
        document.artifact.path,
        repositorySupportReferences(document),
      ]),
  );
  const result = new Map<string, Map<string, number>>();
  for (const parent of resolvedParents) {
    const depths = new Map<string, number>([[parent.sourcePath, 0]]);
    const queue = [parent.sourcePath];
    for (let i = 0; i < queue.length; i++) {
      const sourcePath = queue[i]!;
      for (const reference of references.get(sourcePath) ?? []) {
        const target = documentsByPath.get(reference.targetPath);
        if (
          !target ||
          !reference.targetPath.startsWith(`${parent.directory}/`) ||
          depths.has(reference.targetPath)
        )
          continue;
        // Do not travel into another README package, including ambiguous ones.
        let directory = path.posix.dirname(reference.targetPath);
        while (directory !== parent.directory && !parents.has(directory)) {
          directory = path.posix.dirname(directory);
        }
        if (directory !== parent.directory) continue;
        if (target.artifact.kind === "script") {
          const resolved = resolveRepositoryScriptParent(
            reference.targetPath,
            parents,
          );
          if (
            resolved.state !== "resolved" ||
            resolved.parent.sourcePath !== parent.sourcePath
          )
            continue;
        }
        depths.set(reference.targetPath, depths.get(sourcePath)! + 1);
        queue.push(reference.targetPath);
      }
    }
    result.set(parent.sourcePath, depths);
  }
  return result;
}
