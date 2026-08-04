import packageJson from "../../package.json" with { type: "json" };

import { canonicalSha256 } from "../canonical-json.js";
import type { ConfigOverrides } from "../config.js";
import { canonicalExecutableDependencyGraphEdges } from "../executable-dependency-resolution.js";
import {
  canonicalExecutableInvocationGraphEdges,
  type ExecutableSurfaceDependency,
  type ExecutableSurfaceEntry,
  type ExecutableSurfaceInvocation,
} from "../executable-surface-inventory.js";
import type { Asset, AssetStatus } from "../model.js";
import {
  collectRepositorySnapshot,
  type RepositorySnapshot,
} from "../repository-evidence.js";
import { formatJsonDocument } from "../report.js";
import { normalizeSkillRouteTarget } from "../skill-discovery.js";
import type { Diagnostic } from "../types/diagnostics.js";
import { executableGraphReport } from "./executable-graph.js";
import {
  graphFromRepositorySnapshot,
  type GraphEdge,
  type GraphReport,
} from "./graph.js";

export const EXPERIMENTAL_EXECUTION_CONTRACT_SCHEMA =
  "renma.experimental-execution-contract.v1" as const;
export const EXECUTION_CONTRACT_EVIDENCE_DIGEST_SCOPE =
  "selected_execution_contract_evidence_v1" as const;

const EXECUTION_CONTRACT_EVIDENCE_DIGEST_DOMAIN =
  "renma.experimental-execution-contract.evidence-digest" as const;
const EXECUTION_CONTRACT_EVIDENCE_DIGEST_PAYLOAD_VERSION = 1 as const;

export interface ExecutionContractOptions {
  entrypoint: string;
  sourceRevision?: string;
}

export interface ExecutionContractReport {
  schemaVersion: typeof EXPERIMENTAL_EXECUTION_CONTRACT_SCHEMA;
  stability: "experimental";
  generator: {
    name: "renma";
    version: string;
  };
  scope: {
    type: "declared_execution_contract";
    evidenceKind: "static_repository_evidence";
    runtimeUsage: false;
    telemetryCollected: false;
    authorizationDecision: false;
  };
  sourceRevision?: {
    value: string;
    providedBy: "caller";
    verifiedByRenma: false;
  };
  evidenceDigest: {
    algorithm: "sha256";
    value: string;
    scope: typeof EXECUTION_CONTRACT_EVIDENCE_DIGEST_SCOPE;
    calculatedBy: "renma";
  };
  subject: ExecutionContractSubject;
  executableEvidence: {
    inventorySchema: "renma.executable-surface-inventory.v1";
    surfaces: ExecutionContractSurface[];
    relationships: ExecutionContractRelationship[];
    structuralRelationships: ExecutionContractStructuralRelationship[];
    unresolvedEvidence: ExecutionContractEvidence[];
  };
  analysisBoundary: {
    kind: "bounded_static_analysis";
    coverage: {
      reachableRepositoryScriptCount: number;
      recognizedInvocationEvidenceCount: number;
      recognizedDependencyEvidenceCount: number;
      topologicalInvocationEvidenceCount: number;
      topologicalDependencyEvidenceCount: number;
      nonTopologicalEvidenceCount: number;
    };
    observations: {
      driftAssessmentPerformed: false;
      noUnresolvedStaticEvidenceObserved: boolean;
      runtimeOrUnsupportedBehaviorAbsenceProven: false;
    };
    limitations: string[];
  };
  diagnostics: Diagnostic[];
}

export interface ExecutionContractSubject {
  id: string;
  kind: "skill";
  sourcePath: string;
  contentHash: string;
  status?: AssetStatus;
  statusReason?: string;
  statusChangedAt?: string;
}

export interface ExecutionContractSurface {
  kind: "repository-script";
  sourcePath: string;
  scope: ExecutableSurfaceEntry["scope"];
  contentHash?: string;
  fingerprint: string;
  interpreterHints: string[];
  reachableFromSubject: boolean;
  minimumInvocationDepth?: number;
  inventoryDependencyEvidence: ExecutableSurfaceEntry["dependencyEvidence"];
}

