import { repositorySupportReferences } from "./static-support.js";
import type { ParsedDocument } from "./types/metadata.js";

/** Reference reachability is independent of ownership and retains every source. */
export function repositoryScriptReachability(
  documents: readonly ParsedDocument[],
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const paths = new Set(documents.map((document) => document.artifact.path));
  const references = new Map(
    documents
      .filter((document) => document.artifact.markdownParserEligible)
      .map((document) => [
        document.artifact.path,
        repositorySupportReferences(document),
      ]),
  );
  const result = new Map<string, Map<string, number>>();
  for (const source of references.keys()) {
    const depths = new Map<string, number>([[source, 0]]);
    const queue = [source];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      for (const reference of references.get(current) ?? []) {
        if (
          !paths.has(reference.targetPath) ||
          depths.has(reference.targetPath)
        )
          continue;
        depths.set(reference.targetPath, depths.get(current)! + 1);
        queue.push(reference.targetPath);
      }
    }
    result.set(source, depths);
  }
  return result;
}
