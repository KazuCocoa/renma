import { normalizeDependencyReference } from "./dependency-resolution.js";
import type {
  CompositionKindMismatch,
  CompositionMembership,
  CompositionRelationship,
  DeclaredCompositionIndex,
  ResolvedCompositionDeclaration,
} from "./declared-composition.js";
import { prepareDeclaredCompositionIndex } from "./declared-composition.js";
import type {
  Asset,
  AssetKind,
  AssetStatus,
  Catalog,
  DependencyKind,
} from "./model.js";
import type { Evidence } from "./types.js";

export interface ImpactAsset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  status?: AssetStatus;
  direct: boolean;
}

export interface ImpactProvenanceEdge {
  from: string;
  to: string;
  declaredTarget: string;
  kind: DependencyKind;
  relationship: CompositionRelationship;
  declarationIndex?: number;
  dependentMembership: CompositionMembership;
  direct: boolean;
  sourcePath: string;
  evidence?: Evidence;
}

export interface DeclaredImpactReport {
  focus: ImpactAsset;
  requiredDependents: ImpactAsset[];
  optionalDependents: ImpactAsset[];
  requiredSkills: ImpactAsset[];
  optionalSkills: ImpactAsset[];
  provenanceEdges: ImpactProvenanceEdge[];
  invalidIncomingDeclarations: ImpactInvalidIncomingDeclaration[];
}

export interface ImpactInvalidIncomingDeclaration extends CompositionKindMismatch {
  resolvedTargetId: string;
  resolvedTargetPath: string;
  dependentMembership: CompositionMembership;
}

interface ImpactTraversalState {
  asset: Asset;
  membership: CompositionMembership;
}

/** Resolve reverse explicit composition without scanning or rendering. */
export function resolveDeclaredImpact(
  catalog: Catalog,
  focusReference: string,
): DeclaredImpactReport {
  return resolveDeclaredImpactFromIndex(
    prepareDeclaredCompositionIndex(catalog),
    focusReference,
  );
}

/** Resolve one reverse closure while reusing a prepared composition index. */
export function resolveDeclaredImpactFromIndex(
  index: DeclaredCompositionIndex,
  focusReference: string,
): DeclaredImpactReport {
  const focus = resolveFocus(index, focusReference);
  const reached = new Map<string, Set<CompositionMembership>>();
  const processed = new Set<string>();
  const recordedTransitions = new Set<string>();
  const queue: ImpactTraversalState[] = [
    { asset: focus, membership: "required" },
  ];
  const provenanceEdges: ImpactProvenanceEdge[] = [];
  const invalidIncomingDeclarations: ImpactInvalidIncomingDeclaration[] = [];
  reached.set(focus.id, new Set(["required"]));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    if (!state) continue;
    const stateKey = `${state.asset.id}\0${state.membership}`;
    if (processed.has(stateKey)) continue;
    processed.add(stateKey);

    for (const declaration of index.incomingByTargetId.get(state.asset.id) ??
      []) {
      const membership = reverseMembership(state.membership, declaration);
      const transitionKey = impactTransitionKey(declaration, membership);
      if (recordedTransitions.has(transitionKey)) continue;
      recordedTransitions.add(transitionKey);

      if (declaration.kindMismatch) {
        invalidIncomingDeclarations.push({
          ...declaration.kindMismatch,
          membership,
          resolvedTargetId: declaration.target.id,
          resolvedTargetPath: declaration.target.sourcePath,
          dependentMembership: membership,
        });
        continue;
      }

      provenanceEdges.push({
        from: declaration.source.id,
        to: declaration.target.id,
        declaredTarget: declaration.dependency.to,
        kind: declaration.dependency.kind,
        relationship: declaration.relationship,
        ...(declaration.declarationIndex !== undefined
          ? { declarationIndex: declaration.declarationIndex }
          : {}),
        dependentMembership: membership,
        direct: declaration.target.id === focus.id,
        sourcePath: declaration.sourcePath,
        ...(declaration.evidence ? { evidence: declaration.evidence } : {}),
      });

      const memberships = reached.get(declaration.source.id) ?? new Set();
      if (!memberships.has(membership)) {
        memberships.add(membership);
        reached.set(declaration.source.id, memberships);
        queue.push({ asset: declaration.source, membership });
      }
    }
  }

  const stableProvenance = provenanceEdges.sort(compareImpactEdges);
  const directIds = new Set(
    stableProvenance.filter((edge) => edge.direct).map((edge) => edge.from),
  );
  const requiredDependents = impactDependents(
    index,
    reached,
    focus.id,
    "required",
    directIds,
  );
  const optionalDependents = impactDependents(
    index,
    reached,
    focus.id,
    "optional",
    directIds,
  );

  return {
    focus: impactAsset(focus, false),
    requiredDependents,
    optionalDependents,
    requiredSkills: requiredDependents.filter(
      (asset) => asset.kind === "skill",
    ),
    optionalSkills: optionalDependents.filter(
      (asset) => asset.kind === "skill",
    ),
    provenanceEdges: stableProvenance,
    invalidIncomingDeclarations: invalidIncomingDeclarations.sort(
      compareImpactMismatches,
    ),
  };
}