export interface ExecutionContractEndpoint {
  kind: "skill" | "repository-script";
  sourcePath: string;
  id?: string;
  contentHash?: string;
}

export interface ExecutionContractRelationship {
  from: ExecutionContractEndpoint;
  to: ExecutionContractEndpoint & { kind: "repository-script" };
  relationship: "invokes";
  expectation: "possible";
  reachability: "direct" | "transitive";
  minimumTargetDepth: number;
  evidence: ExecutionContractEvidence[];
}

export interface ExecutionContractStructuralRelationship {
  from: ExecutionContractEndpoint & { kind: "skill"; id: string };
  to: ExecutionContractEndpoint & { kind: "repository-script" };
  relationship: "contains";
  meaning: "structural_placement_only";
}

export type ExecutionContractEvidence =
  ExecutionContractInvocationEvidence | ExecutionContractDependencyEvidence;

export interface ExecutionContractInvocationEvidence {
  type: "invocation";
  sourcePath: string;
  line: number;
  snippet: string;
  launcher: ExecutableSurfaceInvocation["launcher"];
  rawTarget: string;
  normalizedTarget?: string;
  resolution: ExecutableSurfaceInvocation["resolution"];
  targetPathState?: ExecutableSurfaceInvocation["targetPathState"];
  occurrenceOrdinal: number;
}

export interface ExecutionContractDependencyEvidence {
  type: "dependency";
  sourcePath: string;
  line: number;
  snippet: string;
  analyzer: ExecutableSurfaceDependency["analyzer"];
  relation: ExecutableSurfaceDependency["relation"];
  rawSpecifier: string;
  normalizedTargetCandidates: string[];
  normalizedTarget?: string;
  resolution: ExecutableSurfaceDependency["resolution"];
  targetPathState?: ExecutableSurfaceDependency["targetPathState"];
  occurrenceOrdinal: number;
}

interface CanonicalExecutableEvidenceKeys {
  invocation: ReadonlySet<string>;
  dependency: ReadonlySet<string>;
}

/** Collect once, then build every contract field from the same snapshot. */
export async function executionContract(
  targetPath: string,
  options: ExecutionContractOptions,
  overrides: ConfigOverrides = {},
): Promise<ExecutionContractReport> {
  const snapshot = await collectRepositorySnapshot(targetPath, overrides);
  return buildExecutionContract(snapshot, options);
}

