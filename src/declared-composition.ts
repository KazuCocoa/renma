import { normalizeDependencyReference } from "./dependency-resolution.js";
import { DIAGNOSTIC_IDS } from "./diagnostic-ids.js";
import { evaluateAssetFreshness, todayIsoDate } from "./freshness.js";
import type {
  Asset,
  AssetKind,
  AssetStatus,
  Catalog,
  Dependency,
  DependencyKind,
} from "./model.js";
import type { Evidence, Finding } from "./types.js";

export type CompositionMembership = "required" | "optional";
export type CompositionRelationship =
  | "requires_context"
  | "optional_context"
  | "requires_lens"
  | "optional_lens"
  | "applies_to";

export interface CompositionAsset {
  id: string;
  kind: AssetKind;
  sourcePath: string;
  status?: AssetStatus;
  direct?: boolean;
}

export interface CompositionProvenanceEdge {
  from: string;
  to: string;
  declaredTarget: string;
  kind: DependencyKind;
  relationship: CompositionRelationship;
  declarationIndex?: number;
  membership: CompositionMembership;
  direct: boolean;
  sourcePath: string;
  evidence?: Evidence;
}

export interface CompositionResolutionIssue {
  sourceId: string;
  sourceKind: AssetKind;
  sourcePath: string;
  declaredTarget: string;
  relationship: CompositionRelationship;
  declarationIndex?: number;
  membership: CompositionMembership;
  evidence?: Evidence;
}

export interface CompositionKindMismatch extends CompositionResolutionIssue {
  expectedSourceKind?: AssetKind;
  actualSourceKind: AssetKind;
  expectedTargetKind?: AssetKind;
  actualTargetKind?: AssetKind;
  targetId?: string;
  targetPath?: string;
}

export interface CompositionCycle {
  membership: CompositionMembership;
  assetIds: string[];
  edges: CompositionProvenanceEdge[];
}

export interface CompositionConflictDeclaration {
  from: string;
  to: string;
  sourcePath: string;
  declarationIndex?: number;
  evidence?: Evidence;
}

export interface CompositionConflict {
  left: string;
  right: string;
  membership: CompositionMembership;
  declarations: CompositionConflictDeclaration[];
  leftProvenance: CompositionProvenanceEdge[];
  rightProvenance: CompositionProvenanceEdge[];
}

export interface CompositionFreshnessFinding {
  assetId: string;
  sourcePath: string;
  membership: CompositionMembership;
  isRoot: boolean;
  kind: "expired" | "review_overdue";
  date: string;
  evidence?: Evidence;
}

export interface CompositionLifecycleFinding {
  assetId: string;
  sourcePath: string;
  membership: CompositionMembership;
  isRoot: boolean;
  status: "deprecated" | "archived";
}

export interface DeclaredCompositionReport {
  root: CompositionAsset;
  requiredAssets: CompositionAsset[];
  optionalAssets: CompositionAsset[];
  provenanceEdges: CompositionProvenanceEdge[];
  unresolvedRequired: CompositionResolutionIssue[];
  unresolvedOptional: CompositionResolutionIssue[];
  kindMismatches: CompositionKindMismatch[];
  requiredCycles: CompositionCycle[];
  optionalCycles: CompositionCycle[];
  requiredConflicts: CompositionConflict[];
  optionalConflictCandidates: CompositionConflict[];
  freshnessFindings: CompositionFreshnessFinding[];
  lifecycleFindings: CompositionLifecycleFinding[];
  requiredComplete: boolean;
  optionalComplete: boolean;
  cycleFree: boolean;
}

/** One resolved explicit composition declaration retained for reverse queries. */
export interface ResolvedCompositionDeclaration {
  source: Asset;
  target: Asset;
  dependency: Dependency;
  relationship: CompositionRelationship;
  declarationForm: string;
  declarationIndex?: number;
  sourcePath: string;
  evidence?: Evidence;
  kindMismatch?: CompositionKindMismatch;
}

/** Reusable repository-wide lookups for declared-composition analysis. */
export interface DeclaredCompositionIndex {
  assetsById: ReadonlyMap<string, Asset>;
  assetsByPath: ReadonlyMap<string, Asset>;
  dependenciesBySource: ReadonlyMap<string, Dependency[]>;
  incomingByTargetId: ReadonlyMap<
    string,
    readonly ResolvedCompositionDeclaration[]
  >;
  sortedAssets: Asset[];
  sortedDependencies: Dependency[];
}

interface TraversalState {
  asset: Asset;
  membership: CompositionMembership;
}

interface CompositionCycleGroup {
  requiredRoots: Set<string>;
  optionalRoots: Set<string>;
  requiredCycle?: CompositionCycle;
  optionalCycle?: CompositionCycle;
}

export interface DeclaredCompositionScanStats {
  rootsAnalyzed: number;
  peakRetainedRootReports: number;
}

export interface DeclaredCompositionFindingAnalysis {
  findings: Finding[];
  stats: DeclaredCompositionScanStats;
}

/**
 * Resolve the finite closure of explicit required, optional, and applies_to
 * declarations. This is repository analysis; it does not select or load
 * runtime Context.
 */
export function resolveDeclaredComposition(
  catalog: Catalog,
  rootReference: string,
  options: { evaluationDate?: string | Date } = {},
): DeclaredCompositionReport {
  return resolveDeclaredCompositionFromIndex(
    prepareDeclaredCompositionIndex(catalog),
    rootReference,
    options,
  );
}