function resolveFocus(
  index: DeclaredCompositionIndex,
  reference: string,
): Asset {
  const normalized = normalizeDependencyReference(reference);
  const focus =
    index.assetsById.get(reference) ?? index.assetsByPath.get(normalized);
  if (!focus) {
    throw new Error(
      `Declared impact focus did not match any asset id or source path: ${reference}`,
    );
  }
  return focus;
}

function reverseMembership(
  current: CompositionMembership,
  declaration: ResolvedCompositionDeclaration,
): CompositionMembership {
  if (current === "optional") return "optional";
  if (
    declaration.dependency.kind === "optional" ||
    declaration.relationship === "optional_context" ||
    declaration.relationship === "optional_lens"
  ) {
    return "optional";
  }
  return "required";
}

function impactTransitionKey(
  declaration: ResolvedCompositionDeclaration,
  membership: CompositionMembership,
): string {
  return JSON.stringify([
    declaration.source.id,
    declaration.target.id,
    declaration.sourcePath,
    declaration.declarationForm,
    declaration.declarationIndex ?? null,
    declaration.dependency.to,
    declaration.relationship,
    membership,
  ]);
}

function impactDependents(
  index: DeclaredCompositionIndex,
  reached: ReadonlyMap<string, Set<CompositionMembership>>,
  focusId: string,
  membership: CompositionMembership,
  directIds: ReadonlySet<string>,
): ImpactAsset[] {
  return [...reached]
    .filter(([assetId, memberships]) => {
      if (assetId === focusId || !memberships.has(membership)) return false;
      return membership === "required" || !memberships.has("required");
    })
    .flatMap(([assetId]) => {
      const asset = index.assetsById.get(assetId);
      return asset ? [impactAsset(asset, directIds.has(asset.id))] : [];
    })
    .sort(compareImpactAssets);
}

function impactAsset(asset: Asset, direct: boolean): ImpactAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    direct,
  };
}

function compareImpactAssets(left: ImpactAsset, right: ImpactAsset): number {
  return (
    left.id.localeCompare(right.id) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

function compareImpactEdges(
  left: ImpactProvenanceEdge,
  right: ImpactProvenanceEdge,
): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.relationship.localeCompare(right.relationship) ||
    left.dependentMembership.localeCompare(right.dependentMembership) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}

function compareImpactMismatches(
  left: ImpactInvalidIncomingDeclaration,
  right: ImpactInvalidIncomingDeclaration,
): number {
  return (
    left.sourceId.localeCompare(right.sourceId) ||
    left.declaredTarget.localeCompare(right.declaredTarget) ||
    left.relationship.localeCompare(right.relationship) ||
    left.membership.localeCompare(right.membership) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}