export async function runExecutionContractCommand(
  targetPath: string,
  options: ExecutionContractOptions & { overrides?: ConfigOverrides },
): Promise<number> {
  const report = await executionContract(
    targetPath,
    options,
    options.overrides ?? {},
  );
  process.stdout.write(formatExecutionContractJson(report));
  return report.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

/** Pure deterministic projection over one already-collected repository snapshot. */
export function buildExecutionContract(
  snapshot: RepositorySnapshot,
  options: ExecutionContractOptions,
): ExecutionContractReport {
  const subjectAsset = resolveExecutionContractSubject(
    snapshot,
    options.entrypoint,
  );
  const subject = projectSubject(subjectAsset);
  assertExecutableSubjectIdentityIsSafe(snapshot, subjectAsset);

  const fullGraph = graphFromRepositorySnapshot(snapshot);
  const executableGraph = executableProjection(snapshot, fullGraph);
  assertExecutableGraphIdentityNamespaceIsSafe(
    executableGraph,
    snapshot.executableSurfaceInventory.surfaces,
  );
  const focusedExecutableGraph = executableProjection(
    snapshot,
    fullGraph,
    subject.sourcePath,
  );
  const resolvedInvokes = executableGraph.edges.filter(
    (edge) => edge.kind === "invokes" && edge.resolved,
  );
  const depths = invocationDepths(subject.id, resolvedInvokes);
  const reachableScriptPaths = new Set(
    [...depths]
      .filter(([id, depth]) => id !== subject.id && depth > 0)
      .map(([id]) => id),
  );
  const surfacesByPath = new Map(
    snapshot.executableSurfaceInventory.surfaces.map((surface) => [
      surface.path,
      surface,
    ]),
  );

  const relevantInvocations =
    focusedExecutableGraph.executable?.invocationEvidence ?? [];
  const relevantDependencies =
    snapshot.executableSurfaceInventory.dependencies.filter((dependency) =>
      reachableScriptPaths.has(dependency.sourcePath),
    );
  const canonicalEvidenceKeys = canonicalExecutableEvidenceKeys(
    relevantInvocations,
    relevantDependencies,
  );
  const relationships = projectRelationships(
    subject,
    resolvedInvokes,
    depths,
    surfacesByPath,
    relevantInvocations,
    relevantDependencies,
    canonicalEvidenceKeys,
  );
  const topologicalEvidenceKeys = new Set(
    relationships.flatMap((relationship) =>
      relationship.evidence.map(executionEvidenceKey),
    ),
  );
  const unresolvedEvidence = [
    ...relevantInvocations.map(projectInvocationEvidence),
    ...relevantDependencies.map(projectDependencyEvidence),
  ]
    .filter(
      (evidence) =>
        !topologicalEvidenceKeys.has(executionEvidenceKey(evidence)),
    )
    .sort(compareExecutionEvidence);
  const structuralRelationships = projectStructuralRelationships(
    subject,
    executableGraph,
    surfacesByPath,
  );
  const visibleSurfacePaths = new Set([
    ...reachableScriptPaths,
    ...structuralRelationships.map(
      (relationship) => relationship.to.sourcePath,
    ),
  ]);
  const surfaces = snapshot.executableSurfaceInventory.surfaces
    .filter((surface) => visibleSurfacePaths.has(surface.path))
    .map((surface) => projectSurface(surface, depths.get(surface.path)))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const relevantPaths = new Set([
    subject.sourcePath,
    ...surfaces.map((surface) => surface.sourcePath),
    ...unresolvedEvidence.map((evidence) => evidence.sourcePath),
  ]);
  const diagnostics = (executableGraph.diagnostics ?? []).filter(
    (diagnostic) =>
      (diagnostic.path !== undefined && relevantPaths.has(diagnostic.path)) ||
      (diagnostic.evidence !== undefined &&
        relevantPaths.has(diagnostic.evidence.path)),
  );
  const topologicalInvocationEvidenceCount = relationships.reduce(
    (count, relationship) =>
      count +
      relationship.evidence.filter((evidence) => evidence.type === "invocation")
        .length,
    0,
  );
  const topologicalDependencyEvidenceCount = relationships.reduce(
    (count, relationship) =>
      count +
      relationship.evidence.filter((evidence) => evidence.type === "dependency")
        .length,
    0,
  );
  const executableEvidence: ExecutionContractReport["executableEvidence"] = {
    inventorySchema: snapshot.executableSurfaceInventory.schema,
    surfaces,
    relationships,
    structuralRelationships,
    unresolvedEvidence,
  };
  const analysisBoundary: ExecutionContractReport["analysisBoundary"] = {
    kind: "bounded_static_analysis",
    coverage: {
      reachableRepositoryScriptCount: reachableScriptPaths.size,
      recognizedInvocationEvidenceCount: relevantInvocations.length,
      recognizedDependencyEvidenceCount: relevantDependencies.length,
      topologicalInvocationEvidenceCount,
      topologicalDependencyEvidenceCount,
      nonTopologicalEvidenceCount: unresolvedEvidence.length,
    },
    observations: {
      driftAssessmentPerformed: false,
      noUnresolvedStaticEvidenceObserved: unresolvedEvidence.length === 0,
      runtimeOrUnsupportedBehaviorAbsenceProven: false,
    },
    limitations: [
      "Only executable evidence recognized by Renma's bounded static analyzers is represented.",
      "No unresolved static evidence observed does not prove the absence of dynamic, unsupported, or runtime-only behavior.",
      "Relationships express possible static reachability only; they do not express required execution, ordering, call counts, approval, ownership, or authorization.",
      "No runtime observation or conformance comparison was performed.",
    ],
  };
  const evidenceDigest = calculateExecutionContractEvidenceDigest({
    subject,
    executableEvidence,
    analysisBoundary,
    diagnostics,
  });

  return {
    schemaVersion: EXPERIMENTAL_EXECUTION_CONTRACT_SCHEMA,
    stability: "experimental",
    generator: {
      name: "renma",
      version: packageJson.version,
    },
    scope: {
      type: "declared_execution_contract",
      evidenceKind: "static_repository_evidence",
      runtimeUsage: false,
      telemetryCollected: false,
      authorizationDecision: false,
    },
    ...(options.sourceRevision === undefined
      ? {}
      : {
          sourceRevision: {
            value: options.sourceRevision,
            providedBy: "caller" as const,
            verifiedByRenma: false as const,
          },
        }),
    evidenceDigest,
    subject,
    executableEvidence,
    analysisBoundary,
    diagnostics,
  };
}

export function formatExecutionContractJson(
  report: ExecutionContractReport,
): string {
  return formatJsonDocument(report);
}

function resolveExecutionContractSubject(
  snapshot: RepositorySnapshot,
  entrypoint: string,
): Asset & { kind: "skill" } {
  const normalized = normalizeSkillRouteTarget(entrypoint);
  if (normalized.rejection) {
    throw new Error(
      `execution-contract --entrypoint is not a safe repository Skill identity or path (${normalized.rejection}): ${entrypoint}`,
    );
  }
  const idMatches = snapshot.catalog.assets.filter(
    (asset) => asset.id === normalized.value,
  );
  const pathMatches = snapshot.catalog.assets.filter(
    (asset) => normalizeSourcePath(asset.sourcePath) === normalized.value,
  );
  const matches = [
    ...new Map(
      [...idMatches, ...pathMatches].map((asset) => [asset.sourcePath, asset]),
    ).values(),
  ].sort(compareAssets);
  if (idMatches.length > 1 || matches.length > 1) {
    throw new Error(
      `execution-contract --entrypoint is ambiguous; use one exact repository-relative SKILL.md path: ${entrypoint}`,
    );
  }
  const selected = matches[0];
  if (!selected) {
    throw new Error(
      `execution-contract --entrypoint did not match any asset ID or repository-relative path: ${entrypoint}`,
    );
  }
  if (selected.kind !== "skill") {
    throw new Error(
      `execution-contract --entrypoint resolved to non-Skill asset ${selected.id} (${selected.kind}) at ${selected.sourcePath}`,
    );
  }
  return selected as Asset & { kind: "skill" };
}

function assertExecutableSubjectIdentityIsSafe(
  snapshot: RepositorySnapshot,
  subject: Asset & { kind: "skill" },
): void {
  const duplicatePaths = snapshot.catalog.assets
    .filter((asset) => asset.kind === "skill" && asset.id === subject.id)
    .map((asset) => asset.sourcePath)
    .sort((left, right) => left.localeCompare(right));
  if (duplicatePaths.length > 1) {
    throw new Error(
      `execution-contract cannot build a safe executable projection for ${subject.sourcePath} because Skill ID ${subject.id} is duplicated at: ${duplicatePaths.join(", ")}`,
    );
  }
}

function assertExecutableGraphIdentityNamespaceIsSafe(
  report: GraphReport,
  surfaces: readonly ExecutableSurfaceEntry[],
): void {
  const surfacePaths = new Set(surfaces.map((surface) => surface.path));
  const skillPathsById = new Map<string, Set<string>>();
  for (const node of report.nodes) {
    if (node.executableRole !== "skill" || !surfacePaths.has(node.id)) continue;
    const sourcePaths = skillPathsById.get(node.id) ?? new Set<string>();
    sourcePaths.add(node.sourcePath);
    skillPathsById.set(node.id, sourcePaths);
  }
  const collisions = [...skillPathsById]
    .map(([value, sourcePaths]) => ({
      value,
      sourcePaths: [...sourcePaths].sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => left.value.localeCompare(right.value));
  if (collisions.length === 0) return;
  throw new Error(
    `execution-contract cannot build a safe executable projection because Skill IDs collide with repository-script paths: ${collisions
      .map(
        (collision) =>
          `${JSON.stringify(collision.value)} (Skill source paths: ${collision.sourcePaths.join(", ")}; repository-script path: ${collision.value})`,
      )
      .join("; ")}`,
  );
}

function executableProjection(
  snapshot: RepositorySnapshot,
  fullGraph: GraphReport,
  focus?: string,
): GraphReport {
  try {
    return executableGraphReport(
      fullGraph,
      snapshot.executableSurfaceInventory,
      snapshot.skillParents,
      focus,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `execution-contract could not build the canonical executable projection safely: ${reason}`,
    );
  }
}

function invocationDepths(
  subjectId: string,
  edges: readonly GraphEdge[],
): ReadonlyMap<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.targetId ?? edge.to);
    adjacency.set(edge.from, targets);
  }
  for (const targets of adjacency.values()) {
    targets.sort((left, right) => left.localeCompare(right));
  }
  const depths = new Map<string, number>([[subjectId, 0]]);
  const queue = [subjectId];
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    const nextDepth = depths.get(source)! + 1;
    for (const target of adjacency.get(source) ?? []) {
      const currentDepth = depths.get(target);
      if (currentDepth !== undefined && currentDepth <= nextDepth) continue;
      depths.set(target, nextDepth);
      queue.push(target);
    }
  }
  return depths;
}