/** Build repository-wide lookup tables once for one or many root analyses. */
export function prepareDeclaredCompositionIndex(
  catalog: Catalog,
): DeclaredCompositionIndex {
  const assetsById = new Map<string, Asset>();
  const assetsByPath = new Map<string, Asset>();
  for (const asset of catalog.assets) {
    if (!assetsById.has(asset.id)) assetsById.set(asset.id, asset);
    const normalizedPath = normalizeDependencyReference(asset.sourcePath);
    if (!assetsByPath.has(normalizedPath)) {
      assetsByPath.set(normalizedPath, asset);
    }
  }
  const index: DeclaredCompositionIndex = {
    assetsById,
    assetsByPath,
    dependenciesBySource: dependenciesBySourceId(catalog.dependencies),
    incomingByTargetId: new Map(),
    sortedAssets: [...catalog.assets].sort(compareAssets),
    sortedDependencies: [...catalog.dependencies].sort(
      compareDependenciesBySource,
    ),
  };
  return {
    ...index,
    incomingByTargetId: incomingCompositionDeclarations(index),
  };
}

/** Resolve one root while reusing a prepared repository-wide index. */
export function resolveDeclaredCompositionFromIndex(
  index: DeclaredCompositionIndex,
  rootReference: string,
  options: { evaluationDate?: string | Date } = {},
): DeclaredCompositionReport {
  const root = resolveRoot(index, rootReference);
  const reached = new Map<string, Set<CompositionMembership>>();
  const processed = new Set<string>();
  const queue: TraversalState[] = [{ asset: root, membership: "required" }];
  const provenanceEdges: CompositionProvenanceEdge[] = [];
  const unresolvedRequired: CompositionResolutionIssue[] = [];
  const unresolvedOptional: CompositionResolutionIssue[] = [];
  const kindMismatches: CompositionKindMismatch[] = [];
  const recordedTransitions = new Set<string>();
  reached.set(root.id, new Set(["required"]));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    if (!state) continue;
    const stateKey = `${state.asset.id}\0${state.membership}`;
    if (processed.has(stateKey)) continue;
    processed.add(stateKey);

    for (const dependency of index.dependenciesBySource.get(state.asset.id) ??
      []) {
      const relationship = compositionRelationship(dependency, index);
      if (!relationship) continue;
      const membership = propagatedMembership(
        state.membership,
        dependency,
        relationship,
      );
      const transitionKey = declarationTransitionKey(
        state.asset,
        dependency,
        relationship,
        membership,
      );
      if (recordedTransitions.has(transitionKey)) continue;
      recordedTransitions.add(transitionKey);
      const target = resolveIndexedTarget(dependency, index);
      const mismatch = compositionKindMismatch(
        state.asset,
        target,
        dependency,
        relationship,
        membership,
      );
      if (!target) {
        const issue = resolutionIssue(
          state.asset,
          dependency,
          relationship,
          membership,
        );
        (membership === "required"
          ? unresolvedRequired
          : unresolvedOptional
        ).push(issue);
        if (mismatch) kindMismatches.push(mismatch);
        continue;
      }

      if (mismatch) {
        kindMismatches.push(mismatch);
        continue;
      }

      provenanceEdges.push({
        from: state.asset.id,
        to: target.id,
        declaredTarget: dependency.to,
        kind: dependency.kind,
        relationship,
        ...(dependency.declarationIndex !== undefined
          ? { declarationIndex: dependency.declarationIndex }
          : {}),
        membership,
        direct: state.asset.id === root.id,
        sourcePath: dependency.sourcePath,
        ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
      });

      const memberships = reached.get(target.id) ?? new Set();
      if (!memberships.has(membership)) {
        memberships.add(membership);
        reached.set(target.id, memberships);
        queue.push({ asset: target, membership });
      }
    }
  }

  const stableProvenance = provenanceEdges.sort(compareProvenanceEdges);
  const directIds = new Set(
    stableProvenance.filter((edge) => edge.direct).map((edge) => edge.to),
  );
  const requiredAssets = [...reached]
    .filter(
      ([assetId, memberships]) =>
        assetId !== root.id && memberships.has("required"),
    )
    .flatMap(([assetId]) => {
      const asset = index.assetsById.get(assetId);
      return asset ? [compositionAsset(asset, directIds.has(asset.id))] : [];
    })
    .sort(compareCompositionAssets);
  const optionalAssets = [...reached]
    .filter(([assetId, memberships]) => {
      return (
        assetId !== root.id &&
        memberships.has("optional") &&
        !memberships.has("required")
      );
    })
    .flatMap(([assetId]) => {
      const asset = index.assetsById.get(assetId);
      return asset ? [compositionAsset(asset, directIds.has(asset.id))] : [];
    })
    .sort(compareCompositionAssets);
  const requiredCycles = compositionCycles(stableProvenance, "required");
  const requiredCycleKeys = new Set(
    requiredCycles.map((cycle) => cycle.assetIds.join("\0")),
  );
  const optionalCycles = compositionCycles(stableProvenance, "optional").filter(
    (cycle) => !requiredCycleKeys.has(cycle.assetIds.join("\0")),
  );
  const conflicts = compositionConflicts(
    index,
    root,
    reached,
    stableProvenance,
  );
  const evaluationDate = evaluationIsoDate(options.evaluationDate);
  const governance = compositionGovernanceFindings(
    index,
    root,
    reached,
    evaluationDate,
  );
  const requiredMismatch = kindMismatches.some(
    (mismatch) => mismatch.membership === "required",
  );
  const optionalMismatch = kindMismatches.some(
    (mismatch) => mismatch.membership === "optional",
  );

  return {
    root: compositionAsset(root),
    requiredAssets,
    optionalAssets,
    provenanceEdges: stableProvenance,
    unresolvedRequired: unresolvedRequired.sort(compareResolutionIssues),
    unresolvedOptional: unresolvedOptional.sort(compareResolutionIssues),
    kindMismatches: kindMismatches.sort(compareResolutionIssues),
    requiredCycles,
    optionalCycles,
    requiredConflicts: conflicts.required,
    optionalConflictCandidates: conflicts.optional,
    freshnessFindings: governance.freshness,
    lifecycleFindings: governance.lifecycle,
    requiredComplete: unresolvedRequired.length === 0 && !requiredMismatch,
    optionalComplete: unresolvedOptional.length === 0 && !optionalMismatch,
    cycleFree: requiredCycles.length === 0 && optionalCycles.length === 0,
  };
}

