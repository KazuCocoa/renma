import path from "node:path";
import {
  repositorySupportReferences,
  type StaticSupportReference,
} from "./static-support.js";
import type { AssetOwnership } from "./types/governance.js";
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
  references: StaticSupportReference[];
}

export type RepositoryScriptParentIndex = ReadonlyMap<
  string,
  readonly RepositoryScriptParent[]
>;

export type RepositoryScriptParentResolution =
  | { state: "not-applicable" }
  | { state: "missing" }
  | {
      state: "ambiguous";
      candidates: readonly RepositoryScriptParent[];
    }
  | {
      state: "resolved";
      parent: RepositoryScriptParent;
    };

export function buildRepositoryScriptParentIndex(
  documents: readonly ParsedDocument[],
): RepositoryScriptParentIndex {
  const index = new Map<string, RepositoryScriptParent[]>();
  for (const document of documents) {
    const artifact = document.artifact;
    if (
      !/^(?:contexts|lenses)\//u.test(artifact.path) ||
      !artifact.markdownParserEligible ||
      (artifact.kind !== "context" && artifact.kind !== "context_lens")
    )
      continue;
    const metadata = parseAssetMetadata(document).metadata;
    for (const reference of repositorySupportReferences(document, true)) {
      if (!isGovernedRepositoryScriptPath(reference.targetPath)) continue;
      const parents = index.get(reference.targetPath) ?? [];
      let candidate = parents.find(
        (parent) => parent.sourcePath === artifact.path,
      );
      if (!candidate) {
        candidate = {
          directory: path.posix.dirname(artifact.path),
          sourcePath: artifact.path,
          id: metadata.id ?? artifact.path,
          kind:
            artifact.kind === "context_lens" || metadata.type === "context_lens"
              ? "context_lens"
              : "context",
          owner: metadata.owner?.trim() || null,
          document,
          references: [],
        };
        parents.push(candidate);
      }
      candidate.references.push(reference);
      index.set(reference.targetPath, parents);
    }
  }
  for (const parents of index.values())
    parents.sort((a, b) => compareUtf16CodeUnits(a.sourcePath, b.sourcePath));
  return index;
}

export function resolveRepositoryScriptParent(
  sourcePath: string,
  index: RepositoryScriptParentIndex,
): RepositoryScriptParentResolution {
  if (!isGovernedRepositoryScriptPath(sourcePath))
    return { state: "not-applicable" };
  const candidates = index.get(sourcePath) ?? [];
  if (!candidates.length) return { state: "missing" };
  if (candidates.length !== 1) return { state: "ambiguous", candidates };
  return { state: "resolved", parent: candidates[0]! };
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
    ...(resolution.state === "resolved"
      ? { parentAssetCandidatePath: resolution.parent.sourcePath }
      : {}),
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

/** Owner agreement never collapses multiple source assets to a single parent. */
export function resolveRepositoryScriptOwnership(
  sourcePath: string,
  index: RepositoryScriptParentIndex,
): AssetOwnership {
  if (!isGovernedRepositoryScriptPath(sourcePath))
    return { declaredOwner: null, effectiveOwner: null, source: "unowned" };
  const candidates = (index.get(sourcePath) ?? []).map((parent) => ({
    id: parent.id,
    sourcePath: parent.sourcePath,
    declaredOwner: parent.owner,
    references: parent.references.map((reference) => ({
      path: reference.sourcePath,
      startLine: reference.line,
      endLine: reference.line,
      snippet: reference.raw,
    })),
    ...(parent.document.metadataFields.owner
      ? { ownerEvidence: parent.document.metadataFields.owner }
      : {}),
  }));
  const owners = new Set(
    candidates
      .map((candidate) => candidate.declaredOwner)
      .filter((owner): owner is string => owner !== null),
  );
  return {
    declaredOwner: null,
    effectiveOwner: owners.size === 1 ? [...owners][0]! : null,
    source:
      owners.size > 1
        ? "ambiguous"
        : owners.size === 1
          ? "inherited"
          : "unowned",
    candidates,
    ...(candidates.length === 1 && owners.size === 1
      ? {
          inheritedFrom: {
            id: candidates[0]!.id,
            sourcePath: candidates[0]!.sourcePath,
          },
        }
      : {}),
  };
}