function projectRelationships(
  subject: ExecutionContractSubject,
  edges: readonly GraphEdge[],
  depths: ReadonlyMap<string, number>,
  surfacesByPath: ReadonlyMap<string, ExecutableSurfaceEntry>,
  invocations: readonly ExecutableSurfaceInvocation[],
  dependencies: readonly ExecutableSurfaceDependency[],
  canonicalEvidenceKeys: CanonicalExecutableEvidenceKeys,
): ExecutionContractRelationship[] {
  return edges
    .filter((edge) => depths.has(edge.from) && surfacesByPath.has(edge.to))
    .map((edge): ExecutionContractRelationship => {
      const sourceDepth = depths.get(edge.from)!;
      const targetDepth = depths.get(edge.targetId ?? edge.to)!;
      const target = surfacesByPath.get(edge.to)!;
      const evidence =
        sourceDepth === 0
          ? invocations
              .filter(
                (invocation) =>
                  canonicalEvidenceKeys.invocation.has(
                    executableEvidenceKey(
                      invocation.sourcePath,
                      invocation.normalizedTarget,
                    ),
                  ) && invocation.normalizedTarget === edge.to,
              )
              .map(projectInvocationEvidence)
          : dependencies
              .filter(
                (dependency) =>
                  dependency.sourcePath === edge.from &&
                  canonicalEvidenceKeys.dependency.has(
                    executableEvidenceKey(
                      dependency.sourcePath,
                      dependency.normalizedTarget,
                    ),
                  ) &&
                  dependency.normalizedTarget === edge.to,
              )
              .map(projectDependencyEvidence);
      return {
        from:
          sourceDepth === 0
            ? subjectEndpoint(subject)
            : surfaceEndpoint(surfacesByPath.get(edge.from)!),
        to: surfaceEndpoint(target),
        relationship: "invokes",
        expectation: "possible",
        reachability: sourceDepth === 0 ? "direct" : "transitive",
        minimumTargetDepth: targetDepth,
        evidence: evidence.sort(compareExecutionEvidence),
      };
    })
    .sort(compareRelationships);
}