/** Emit focused scan findings from the same pure composition analysis. */
export function declaredCompositionFindings(
  catalog: Catalog,
  evaluationDate: string,
): Finding[] {
  return analyzeDeclaredCompositionFindings(catalog, evaluationDate).findings;
}

/** Aggregate scan findings while retaining at most one complete root report. */
export function analyzeDeclaredCompositionFindings(
  catalog: Catalog,
  evaluationDate: string,
): DeclaredCompositionFindingAnalysis {
  const index = prepareDeclaredCompositionIndex(catalog);
  const cycleGroups = new Map<string, CompositionCycleGroup>();
  const conflicts: Finding[] = [];
  let retainedRootReports = 0;
  let peakRetainedRootReports = 0;
  let rootsAnalyzed = 0;

  for (const root of index.sortedAssets) {
    const report = resolveDeclaredCompositionFromIndex(index, root.id, {
      evaluationDate,
    });
    retainedRootReports += 1;
    peakRetainedRootReports = Math.max(
      peakRetainedRootReports,
      retainedRootReports,
    );
    rootsAnalyzed += 1;
    aggregateCycles(cycleGroups, root, report);
    if (root.kind === "skill") {
      appendConflictFindings(conflicts, root, report);
    }
    retainedRootReports -= 1;
  }

  const findings = [
    ...relationshipKindFindings(index),
    ...duplicateDeclarationFindings(index.sortedDependencies),
    ...cycleFindings(cycleGroups),
    ...conflicts,
  ].sort(
    (left, right) =>
      left.evidence.path.localeCompare(right.evidence.path) ||
      left.evidence.startLine - right.evidence.startLine ||
      left.id.localeCompare(right.id),
  );
  return {
    findings,
    stats: { rootsAnalyzed, peakRetainedRootReports },
  };
}

function relationshipKindFindings(index: DeclaredCompositionIndex): Finding[] {
  const findings: Finding[] = [];
  for (const dependency of index.sortedDependencies) {
    const source = index.assetsById.get(dependency.from);
    if (!source) continue;
    const target = resolveIndexedTarget(dependency, index);
    const relationship = compositionRelationship(dependency, index);
    let expectedTargetKind: AssetKind | undefined;
    let expectedSourceKind: AssetKind | undefined;
    let unsupportedConflictTarget = false;
    if (relationship) {
      expectedTargetKind =
        relationship === "requires_lens" || relationship === "optional_lens"
          ? "context_lens"
          : "context";
      if (relationship === "applies_to") {
        expectedSourceKind = "context_lens";
      }
    } else if (
      target &&
      dependency.kind === "conflicts" &&
      !["skill", "context", "context_lens"].includes(target.kind)
    ) {
      unsupportedConflictTarget = true;
    }
    const sourceMismatch =
      expectedSourceKind !== undefined && source.kind !== expectedSourceKind;
    const targetMismatch =
      unsupportedConflictTarget ||
      (expectedTargetKind !== undefined &&
        target !== undefined &&
        target.kind !== expectedTargetKind);
    if (!sourceMismatch && !targetMismatch) continue;

    const declaration = dependency.declaration ?? dependency.kind;
    if (sourceMismatch && expectedSourceKind) {
      findings.push(
        sourceKindMismatchFinding(
          source,
          dependency,
          declaration,
          relationship,
          expectedSourceKind,
        ),
      );
    }
    if (targetMismatch && target) {
      findings.push(
        targetKindMismatchFinding(
          source,
          target,
          dependency,
          declaration,
          relationship,
          unsupportedConflictTarget
            ? "skill, context, or context_lens"
            : (expectedTargetKind ?? "supported asset"),
        ),
      );
    }
  }
  return findings;
}

