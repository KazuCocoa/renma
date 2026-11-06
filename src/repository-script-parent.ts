import path from "node:path";
import { compareUtf16CodeUnits } from "./canonical-json.js";
import { isGovernedRepositoryScriptPath } from "./executable-path-contract.js";
import { parseAssetMetadata } from "./metadata.js";
import type { ParsedDocument } from "./types/metadata.js";
import type { KnownAssetClassificationEvidence } from "./types/known-classification.js";

export interface RepositoryScriptParent {
  directory: string;
  sourcePath: string;
  id: string;
  kind: "context" | "context_lens";
  owner: string | null;
  document: ParsedDocument;
}

export type RepositoryScriptParentIndex = ReadonlyMap<
  string,
  readonly RepositoryScriptParent[]
>;

export type RepositoryScriptParentResolution =
  | { state: "not-applicable" }
  | { state: "missing"; candidatePath: string }
  | {
      state: "ambiguous";
      candidatePath: string;
      candidates: readonly RepositoryScriptParent[];
    }
  | {
      state: "resolved";
      candidatePath: string;
      parent: RepositoryScriptParent;
    };

/** A package README governs adjacent scripts and its scripts/ subtree only.
 * Root-level shared scripts, arbitrary Markdown neighbours, and references do
 * not establish a parent. Never search ancestors for a missing README.
 */
export function repositoryScriptDirectory(
  sourcePath: string,
): string | undefined {
  if (!isGovernedRepositoryScriptPath(sourcePath)) return undefined;
  const segments = sourcePath.split("/");
  const scriptsIndex = segments.indexOf("scripts", 1);
  const directory =
    scriptsIndex < 0
      ? path.posix.dirname(sourcePath)
      : segments.slice(0, scriptsIndex).join("/");
  return directory.includes("/") ? directory : undefined;
}

export function buildRepositoryScriptParentIndex(
  documents: readonly ParsedDocument[],
): RepositoryScriptParentIndex {
  const index = new Map<string, RepositoryScriptParent[]>();
  for (const document of documents) {
    const artifact = document.artifact;
    if (
      !/^(?:contexts|lenses)\/.+\/readme\.md$/iu.test(artifact.path) ||
      !artifact.markdownParserEligible ||
      (artifact.kind !== "context" && artifact.kind !== "context_lens")
    )
      continue;
    const directory = path.posix.dirname(artifact.path);
    // A README inside scripts/ is documentation, not a nested owner.
    if (directory.split("/").slice(1).includes("scripts")) continue;
    const metadata = parseAssetMetadata(document).metadata;
    const parents = index.get(directory) ?? [];
    parents.push({
      directory,
      sourcePath: artifact.path,
      id: metadata.id ?? artifact.path,
      kind:
        artifact.kind === "context_lens" || metadata.type === "context_lens"
          ? "context_lens"
          : "context",
      owner: metadata.owner?.trim() || null,
      document,
    });
    index.set(directory, parents);
  }
  for (const parents of index.values())
    parents.sort((a, b) => compareUtf16CodeUnits(a.sourcePath, b.sourcePath));
  return index;
}

export function resolveRepositoryScriptParent(
  sourcePath: string,
  index: RepositoryScriptParentIndex,
): RepositoryScriptParentResolution {
  const directory = repositoryScriptDirectory(sourcePath);
  if (!directory) return { state: "not-applicable" };
  const candidatePath = `${directory}/README.md`;
  const candidates = index.get(directory) ?? [];
  if (!candidates.length) return { state: "missing", candidatePath };
  if (candidates.length !== 1)
    return { state: "ambiguous", candidatePath, candidates };
  return { state: "resolved", candidatePath, parent: candidates[0]! };
}

export function withResolvedRepositoryScriptParent(
  classification: KnownAssetClassificationEvidence,
  sourcePath: string,
  index: RepositoryScriptParentIndex,
): KnownAssetClassificationEvidence {
  const resolution = resolveRepositoryScriptParent(sourcePath, index);
  if (resolution.state === "not-applicable") return classification;
  return {
    ...classification,
    parentAssetCandidatePath: resolution.candidatePath,
    parentResolution: resolution.state,
    ...(resolution.state === "resolved"
      ? { parentAssetPath: resolution.parent.sourcePath }
      : {}),
    ...(resolution.state === "ambiguous"
      ? {
          parentAssetCandidates: resolution.candidates.map(
            (parent) => parent.sourcePath,
          ),
        }
      : {}),
  };
}