function projectStructuralRelationships(
  subject: ExecutionContractSubject,
  report: GraphReport,
  surfacesByPath: ReadonlyMap<string, ExecutableSurfaceEntry>,
): ExecutionContractStructuralRelationship[] {
  return report.edges
    .filter(
      (edge) =>
        edge.kind === "contains" &&
        edge.from === subject.id &&
        surfacesByPath.has(edge.to),
    )
    .map((edge) => ({
      from: subjectEndpoint(subject) as ExecutionContractEndpoint & {
        kind: "skill";
        id: string;
      },
      to: surfaceEndpoint(surfacesByPath.get(edge.to)!),
      relationship: "contains" as const,
      meaning: "structural_placement_only" as const,
    }))
    .sort((left, right) =>
      left.to.sourcePath.localeCompare(right.to.sourcePath),
    );
}

function projectSurface(
  surface: ExecutableSurfaceEntry,
  minimumInvocationDepth: number | undefined,
): ExecutionContractSurface {
  return {
    kind: "repository-script",
    sourcePath: surface.path,
    scope: surface.scope,
    ...(surface.contentHash ? { contentHash: surface.contentHash } : {}),
    fingerprint: surface.fingerprint,
    interpreterHints: [...surface.interpreterHints],
    reachableFromSubject: minimumInvocationDepth !== undefined,
    ...(minimumInvocationDepth === undefined ? {} : { minimumInvocationDepth }),
    inventoryDependencyEvidence: { ...surface.dependencyEvidence },
  };
}