function sourceKindMismatchFinding(
  source: Asset,
  dependency: Dependency,
  declaration: string,
  relationship: CompositionRelationship | undefined,
  expectedSourceKind: AssetKind,
): Finding {
  return {
    id: DIAGNOSTIC_IDS.META_DEPENDENCY_SOURCE_KIND_MISMATCH,
    title: "Declared dependency originates from the wrong asset kind",
    category: "structure",
    severity: "medium",
    confidence: "high",
    evidence: dependency.evidence ?? fallbackEvidence(dependency),
    whyItMatters:
      "Relationship source kinds are part of the declared composition contract. An applies_to declaration outside a Context Lens is invalid independently of whether its target resolves.",
    remediation:
      "Move applies_to to the intended Context Lens, or change or remove the declaration only when reviewed repository intent supports that correction.",
    constraints: [
      "Do not change or create a target merely to hide a source-kind violation.",
      "Do not infer a Context Lens from prose, paths, names, or similarity.",
      "Keep unresolved and target-kind problems independently visible.",
      "Do not introduce runtime Context selection or loading.",
    ],
    verificationSteps: [
      "Inspect the kind of the asset that declares applies_to.",
      "Confirm applies_to originates from a Context Lens.",
      "Run renma scan and the focused composition graph.",
    ],
    llmHint: `Review ${dependency.sourcePath}: ${declaration} may originate only from ${expectedSourceKind}, but ${source.id} is ${source.kind}. Correct the declaring asset or relationship from repository evidence; preserve any separate unresolved-target or target-kind finding.`,
    details: {
      sourceId: source.id,
      sourcePath: source.sourcePath,
      relationshipKind: declaration,
      ...(relationship ? { normalizedRelationship: relationship } : {}),
      declaredTarget: dependency.to,
      expectedSourceKind,
      actualSourceKind: source.kind,
    },
  };
}

function targetKindMismatchFinding(
  source: Asset,
  target: Asset,
  dependency: Dependency,
  declaration: string,
  relationship: CompositionRelationship | undefined,
  expectedTargetKind: string,
): Finding {
  return {
    id: DIAGNOSTIC_IDS.META_DEPENDENCY_TARGET_KIND_MISMATCH,
    title: "Declared dependency targets the wrong asset kind",
    category: "structure",
    severity: "medium",
    confidence: "high",
    evidence: dependency.evidence ?? fallbackEvidence(dependency),
    whyItMatters:
      "Relationship target kinds are part of the declared composition contract. A resolved target with the wrong kind cannot satisfy the declared relationship.",
    remediation:
      "Point the declaration at an existing asset of the expected target kind, or change the declaration only when reviewed repository intent supports a different relationship.",
    constraints: [
      "Do not create a placeholder asset only to satisfy validation.",
      "Do not infer composition from prose, paths, names, or similarity.",
      "Preserve supported Context-to-Context dependency semantics.",
      "Do not introduce runtime Context selection or loading.",
    ],
    verificationSteps: [
      "Inspect the resolved target and its cataloged asset kind.",
      "Confirm the declaration points to the intended target kind.",
      "Run renma scan and the focused composition graph.",
    ],
    llmHint: `Review ${dependency.sourcePath} and preserve its intended ${declaration} relationship. Target ${dependency.to} resolves to ${target.kind}, but the declaration expects ${expectedTargetKind}. Correct the target or relationship from repository evidence and preserve any separate source-kind finding.`,
    details: {
      sourceId: source.id,
      sourcePath: source.sourcePath,
      relationshipKind: declaration,
      ...(relationship ? { normalizedRelationship: relationship } : {}),
      declaredTarget: dependency.to,
      expectedTargetKind,
      actualTargetKind: target.kind,
      targetId: target.id,
      targetPath: target.sourcePath,
    },
  };
}

function duplicateDeclarationFindings(dependencies: Dependency[]): Finding[] {
  const groups = new Map<string, Dependency[]>();
  for (const dependency of dependencies) {
    if (!dependency.declaration) continue;
    const key = [
      dependency.from,
      dependency.sourcePath,
      dependency.declaration,
      dependency.to,
    ].join("\0");
    groups.set(key, [...(groups.get(key) ?? []), dependency]);
  }

  const findings: Finding[] = [];
  for (const duplicates of groups.values()) {
    if (duplicates.length < 2) continue;
    const stable = [...duplicates].sort(compareDependencies);
    for (const duplicate of stable.slice(1)) {
      findings.push({
        id: DIAGNOSTIC_IDS.META_DUPLICATE_DECLARED_DEPENDENCY,
        title: "Dependency value is declared more than once in one field",
        category: "maintenance",
        severity: "low",
        confidence: "high",
        evidence: duplicate.evidence ?? fallbackEvidence(duplicate),
        whyItMatters:
          "Repeated values in one metadata field add noise and can obscure whether multiple declarations were intentional. This is separate from valid multi-parent composition.",
        remediation:
          "Keep one copy of the exact value in the metadata field after confirming that the duplicate carries no distinct meaning.",
        constraints: [
          "Do not remove declarations from different parents.",
          "Do not collapse different stable asset IDs based on similar titles or content.",
          "Do not change declaration order into semantic precedence.",
        ],
        verificationSteps: [
          "Inspect every duplicate line listed in the finding details.",
          "Remove only redundant copies in the same field.",
          "Run renma scan and the focused composition graph.",
        ],
        llmHint: `Remove only a redundant ${duplicate.declaration} value equal to ${JSON.stringify(duplicate.to)} in ${duplicate.sourcePath}. Preserve legitimate declarations through other parents and ask for review if the repetitions are not exact duplicates.`,
        details: {
          sourceId: duplicate.from,
          sourcePath: duplicate.sourcePath,
          relationshipKind: duplicate.declaration,
          declaredTarget: duplicate.to,
          occurrences: stable.map((item) => ({
            declarationIndex: item.declarationIndex,
            evidence: item.evidence ?? fallbackEvidence(item),
          })),
        },
      });
    }
  }
  return findings;
}

