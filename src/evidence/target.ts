import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveSkillSupportParent,
  withResolvedSkillParent,
  type SkillParentIndex,
  type SkillParentResolution,
} from "../catalog.js";
import {
  classifyAssetPath,
  classifyRepositorySkillEntrypointPath,
  repositoryClassificationPath,
  type RepositoryClassificationPathResolution,
  type SkillEntrypointPath,
} from "../discovery.js";
import { parseDocument } from "../markdown.js";
import { parseAssetMetadata } from "../metadata.js";
import type { AssetMetadata, CatalogEntry } from "../model.js";
import {
  collectRepositorySnapshot,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import type { SecurityPolicyAssetEvidence } from "../security-policy-inventory.js";
import type {
  Artifact,
  AssetClassificationEvidence,
  AssetGovernanceEvidence,
  ParsedDocument,
} from "../types.js";

export interface TargetDocumentEvidence {
  absolutePath: string;
  outputPath: string;
  content: string;
  document: ParsedDocument;
  metadata: AssetMetadata;
  repositoryBoundary: RepositoryClassificationPathResolution;
  repositoryRoot?: string;
  repositoryRelativePath: string;
  entrypoint?: SkillEntrypointPath;
  classification: AssetClassificationEvidence;
}

export type TargetRepositoryEvidence =
  | {
      state: "resolved";
      snapshot: RepositorySnapshot;
      skillParents: SkillParentIndex;
      parent: SkillParentResolution;
      entry?: CatalogEntry;
      policy?: SecurityPolicyAssetEvidence;
      classification: AssetClassificationEvidence;
      governance: AssetGovernanceEvidence | null;
    }
  | {
      state: "unavailable";
      reason:
        | "repository-boundary-unresolved"
        | "repository-boundary-ambiguous"
        | "snapshot-unavailable";
      classification: AssetClassificationEvidence;
    };

export interface CollectTargetDocumentOptions {
  /** Preserve each command's established unresolved-path evidence shape. */
  unresolvedArtifactPath: "absolute" | "input";
}

/**
 * Read and structurally classify one command target.
 *
 * This stage does not claim parent inheritance or other repository-backed
 * governance. Those facts require a snapshot and are attached separately.
 */
export async function collectTargetDocumentEvidence(
  target: string,
  options: CollectTargetDocumentOptions,
): Promise<TargetDocumentEvidence> {
  const absolutePath = path.resolve(target);
  const content = await readFile(absolutePath, "utf8");
  const outputPath = target.replaceAll("\\", "/");
  const repositoryBoundary = repositoryClassificationPath(target);
  const repositoryRelativePath =
    repositoryBoundary.state === "resolved"
      ? repositoryBoundary.relativePath
      : "";
  // Keep repository-relative paths in public evidence and migration semantics.
  // The absolute path is reserved for filesystem I/O and exact entry matching.
  const repositoryRoot =
    repositoryBoundary.state === "resolved"
      ? repositoryBoundary.root
      : undefined;
  const initialClassification = classifyAssetPath(repositoryRelativePath);
  const unresolvedPath =
    options.unresolvedArtifactPath === "absolute" ? absolutePath : outputPath;
  const document = parseDocument({
    absolutePath,
    content,
    kind: initialClassification.kind,
    path: repositoryRelativePath || unresolvedPath,
    sizeBytes: Buffer.byteLength(content),
    contentClassification: "text",
    markdownParserEligible: /\.mdx?$/i.test(unresolvedPath),
  } satisfies Artifact);
  const metadata = parseAssetMetadata(document).metadata;
  const classification = classifyAssetPath(repositoryRelativePath, {
    ...(metadata.type ? { metadataType: metadata.type } : {}),
  });
  const entrypoint = repositoryRelativePath
    ? classifyRepositorySkillEntrypointPath(repositoryRelativePath)
    : undefined;

  return {
    absolutePath,
    outputPath,
    content,
    document,
    metadata,
    repositoryBoundary,
    ...(repositoryRoot ? { repositoryRoot } : {}),
    repositoryRelativePath,
    ...(entrypoint ? { entrypoint } : {}),
    classification,
  };
}

/**
 * Enrich structural target evidence from one repository snapshot.
 *
 * Snapshot failures intentionally remain unavailable. Falling back to path
 * guesses here would manufacture catalog identity or inherited governance.
 */
export async function collectTargetRepositoryEvidence(
  target: TargetDocumentEvidence,
): Promise<TargetRepositoryEvidence> {
  if (!target.repositoryRoot) {
    return {
      state: "unavailable",
      reason:
        target.repositoryBoundary.state === "unresolved"
          ? target.repositoryBoundary.reasonCode
          : "repository-boundary-unresolved",
      classification: target.classification,
    };
  }

  try {
    const snapshot = await collectRepositorySnapshot(target.repositoryRoot);
    const skillParents = snapshot.skillParents;
    const parent = resolveSkillSupportParent(
      target.repositoryRelativePath,
      skillParents,
    );
    const classification = withResolvedSkillParent(
      target.classification,
      target.repositoryRelativePath,
      skillParents,
    );
    const entry = snapshot.catalog.entries.find(
      (candidate) =>
        path.resolve(snapshot.root, candidate.sourcePath) ===
        target.absolutePath,
    );
    const policy = snapshot.securityPolicies.find(
      (candidate) => candidate.path === target.repositoryRelativePath,
    );
    const governance = buildTargetGovernance(
      target,
      classification,
      parent,
      entry,
      policy,
    );

    return {
      state: "resolved",
      snapshot,
      skillParents,
      parent,
      ...(entry ? { entry } : {}),
      ...(policy ? { policy } : {}),
      classification,
      governance,
    };
  } catch {
    return {
      state: "unavailable",
      reason: "snapshot-unavailable",
      classification: target.classification,
    };
  }
}

function buildTargetGovernance(
  target: TargetDocumentEvidence,
  classification: AssetClassificationEvidence,
  parent: SkillParentResolution,
  entry: CatalogEntry | undefined,
  policy: SecurityPolicyAssetEvidence | undefined,
): AssetGovernanceEvidence | null {
  if (entry) {
    return {
      ownership: entry.ownership,
      policySource: policySource(policy),
      ...(policy?.inheritedFrom
        ? { policyInheritedFrom: policy.inheritedFrom.sourcePath }
        : {}),
      metadataState: targetMetadataState(target, classification),
    };
  }
  if (classification.scope !== "skill-local") return null;

  const declaredOwner = target.metadata.owner?.trim();
  const ownership = declaredOwner
    ? {
        declaredOwner,
        effectiveOwner: declaredOwner,
        source: "declared" as const,
      }
    : parent.state === "resolved" && parent.parent.owner
      ? {
          declaredOwner: null,
          effectiveOwner: parent.parent.owner,
          source: "inherited" as const,
          inheritedFrom: {
            id: parent.parent.id,
            sourcePath: parent.parent.sourcePath,
          },
        }
      : {
          declaredOwner: null,
          effectiveOwner: null,
          source: "unowned" as const,
        };
  return {
    ownership,
    policySource: "missing",
    metadataState: targetMetadataState(target, classification),
  };
}

function policySource(
  policy: SecurityPolicyAssetEvidence | undefined,
): "declared" | "inherited" | "missing" {
  if (!policy?.hasEffectivePolicy) return "missing";
  if (policy.hasLocalPolicyMetadata) return "declared";
  return "inherited";
}

function targetMetadataState(
  target: TargetDocumentEvidence,
  classification: AssetClassificationEvidence,
): "declared" | "partial" | "missing" | "not-required" {
  const hasMetadata = Object.keys(target.document.metadata).length > 0;
  if (classification.scope === "skill-local" && !hasMetadata) {
    return "not-required";
  }
  if (!hasMetadata) return "missing";
  if (target.metadata.id && target.metadata.owner) return "declared";
  return "partial";
}
