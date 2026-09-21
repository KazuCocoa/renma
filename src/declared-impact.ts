import { compareUtf16CodeUnits } from "./canonical-json.js";
import { normalizeDependencyReference } from "./dependency-resolution.js";
import type {
  CompositionKindMismatch,
  CompositionMembership,
  CompositionRelationship,
  DeclaredCompositionIndex,
  ResolvedCompositionDeclaration,
} from "./declared-composition.js";
import {
  compositionAssetIdentity,
  prepareDeclaredCompositionIndex,
  resolveCompositionDeclaration,
} from "./declared-composition.js";
import type {
  Asset,
  AssetKind,
  AssetStatus,
  Catalog,
  DependencyKind,
} from "./model.js";
import type { Evidence } from "./types/diagnostics.js";

export interface ImpactAsset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  status?: AssetStatus;
  statusReason?: string;
  statusChangedAt?: string;
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

export interface DeclaredImpactIndex extends DeclaredCompositionIndex {
  incomingByTargetId: ReadonlyMap<
    string,
    readonly ResolvedCompositionDeclaration[]
  >;
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
    prepareDeclaredImpactIndex(catalog),
    focusReference,
  );
}

/** Build forward composition lookups plus incoming declarations for impact. */
export function prepareDeclaredImpactIndex(
  catalog: Catalog,
): DeclaredImpactIndex {
  const compositionIndex = prepareDeclaredCompositionIndex(catalog);
  return {
    ...compositionIndex,
    incomingByTargetId: incomingCompositionDeclarations(compositionIndex),
  };
}

/** Resolve one reverse closure while reusing a prepared composition index. */
export function resolveDeclaredImpactFromIndex(
  index: DeclaredImpactIndex,
  focusReference: string,
): DeclaredImpactReport {
  const focus = resolveFocus(index, focusReference);
  const reached = new Map<string, Set<CompositionMembership>>();
  const reachedAssets = new Map<string, Asset>();
  const directIds = new Set<string>();
  const processed = new Set<string>();
  const recordedTransitions = new Set<string>();
  const queue: ImpactTraversalState[] = [
    { asset: focus, membership: "required" },
  ];
  const provenanceEdges: ImpactProvenanceEdge[] = [];
  const invalidIncomingDeclarations: ImpactInvalidIncomingDeclaration[] = [];
  reached.set(compositionAssetIdentity(focus), new Set(["required"]));
  reachedAssets.set(compositionAssetIdentity(focus), focus);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    if (!state) continue;
    const stateKey = `${compositionAssetIdentity(state.asset)}\0${state.membership}`;
    if (processed.has(stateKey)) continue;
    processed.add(stateKey);

    for (const declaration of index.incomingByTargetId.get(state.asset.id) ??
      []) {
      if (
        compositionAssetIdentity(declaration.target) !==
        compositionAssetIdentity(state.asset)
      )
        continue;
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
        direct:
          compositionAssetIdentity(declaration.target) ===
          compositionAssetIdentity(focus),
        sourcePath: declaration.sourcePath,
        ...(declaration.evidence ? { evidence: declaration.evidence } : {}),
      });

      const sourceIdentity = compositionAssetIdentity(declaration.source);
      reachedAssets.set(sourceIdentity, declaration.source);
      if (
        compositionAssetIdentity(declaration.target) ===
        compositionAssetIdentity(focus)
      )
        directIds.add(sourceIdentity);
      const memberships = reached.get(sourceIdentity) ?? new Set();
      if (!memberships.has(membership)) {
        memberships.add(membership);
        reached.set(sourceIdentity, memberships);
        queue.push({ asset: declaration.source, membership });
      }
    }
  }

  const stableProvenance = provenanceEdges.sort(compareImpactEdges);

  const requiredDependents = impactDependents(
    reachedAssets,
    reached,
    compositionAssetIdentity(focus),
    "required",
    directIds,
  );
  const optionalDependents = impactDependents(
    reachedAssets,
    reached,
    compositionAssetIdentity(focus),
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

function incomingCompositionDeclarations(
  index: DeclaredCompositionIndex,
): ReadonlyMap<string, readonly ResolvedCompositionDeclaration[]> {
  const result = new Map<string, ResolvedCompositionDeclaration[]>();
  for (const dependency of index.sortedDependencies) {
    const declaration = resolveCompositionDeclaration(index, dependency);
    if (!declaration) continue;
    const declarations = result.get(declaration.target.id);
    if (declarations) {
      declarations.push(declaration);
    } else {
      result.set(declaration.target.id, [declaration]);
    }
  }
  for (const declarations of result.values()) {
    declarations.sort(compareIncomingDeclarations);
  }
  return result;
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
    declaration.relationship === "optional_lens" ||
    declaration.relationship === "optional_skill"
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
  reachedAssets: ReadonlyMap<string, Asset>,
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
      const asset = reachedAssets.get(assetId);
      return asset
        ? [impactAsset(asset, directIds.has(compositionAssetIdentity(asset)))]
        : [];
    })
    .sort(compareImpactAssets);
}

function impactAsset(asset: Asset, direct: boolean): ImpactAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(asset.metadata.statusReason
      ? { statusReason: asset.metadata.statusReason }
      : {}),
    ...(asset.metadata.statusChangedAt
      ? { statusChangedAt: asset.metadata.statusChangedAt }
      : {}),
    direct,
  };
}

function compareImpactAssets(left: ImpactAsset, right: ImpactAsset): number {
  return (
    compareUtf16CodeUnits(left.id, right.id) ||
    compareUtf16CodeUnits(left.sourcePath, right.sourcePath)
  );
}

function compareIncomingDeclarations(
  left: ResolvedCompositionDeclaration,
  right: ResolvedCompositionDeclaration,
): number {
  const leftDependency = left.dependency;
  const rightDependency = right.dependency;
  return (
    compareUtf16CodeUnits(left.source.id, right.source.id) ||
    compareUtf16CodeUnits(left.target.id, right.target.id) ||
    compareUtf16CodeUnits(
      leftDependency.declaration ?? leftDependency.kind,
      rightDependency.declaration ?? rightDependency.kind,
    ) ||
    compareUtf16CodeUnits(leftDependency.to, rightDependency.to) ||
    compareUtf16CodeUnits(
      leftDependency.sourcePath,
      rightDependency.sourcePath,
    ) ||
    (leftDependency.evidence?.startLine ?? 0) -
      (rightDependency.evidence?.startLine ?? 0) ||
    (leftDependency.declarationIndex ?? -1) -
      (rightDependency.declarationIndex ?? -1)
  );
}

function compareImpactEdges(
  left: ImpactProvenanceEdge,
  right: ImpactProvenanceEdge,
): number {
  return (
    compareUtf16CodeUnits(left.from, right.from) ||
    compareUtf16CodeUnits(left.to, right.to) ||
    compareUtf16CodeUnits(left.relationship, right.relationship) ||
    compareUtf16CodeUnits(
      left.dependentMembership,
      right.dependentMembership,
    ) ||
    compareUtf16CodeUnits(left.sourcePath, right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}

function compareImpactMismatches(
  left: ImpactInvalidIncomingDeclaration,
  right: ImpactInvalidIncomingDeclaration,
): number {
  return (
    compareUtf16CodeUnits(left.sourceId, right.sourceId) ||
    compareUtf16CodeUnits(left.declaredTarget, right.declaredTarget) ||
    compareUtf16CodeUnits(left.relationship, right.relationship) ||
    compareUtf16CodeUnits(left.membership, right.membership) ||
    compareUtf16CodeUnits(left.sourcePath, right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}