function aggregateCycles(
  grouped: Map<string, CompositionCycleGroup>,
  root: Asset,
  report: DeclaredCompositionReport,
): void {
  for (const cycle of report.requiredCycles) {
    addCycle(grouped, cycle, root.id);
  }
  for (const cycle of report.optionalCycles) {
    addCycle(grouped, cycle, root.id);
  }
}

function cycleFindings(grouped: Map<string, CompositionCycleGroup>): Finding[] {
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]): Finding => {
      const required = group.requiredRoots.size > 0;
      const cycle = required ? group.requiredCycle : group.optionalCycle;
      if (!cycle) {
        throw new Error("Composition cycle group has no representative cycle.");
      }
      const requiredRoots = [...group.requiredRoots].sort();
      const optionalRoots = [...group.optionalRoots].sort();
      const roots = [...new Set([...requiredRoots, ...optionalRoots])].sort();
      const evidence = cycle.edges[0]?.evidence ?? {
        path: cycle.edges[0]?.sourcePath ?? "(composition)",
        startLine: 1,
        endLine: 1,
        snippet: `Strongly connected assets: ${cycle.assetIds.join(", ")}`,
      };
      return {
        id: required
          ? DIAGNOSTIC_IDS.COMPOSITION_REQUIRED_CYCLE
          : DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CYCLE,
        title: required
          ? "Required declared composition contains a cycle"
          : "Optional declared composition contains a cycle",
        category: "structure",
        severity: required ? "medium" : "low",
        confidence: "high",
        evidence,
        whyItMatters: `The closure resolves finitely by stable asset ID, but a cycle may indicate unclear responsibility boundaries. It is required from ${requiredRoots.length > 0 ? requiredRoots.join(", ") : "no roots"} and optional from ${optionalRoots.length > 0 ? optionalRoots.join(", ") : "no roots"}; it defines neither precedence nor repeated runtime loading.`,
        remediation:
          "Review whether the assets should be split, consolidated, or related without a composition cycle.",
        constraints: [
          "Do not treat declaration order as precedence or override behavior.",
          "Do not repeatedly expand the same stable asset ID.",
          "Do not classify references, conflicts, or superseded_by cycles as composition cycles.",
          "Do not introduce runtime Context loading.",
        ],
        verificationSteps: [
          "Inspect each cycle-forming declaration and its line evidence.",
          "Run renma graph --view composition for an affected root.",
          "Confirm that requiredComplete and cycleFree are reviewed separately.",
        ],
        llmHint: `Review the ${required ? "required" : "optional"} composition cycle containing ${cycle.assetIds.join(", ")}. Required roots: ${requiredRoots.join(", ") || "none"}. Optional roots: ${optionalRoots.join(", ") || "none"}. Preserve valid knowledge while clarifying asset responsibilities; do not invent precedence or remove an edge solely to silence the finding.`,
        details: {
          membership: required ? "required" : "optional",
          assetIds: cycle.assetIds,
          roots,
          requiredRoots,
          optionalRoots,
          rootMemberships: [
            ...requiredRoots.map((rootId) => ({
              rootId,
              membership: "required",
            })),
            ...optionalRoots.map((rootId) => ({
              rootId,
              membership: "optional",
            })),
          ],
          edges: cycle.edges,
          closureResolvedFinitely: true,
          precedenceDefined: false,
        },
      };
    });
}

function addCycle(
  grouped: Map<string, CompositionCycleGroup>,
  cycle: CompositionCycle,
  root: string,
): void {
  const key = cycle.assetIds.join("\0");
  const existing = grouped.get(key);
  const group = existing ?? {
    requiredRoots: new Set<string>(),
    optionalRoots: new Set<string>(),
  };
  if (cycle.membership === "required") {
    group.requiredRoots.add(root);
    group.requiredCycle ??= cycle;
  } else {
    group.optionalRoots.add(root);
    group.optionalCycle ??= cycle;
  }
  grouped.set(key, group);
}

function appendConflictFindings(
  findings: Finding[],
  root: Asset,
  report: DeclaredCompositionReport,
): void {
  for (const conflict of report.requiredConflicts) {
    findings.push(conflictFinding(root, conflict, true));
  }
  for (const conflict of report.optionalConflictCandidates) {
    findings.push(conflictFinding(root, conflict, false));
  }
}

function conflictFinding(
  root: Asset,
  conflict: CompositionConflict,
  required: boolean,
): Finding {
  const evidence = conflict.declarations[0]?.evidence ?? {
    path: conflict.declarations[0]?.sourcePath ?? root.sourcePath,
    startLine: 1,
    endLine: 1,
    snippet: `${conflict.left} conflicts ${conflict.right}`,
  };
  return {
    id: required
      ? DIAGNOSTIC_IDS.COMPOSITION_DECLARED_CONFLICT
      : DIAGNOSTIC_IDS.COMPOSITION_OPTIONAL_CONFLICT,
    title: required
      ? "Declared composition requires conflicting assets"
      : "Declared composition has an optional conflict candidate",
    category: "structure",
    severity: required ? "medium" : "low",
    confidence: "high",
    evidence,
    whyItMatters: required
      ? "Both assets are required through explicit composition routes, and Renma has no declared precedence or conflict winner."
      : "At least one asset is optional. The conflict matters only if a runtime consumer selects that optional candidate; Renma does not make that selection.",
    remediation:
      "Review the declarations and asset responsibilities. Remove or change a relationship only when repository intent supports it; otherwise keep the conflict visible to consumers.",
    constraints: [
      "Do not select a winner from declaration order, status, date, popularity, or model inference.",
      "Do not merge prose or infer semantic conflict resolution.",
      "Do not select optional Context at runtime.",
    ],
    verificationSteps: [
      `Run renma graph . --view composition --focus ${root.id} --format json.`,
      "Inspect both conflict declarations and the provenance that includes each asset.",
      "Confirm the conflict remains declared when no reviewed resolution exists.",
    ],
    llmHint: `For composition root ${root.id}, review declared conflict ${conflict.left} versus ${conflict.right}. Preserve all provenance and do not choose a winner; ask for a human decision when the repository contract does not resolve the design.`,
    details: {
      rootId: root.id,
      rootPath: root.sourcePath,
      left: conflict.left,
      right: conflict.right,
      membership: conflict.membership,
      declarations: conflict.declarations,
      leftProvenance: conflict.leftProvenance,
      rightProvenance: conflict.rightProvenance,
      winner: null,
    },
  };
}