function projectSubject(
  asset: Asset & { kind: "skill" },
): ExecutionContractSubject {
  return {
    id: asset.id,
    kind: "skill",
    sourcePath: asset.sourcePath,
    contentHash: asset.contentHash,
    ...(asset.metadata.status ? { status: asset.metadata.status } : {}),
    ...(asset.metadata.statusReason
      ? { statusReason: asset.metadata.statusReason }
      : {}),
    ...(asset.metadata.statusChangedAt
      ? { statusChangedAt: asset.metadata.statusChangedAt }
      : {}),
  };
}

function subjectEndpoint(
  subject: ExecutionContractSubject,
): ExecutionContractEndpoint & { kind: "skill"; id: string } {
  return {
    kind: "skill",
    id: subject.id,
    sourcePath: subject.sourcePath,
    contentHash: subject.contentHash,
  };
}

function surfaceEndpoint(
  surface: ExecutableSurfaceEntry,
): ExecutionContractEndpoint & { kind: "repository-script" } {
  return {
    kind: "repository-script",
    sourcePath: surface.path,
    ...(surface.contentHash ? { contentHash: surface.contentHash } : {}),
  };
}

function projectInvocationEvidence(
  invocation: ExecutableSurfaceInvocation,
): ExecutionContractInvocationEvidence {
  return {
    type: "invocation",
    sourcePath: invocation.sourcePath,
    line: invocation.line,
    snippet: invocation.snippet,
    launcher: invocation.launcher,
    rawTarget: invocation.rawTarget,
    ...(invocation.normalizedTarget
      ? { normalizedTarget: invocation.normalizedTarget }
      : {}),
    resolution: invocation.resolution,
    ...(invocation.targetPathState
      ? { targetPathState: invocation.targetPathState }
      : {}),
    occurrenceOrdinal: invocation.occurrenceOrdinal,
  };
}

function projectDependencyEvidence(
  dependency: ExecutableSurfaceDependency,
): ExecutionContractDependencyEvidence {
  return {
    type: "dependency",
    sourcePath: dependency.sourcePath,
    line: dependency.line,
    snippet: dependency.snippet,
    analyzer: dependency.analyzer,
    relation: dependency.relation,
    rawSpecifier: dependency.rawSpecifier,
    normalizedTargetCandidates: [...dependency.normalizedTargetCandidates],
    ...(dependency.normalizedTarget
      ? { normalizedTarget: dependency.normalizedTarget }
      : {}),
    resolution: dependency.resolution,
    ...(dependency.targetPathState
      ? { targetPathState: dependency.targetPathState }
      : {}),
    occurrenceOrdinal: dependency.occurrenceOrdinal,
  };
}

