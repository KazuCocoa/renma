import type {
  BuiltInExecutableDependencyAnalyzerId,
  ExecutableDependencyCandidate,
  ExecutableDependencyRelation,
} from "./executable-dependency-analyzer.js";
import type { ExecutableSurfaceScope } from "./executable-surface-inventory.js";
import type { RepositoryPathState } from "./repository-paths.js";

export type ExecutableSurfaceDependencyResolution =
  | "resolved"
  | "missing"
  | "unsafe"
  | "ambiguous"
  | "noncanonical"
  | "not-inventory"
  | "excluded"
  | "deep"
  | "oversize"
  | "unsupported"
  | "symlink"
  | "unreadable";

export interface ExecutableSurfaceDependency {
  analyzer: BuiltInExecutableDependencyAnalyzerId;
  sourcePath: string;
  line: number;
  snippet: string;
  relation: ExecutableDependencyRelation;
  rawSpecifier: string;
  normalizedTargetCandidates: string[];
  normalizedTarget?: string;
  resolution: ExecutableSurfaceDependencyResolution;
  targetPathState?: RepositoryPathState;
  occurrenceOrdinal: number;
}

export interface ExecutableDependencyGraphEdge {
  sourcePath: string;
  normalizedTarget: string;
}

/** Resolve analyzer-neutral candidates through immutable Renma path evidence. */
export function resolveExecutableDependencies(
  candidates: readonly ExecutableDependencyCandidate[],
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>,
  inventorySurfaceScopes: ReadonlyMap<string, ExecutableSurfaceScope>,
): ExecutableSurfaceDependency[] {
  const deduplicated = new Map<
    string,
    Omit<ExecutableSurfaceDependency, "occurrenceOrdinal">
  >();
  for (const candidate of candidates) {
    const resolved = resolveCandidate(
      candidate,
      repositoryPathStates,
      inventorySurfaceScopes,
    );
    deduplicated.set(JSON.stringify(resolved), resolved);
  }
  const ordinals = new Map<string, number>();
  return [...deduplicated.values()]
    .sort(compareDependencies)
    .map((dependency) => {
      const key = semanticDependencyBaseKey(dependency);
      const occurrenceOrdinal = (ordinals.get(key) ?? 0) + 1;
      ordinals.set(key, occurrenceOrdinal);
      return { ...dependency, occurrenceOrdinal };
    });
}

/** Collapse declaration evidence into deterministic source-target graph edges. */
export function canonicalExecutableDependencyGraphEdges(
  dependencies: readonly ExecutableSurfaceDependency[],
): ExecutableDependencyGraphEdge[] {
  const uniqueEdges = new Map<string, ExecutableDependencyGraphEdge>();
  for (const dependency of dependencies) {
    if (
      (dependency.resolution !== "resolved" &&
        dependency.resolution !== "noncanonical") ||
      !dependency.normalizedTarget
    ) {
      continue;
    }
    const edge = {
      sourcePath: dependency.sourcePath,
      normalizedTarget: dependency.normalizedTarget,
    };
    uniqueEdges.set(
      JSON.stringify([edge.sourcePath, edge.normalizedTarget]),
      edge,
    );
  }
  return [...uniqueEdges.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.normalizedTarget.localeCompare(right.normalizedTarget),
  );
}

function resolveCandidate(
  candidate: ExecutableDependencyCandidate,
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>,
  inventorySurfaceScopes: ReadonlyMap<string, ExecutableSurfaceScope>,
): Omit<ExecutableSurfaceDependency, "occurrenceOrdinal"> {
  const base = {
    analyzer: candidate.analyzer,
    sourcePath: candidate.sourcePath,
    line: candidate.line,
    snippet: candidate.snippet,
    relation: candidate.relation,
    rawSpecifier: candidate.rawSpecifier,
    normalizedTargetCandidates: [...candidate.normalizedTargetCandidates],
  };
  if (candidate.unsafe) return { ...base, resolution: "unsafe" };

  const states = candidate.normalizedTargetCandidates.map((candidatePath) => ({
    path: candidatePath,
    state: repositoryPathStates.get(candidatePath) ?? ("absent" as const),
  }));
  const parsed = states.filter(
    (candidateState) => candidateState.state === "parsed",
  );
  if (parsed.length > 1) return { ...base, resolution: "ambiguous" };
  if (parsed.length === 1) {
    const selected = parsed[0]!;
    const scope = inventorySurfaceScopes.get(selected.path);
    return {
      ...base,
      normalizedTarget: selected.path,
      resolution:
        scope === undefined
          ? "not-inventory"
          : scope === "noncanonical"
            ? "noncanonical"
            : "resolved",
      targetPathState: selected.state,
    };
  }

  const unavailable = states.filter(
    (candidateState) => candidateState.state !== "absent",
  );
  if (unavailable.length > 1) return { ...base, resolution: "ambiguous" };
  if (unavailable.length === 1) {
    const selected = unavailable[0]!;
    return {
      ...base,
      normalizedTarget: selected.path,
      resolution: selected.state as Exclude<
        RepositoryPathState,
        "parsed" | "absent"
      >,
      targetPathState: selected.state,
    };
  }
  if (states.length === 1) {
    return {
      ...base,
      normalizedTarget: states[0]!.path,
      resolution: "missing",
      targetPathState: "absent",
    };
  }
  return { ...base, resolution: "missing" };
}

function compareDependencies(
  left: Omit<ExecutableSurfaceDependency, "occurrenceOrdinal">,
  right: Omit<ExecutableSurfaceDependency, "occurrenceOrdinal">,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.analyzer.localeCompare(right.analyzer) ||
    left.relation.localeCompare(right.relation) ||
    dependencyTarget(left).localeCompare(dependencyTarget(right)) ||
    left.rawSpecifier.localeCompare(right.rawSpecifier)
  );
}

function semanticDependencyBaseKey(
  dependency: Omit<ExecutableSurfaceDependency, "occurrenceOrdinal">,
): string {
  return [
    dependency.sourcePath,
    dependency.analyzer,
    dependency.relation,
    dependencyTarget(dependency),
    dependency.rawSpecifier,
    dependency.resolution,
  ].join("\0");
}

function dependencyTarget(
  dependency: Pick<
    ExecutableSurfaceDependency,
    "normalizedTarget" | "normalizedTargetCandidates"
  >,
): string {
  return (
    dependency.normalizedTarget ??
    dependency.normalizedTargetCandidates.join("\0")
  );
}