function fallbackEvidence(dependency: Dependency): Evidence {
  return {
    path: dependency.sourcePath,
    startLine: 1,
    endLine: 1,
    snippet: `${dependency.declaration ?? dependency.kind}: ${dependency.to}`,
  };
}

function resolveRoot(
  index: DeclaredCompositionIndex,
  reference: string,
): Asset {
  const normalized = normalizeDependencyReference(reference);
  const root =
    index.assetsById.get(reference) ?? index.assetsByPath.get(normalized);
  if (!root) {
    throw new Error(
      `Declared composition root did not match any asset id or source path: ${reference}`,
    );
  }
  return root;
}

function dependenciesBySourceId(
  dependencies: Dependency[],
): Map<string, Dependency[]> {
  const result = new Map<string, Dependency[]>();
  for (const dependency of dependencies) {
    result.set(dependency.from, [
      ...(result.get(dependency.from) ?? []),
      dependency,
    ]);
  }
  for (const dependenciesForSource of result.values()) {
    dependenciesForSource.sort(compareDependencies);
  }
  return result;
}

function incomingCompositionDeclarations(
  index: DeclaredCompositionIndex,
): Map<string, readonly ResolvedCompositionDeclaration[]> {
  const result = new Map<string, ResolvedCompositionDeclaration[]>();
  for (const dependency of index.sortedDependencies) {
    const source = index.assetsById.get(dependency.from);
    if (!source) continue;
    const relationship = compositionRelationship(dependency, index);
    if (!relationship) continue;
    const target = resolveIndexedTarget(dependency, index);
    if (!target) continue;
    const membership = propagatedMembership(
      "required",
      dependency,
      relationship,
    );
    const kindMismatch = compositionKindMismatch(
      source,
      target,
      dependency,
      relationship,
      membership,
    );
    const declaration: ResolvedCompositionDeclaration = {
      source,
      target,
      dependency,
      relationship,
      declarationForm: dependency.declaration ?? dependency.kind,
      ...(dependency.declarationIndex !== undefined
        ? { declarationIndex: dependency.declarationIndex }
        : {}),
      sourcePath: dependency.sourcePath,
      ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
      ...(kindMismatch ? { kindMismatch } : {}),
    };
    result.set(target.id, [...(result.get(target.id) ?? []), declaration]);
  }
  for (const declarations of result.values()) {
    declarations.sort(compareIncomingDeclarations);
  }
  return result;
}

function compareIncomingDeclarations(
  left: ResolvedCompositionDeclaration,
  right: ResolvedCompositionDeclaration,
): number {
  return (
    left.source.id.localeCompare(right.source.id) ||
    left.target.id.localeCompare(right.target.id) ||
    compareDependencies(left.dependency, right.dependency)
  );
}

function compositionRelationship(
  dependency: Dependency,
  index: DeclaredCompositionIndex,
): CompositionRelationship | undefined {
  if (isCompositionRelationship(dependency.declaration)) {
    return dependency.declaration;
  }
  if (dependency.kind === "applies_to") return "applies_to";
  if (dependency.kind !== "requires" && dependency.kind !== "optional") {
    return undefined;
  }

  const target = resolveIndexedTarget(dependency, index);
  const lens =
    target?.kind === "context_lens" ||
    dependency.to.startsWith("lens.") ||
    normalizeDependencyReference(dependency.to).startsWith("lenses/");
  if (dependency.kind === "requires") {
    return lens ? "requires_lens" : "requires_context";
  }
  return lens ? "optional_lens" : "optional_context";
}

function isCompositionRelationship(
  value: string | undefined,
): value is CompositionRelationship {
  return (
    value === "requires_context" ||
    value === "optional_context" ||
    value === "requires_lens" ||
    value === "optional_lens" ||
    value === "applies_to"
  );
}

function propagatedMembership(
  current: CompositionMembership,
  dependency: Dependency,
  relationship: CompositionRelationship,
): CompositionMembership {
  if (current === "optional") return "optional";
  if (
    dependency.kind === "optional" ||
    relationship === "optional_context" ||
    relationship === "optional_lens"
  ) {
    return "optional";
  }
  return "required";
}

function declarationTransitionKey(
  source: Asset,
  dependency: Dependency,
  relationship: CompositionRelationship,
  membership: CompositionMembership,
): string {
  return JSON.stringify([
    source.id,
    dependency.sourcePath,
    dependency.declaration ?? dependency.kind,
    dependency.declarationIndex ?? null,
    dependency.to,
    relationship,
    membership,
  ]);
}