function executionEvidenceKey(evidence: ExecutionContractEvidence): string {
  return JSON.stringify(evidence);
}

function calculateExecutionContractEvidenceDigest(input: {
  subject: ExecutionContractSubject;
  executableEvidence: ExecutionContractReport["executableEvidence"];
  analysisBoundary: ExecutionContractReport["analysisBoundary"];
  diagnostics: Diagnostic[];
}): ExecutionContractReport["evidenceDigest"] {
  const payload = {
    domain: EXECUTION_CONTRACT_EVIDENCE_DIGEST_DOMAIN,
    payloadVersion: EXECUTION_CONTRACT_EVIDENCE_DIGEST_PAYLOAD_VERSION,
    scope: EXECUTION_CONTRACT_EVIDENCE_DIGEST_SCOPE,
    evidence: {
      subject: input.subject,
      executableEvidence: input.executableEvidence,
      analysisBoundary: {
        kind: input.analysisBoundary.kind,
        coverage: input.analysisBoundary.coverage,
        observations: input.analysisBoundary.observations,
      },
      diagnostics: input.diagnostics,
    },
  };
  return {
    algorithm: "sha256",
    value: canonicalSha256(payload),
    scope: EXECUTION_CONTRACT_EVIDENCE_DIGEST_SCOPE,
    calculatedBy: "renma",
  };
}

function canonicalExecutableEvidenceKeys(
  invocations: readonly ExecutableSurfaceInvocation[],
  dependencies: readonly ExecutableSurfaceDependency[],
): CanonicalExecutableEvidenceKeys {
  return {
    invocation: new Set(
      canonicalExecutableInvocationGraphEdges(invocations).map((edge) =>
        executableEvidenceKey(edge.sourcePath, edge.normalizedTarget),
      ),
    ),
    dependency: new Set(
      canonicalExecutableDependencyGraphEdges(dependencies).map((edge) =>
        executableEvidenceKey(edge.sourcePath, edge.normalizedTarget),
      ),
    ),
  };
}

function executableEvidenceKey(
  sourcePath: string,
  normalizedTarget: string | undefined,
): string {
  return JSON.stringify([sourcePath, normalizedTarget]);
}

function normalizeSourcePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function compareAssets(left: Asset, right: Asset): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.id.localeCompare(right.id)
  );
}

function compareRelationships(
  left: ExecutionContractRelationship,
  right: ExecutionContractRelationship,
): number {
  return (
    left.minimumTargetDepth - right.minimumTargetDepth ||
    left.from.sourcePath.localeCompare(right.from.sourcePath) ||
    left.to.sourcePath.localeCompare(right.to.sourcePath)
  );
}

function compareExecutionEvidence(
  left: ExecutionContractEvidence,
  right: ExecutionContractEvidence,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.type.localeCompare(right.type) ||
    evidenceAnalyzer(left).localeCompare(evidenceAnalyzer(right)) ||
    evidenceTarget(left).localeCompare(evidenceTarget(right)) ||
    left.occurrenceOrdinal - right.occurrenceOrdinal
  );
}

function evidenceAnalyzer(evidence: ExecutionContractEvidence): string {
  return evidence.type === "invocation" ? evidence.launcher : evidence.analyzer;
}

function evidenceTarget(evidence: ExecutionContractEvidence): string {
  return evidence.type === "invocation"
    ? (evidence.normalizedTarget ?? evidence.rawTarget)
    : (evidence.normalizedTarget ??
        (evidence.normalizedTargetCandidates.join("\0") ||
          evidence.rawSpecifier));
}