function compositionKindMismatch(
  source: Asset,
  target: Asset | undefined,
  dependency: Dependency,
  relationship: CompositionRelationship,
  membership: CompositionMembership,
): CompositionKindMismatch | undefined {
  const expectedTargetKind =
    relationship === "requires_lens" || relationship === "optional_lens"
      ? "context_lens"
      : "context";
  const wrongSource =
    relationship === "applies_to" && source.kind !== "context_lens";
  const wrongTarget =
    target !== undefined && target.kind !== expectedTargetKind;
  if (!wrongSource && !wrongTarget) return undefined;

  return {
    ...resolutionIssue(source, dependency, relationship, membership),
    ...(wrongSource ? { expectedSourceKind: "context_lens" as const } : {}),
    actualSourceKind: source.kind,
    ...(wrongTarget
      ? {
          expectedTargetKind,
          actualTargetKind: target.kind,
          targetId: target.id,
          targetPath: target.sourcePath,
        }
      : {}),
  };
}

function resolveIndexedTarget(
  dependency: Dependency,
  index: DeclaredCompositionIndex,
): Asset | undefined {
  return (
    index.assetsById.get(dependency.to) ??
    index.assetsByPath.get(normalizeDependencyReference(dependency.to))
  );
}

function resolutionIssue(
  source: Asset,
  dependency: Dependency,
  relationship: CompositionRelationship,
  membership: CompositionMembership,
): CompositionResolutionIssue {
  return {
    sourceId: source.id,
    sourceKind: source.kind,
    sourcePath: source.sourcePath,
    declaredTarget: dependency.to,
    relationship,
    ...(dependency.declarationIndex !== undefined
      ? { declarationIndex: dependency.declarationIndex }
      : {}),
    membership,
    ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
  };
}

function compositionAsset(asset: Asset, direct?: boolean): CompositionAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    sourcePath: asset.sourcePath,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(direct !== undefined ? { direct } : {}),
  };
}

function compositionCycles(
  provenanceEdges: CompositionProvenanceEdge[],
  membership: CompositionMembership,
): CompositionCycle[] {
  const edges = provenanceEdges.filter(
    (edge) => edge.membership === membership,
  );
  const components = stronglyConnectedComponents(edges);
  return components
    .filter((assetIds) => {
      if (assetIds.length > 1) return true;
      const id = assetIds[0];
      return edges.some((edge) => edge.from === id && edge.to === id);
    })
    .map((assetIds) => {
      const ids = new Set(assetIds);
      return {
        membership,
        assetIds,
        edges: edges
          .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
          .sort(compareProvenanceEdges),
      };
    })
    .sort((left, right) =>
      left.assetIds.join("\0").localeCompare(right.assetIds.join("\0")),
    );
}

function stronglyConnectedComponents(
  edges: CompositionProvenanceEdge[],
): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)?.add(edge.to);
  }
  const indexById = new Map<string, number>();
  const lowLinkById = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (id: string): void => {
    indexById.set(id, nextIndex);
    lowLinkById.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of [...(adjacency.get(id) ?? [])].sort()) {
      if (!indexById.has(target)) {
        visit(target);
        lowLinkById.set(
          id,
          Math.min(lowLinkById.get(id) ?? 0, lowLinkById.get(target) ?? 0),
        );
      } else if (onStack.has(target)) {
        lowLinkById.set(
          id,
          Math.min(lowLinkById.get(id) ?? 0, indexById.get(target) ?? 0),
        );
      }
    }

    if (lowLinkById.get(id) !== indexById.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    components.push(component.sort());
  };

  for (const id of [...adjacency.keys()].sort()) {
    if (!indexById.has(id)) visit(id);
  }
  return components;
}

function compositionConflicts(
  index: DeclaredCompositionIndex,
  root: Asset,
  reached: Map<string, Set<CompositionMembership>>,
  provenanceEdges: CompositionProvenanceEdge[],
): { required: CompositionConflict[]; optional: CompositionConflict[] } {
  const included = new Set<string>([root.id, ...reached.keys()]);
  const declarationsByPair = new Map<
    string,
    CompositionConflictDeclaration[]
  >();

  for (const sourceId of [...included].sort()) {
    for (const dependency of index.dependenciesBySource.get(sourceId) ?? []) {
      if (dependency.kind !== "conflicts") continue;
      const target = resolveIndexedTarget(dependency, index);
      if (
        !target ||
        !included.has(target.id) ||
        dependency.from === target.id
      ) {
        continue;
      }
      const key = normalizedPairKey(dependency.from, target.id);
      declarationsByPair.set(key, [
        ...(declarationsByPair.get(key) ?? []),
        {
          from: dependency.from,
          to: target.id,
          sourcePath: dependency.sourcePath,
          ...(dependency.declarationIndex !== undefined
            ? { declarationIndex: dependency.declarationIndex }
            : {}),
          ...(dependency.evidence ? { evidence: dependency.evidence } : {}),
        },
      ]);
    }
  }

  const required: CompositionConflict[] = [];
  const optional: CompositionConflict[] = [];
  for (const [key, declarations] of declarationsByPair) {
    const [left, right] = key.split("\0") as [string, string];
    const membership =
      assetMembership(left, root, reached) === "required" &&
      assetMembership(right, root, reached) === "required"
        ? "required"
        : "optional";
    const conflict: CompositionConflict = {
      left,
      right,
      membership,
      declarations: declarations.sort(compareConflictDeclarations),
      leftProvenance: provenanceEdges
        .filter((edge) => edge.to === left)
        .sort(compareProvenanceEdges),
      rightProvenance: provenanceEdges
        .filter((edge) => edge.to === right)
        .sort(compareProvenanceEdges),
    };
    (membership === "required" ? required : optional).push(conflict);
  }

  return {
    required: required.sort(compareConflicts),
    optional: optional.sort(compareConflicts),
  };
}

function assetMembership(
  assetId: string,
  root: Asset,
  reached: Map<string, Set<CompositionMembership>>,
): CompositionMembership {
  if (assetId === root.id || reached.get(assetId)?.has("required")) {
    return "required";
  }
  return "optional";
}

function compositionGovernanceFindings(
  index: DeclaredCompositionIndex,
  root: Asset,
  reached: Map<string, Set<CompositionMembership>>,
  today: string,
): {
  freshness: CompositionFreshnessFinding[];
  lifecycle: CompositionLifecycleFinding[];
} {
  const freshness: CompositionFreshnessFinding[] = [];
  const lifecycle: CompositionLifecycleFinding[] = [];
  const governedIds = new Set([root.id, ...reached.keys()]);
  for (const assetId of [...governedIds].sort()) {
    const asset = index.assetsById.get(assetId);
    if (!asset) continue;
    const membership = assetMembership(asset.id, root, reached);
    const isRoot = asset.id === root.id;
    const evaluation = evaluateAssetFreshness(asset.metadata, today);
    if (evaluation.expired && evaluation.expiresAt) {
      freshness.push({
        assetId: asset.id,
        sourcePath: asset.sourcePath,
        membership,
        isRoot,
        kind: "expired",
        date: evaluation.expiresAt,
        ...metadataEvidence(asset, "expires_at"),
      });
    }
    if (evaluation.reviewOverdue && evaluation.reviewDueAt) {
      freshness.push({
        assetId: asset.id,
        sourcePath: asset.sourcePath,
        membership,
        isRoot,
        kind: "review_overdue",
        date: evaluation.reviewDueAt,
        ...metadataEvidence(asset, "last_reviewed_at"),
      });
    }
    if (
      asset.metadata.status === "deprecated" ||
      asset.metadata.status === "archived"
    ) {
      lifecycle.push({
        assetId: asset.id,
        sourcePath: asset.sourcePath,
        membership,
        isRoot,
        status: asset.metadata.status,
      });
    }
  }
  return {
    freshness: freshness.sort(compareFreshnessFindings),
    lifecycle: lifecycle.sort(
      (left, right) =>
        left.assetId.localeCompare(right.assetId) ||
        left.status.localeCompare(right.status),
    ),
  };
}

function metadataEvidence(
  asset: Asset,
  field: string,
): { evidence?: Evidence } {
  const evidence = asset.metadataFields[field];
  if (!evidence) return {};
  return {
    evidence: {
      path: evidence.path,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      snippet: evidence.raw,
    },
  };
}

function evaluationIsoDate(value: Date | string | undefined): string {
  if (value === undefined) return todayIsoDate();
  if (value instanceof Date) return todayIsoDate(value);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid composition evaluation date: ${value}`);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizedPairKey(left: string, right: string): string {
  return [left, right].sort().join("\0");
}

function compareDependencies(left: Dependency, right: Dependency): number {
  return (
    (left.declaration ?? left.kind).localeCompare(
      right.declaration ?? right.kind,
    ) ||
    left.to.localeCompare(right.to) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}

function compareDependenciesBySource(
  left: Dependency,
  right: Dependency,
): number {
  return (
    left.from.localeCompare(right.from) || compareDependencies(left, right)
  );
}

function compareAssets(left: Asset, right: Asset): number {
  return (
    left.id.localeCompare(right.id) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

function compareCompositionAssets(
  left: CompositionAsset,
  right: CompositionAsset,
): number {
  return (
    left.id.localeCompare(right.id) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

function compareProvenanceEdges(
  left: CompositionProvenanceEdge,
  right: CompositionProvenanceEdge,
): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.relationship.localeCompare(right.relationship) ||
    left.membership.localeCompare(right.membership) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}

function compareResolutionIssues(
  left: CompositionResolutionIssue,
  right: CompositionResolutionIssue,
): number {
  return (
    left.sourceId.localeCompare(right.sourceId) ||
    left.relationship.localeCompare(right.relationship) ||
    left.declaredTarget.localeCompare(right.declaredTarget) ||
    left.membership.localeCompare(right.membership) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}

function compareConflictDeclarations(
  left: CompositionConflictDeclaration,
  right: CompositionConflictDeclaration,
): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    (left.declarationIndex ?? -1) - (right.declarationIndex ?? -1)
  );
}

function compareConflicts(
  left: CompositionConflict,
  right: CompositionConflict,
): number {
  return (
    left.left.localeCompare(right.left) || left.right.localeCompare(right.right)
  );
}

function compareFreshnessFindings(
  left: CompositionFreshnessFinding,
  right: CompositionFreshnessFinding,
): number {
  return (
    left.assetId.localeCompare(right.assetId) ||
    left.kind.localeCompare(right.kind) ||
    left.date.localeCompare(right.date)
  );
}
