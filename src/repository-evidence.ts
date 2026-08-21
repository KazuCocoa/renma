import { compareUtf16CodeUnits } from "./canonical-json.js";
import path from "node:path";

import {
  validateAgentSkills,
  type AgentSkillsValidationSummary,
} from "./agent-skills.js";
import {
  buildCatalog,
  buildSkillParentIndex,
  type SkillParentIndex,
} from "./catalog.js";
import { loadConfig, type ConfigOverrides } from "./config.js";
import {
  summarizeContextLensGovernance,
  type ContextLensSummary,
} from "./context-lens.js";
import {
  discoverArtifacts,
  inspectExplicitRepositoryArtifacts,
  type ExplicitArtifactInspectionResult,
} from "./discovery.js";
import {
  buildExecutableSurfaceInventory,
  type ExecutableSurfaceInventory,
} from "./executable-surface-inventory.js";
import {
  collectExecutableDependencyCandidates,
  type ExecutableDependencyCandidate,
} from "./executable-dependency-analyzer.js";
import { buildClassificationEvidenceIndex } from "./evidence/classification.js";
import { parseDocument } from "./markdown.js";
import type { Catalog } from "./model.js";
import {
  collectRepositoryPaths,
  collectRepositoryPathStates,
  repositoryPathCandidates,
  type RepositoryPathState,
} from "./repository-paths.js";
import {
  collectSecurityPolicyAssetEvidence,
  type SecurityPolicyAssetEvidence,
} from "./security-policy-inventory.js";
import {
  prepareSkillDiscoveryIndex,
  type SkillDiscoveryIndex,
} from "./skill-discovery.js";
import type { Artifact } from "./types/artifact.js";
import type { KnownAssetClassificationEvidence } from "./types/known-classification.js";
import type { ScanConfig } from "./types/configuration.js";
import type { Diagnostic } from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";
import {
  scanBoundarySource,
  type ScanBoundarySource,
} from "./scan-boundary.js";
import { staticallyExpectedSupportInspection } from "./static-support.js";

export interface RepositorySnapshotCore {
  readonly root: string;
  readonly config: ScanConfig;
  readonly configPath?: string;
  readonly evidenceBoundarySources: ScanBoundarySource[];
  readonly repositoryPathConfig: ScanConfig;
  readonly artifacts: Artifact[];
  readonly documents: ParsedDocument[];
  readonly discoveredPaths: ReadonlySet<string>;
  readonly skippedPathStates: ReadonlyMap<string, RepositoryPathState>;
  readonly blockedTraversalPaths: ReadonlySet<string>;
  readonly excludedSupportDirectoryPaths: ReadonlySet<string>;
  readonly discoveryDiagnostics: Diagnostic[];
  readonly executableDependencyCandidates: ExecutableDependencyCandidate[];
}

type SnapshotObject = Record<PropertyKey, unknown>;

const SET_MUTATORS = new Set<PropertyKey>(["add", "delete", "clear"]);
const MAP_MUTATORS = new Set<PropertyKey>(["set", "delete", "clear"]);

export type RepositoryProjectionName =
  | "catalog"
  | "agent-skills"
  | "skill-discovery"
  | "classifications"
  | "security-policies"
  | "executable-surfaces"
  | "context-lens"
  | "repository-paths";

/** Focused collection hooks used only to prove collection/projection invariants. */
export interface RepositoryCollectionInstrumentation {
  onDiscovery?: (root: string) => void;
  onDocumentParse?: (artifactPath: string) => void;
  onProjection?: (projection: RepositoryProjectionName) => void;
}

/** CI-only boundary predicates evaluated independently against target paths. */
export interface RepositoryEvidenceBoundaryOptions {
  sources: ScanBoundarySource[];
}

export interface RepositoryEvidence {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  catalog: Catalog;
  contextLens: ContextLensSummary;
  diagnostics: Diagnostic[];
}

export interface RepositorySnapshot extends RepositoryEvidence {
  core: RepositorySnapshotCore;
  config: ScanConfig;
  evidenceBoundarySources: ScanBoundarySource[];
  artifacts: Artifact[];
  documents: ParsedDocument[];
  repositoryPaths: ReadonlySet<string>;
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>;
  /** Snapshot-scoped indexes reused by commands without reinterpreting files. */
  classifications: ReadonlyMap<string, KnownAssetClassificationEvidence>;
  skillParents: SkillParentIndex;
  securityPolicies: SecurityPolicyAssetEvidence[];
  executableSurfaceInventory: ExecutableSurfaceInventory;
  agentSkills: AgentSkillsValidationSummary;
  skillDiscovery: SkillDiscoveryIndex;
  skillDiscoveryDiagnostics: Diagnostic[];
  discoveryDiagnostics: Diagnostic[];
  catalogDiagnostics: Diagnostic[];
  contextLensDiagnostics: Diagnostic[];
}

interface CatalogProjection {
  catalog: Catalog;
  diagnostics: Diagnostic[];
  skillParents: SkillParentIndex;
}

interface ContextLensProjection {
  summary: ContextLensSummary;
  diagnostics: Diagnostic[];
}

interface RepositoryProjections {
  catalog(): CatalogProjection;
  agentSkills(): AgentSkillsValidationSummary;
  skillDiscovery(): SkillDiscoveryIndex;
  classifications(): ReadonlyMap<string, KnownAssetClassificationEvidence>;
  securityPolicies(): SecurityPolicyAssetEvidence[];
  contextLens(): ContextLensProjection;
}

export async function collectRepositoryEvidence(
  targetPath: string,
  overrides: ConfigOverrides = {},
  instrumentation?: RepositoryCollectionInstrumentation,
): Promise<RepositoryEvidence> {
  const core = await collectRepositorySnapshotCore(
    targetPath,
    overrides,
    instrumentation,
  );
  const projections = createRepositoryProjections(core, instrumentation);
  const catalog = projections.catalog();
  const contextLens = projections.contextLens();
  return {
    root: core.root,
    ...(core.configPath ? { configPath: core.configPath } : {}),
    scannedFileCount: core.artifacts.length,
    catalog: catalog.catalog,
    contextLens: contextLens.summary,
    diagnostics: [
      ...core.discoveryDiagnostics,
      ...catalog.diagnostics,
      ...contextLens.diagnostics,
    ],
  };
}

/** Preserve the Discovery-free diagnostic projection for compatibility consumers. */
export function repositoryDiagnosticsWithoutSkillDiscovery(
  snapshot: Pick<
    RepositorySnapshot,
    "discoveryDiagnostics" | "catalogDiagnostics" | "contextLensDiagnostics"
  >,
): Diagnostic[] {
  return [
    ...snapshot.discoveryDiagnostics,
    ...snapshot.catalogDiagnostics,
    ...snapshot.contextLensDiagnostics,
  ];
}

/** Collect immutable repository facts exactly once before deriving projections. */
export async function collectRepositorySnapshotCore(
  targetPath: string,
  overrides: ConfigOverrides = {},
  instrumentation?: RepositoryCollectionInstrumentation,
  evidenceBoundary?: RepositoryEvidenceBoundaryOptions,
): Promise<RepositorySnapshotCore> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const evidenceBoundarySources = evidenceBoundary?.sources.length
    ? evidenceBoundary.sources
    : [scanBoundarySource(config, configPath)];
  instrumentation?.onDiscovery?.(root);
  const discovery = await discoverWithBoundarySources(
    root,
    config,
    evidenceBoundarySources,
  );
  const artifacts = [...discovery.artifacts];
  const discoveryDiagnostics = [...discovery.diagnostics];
  const skippedPathStates = new Map(discovery.skippedPathStates);
  const blockedTraversalPaths = new Set(discovery.blockedTraversalPaths);
  const documents = artifacts.map((artifact) => {
    instrumentation?.onDocumentParse?.(artifact.path);
    return parseDocument(artifact);
  });
  const attemptedExplicitPaths = new Set<string>();
  while (true) {
    const expected = staticallyExpectedSupportInspection(
      documents,
      [
        ...new Set([
          ...discovery.discoveredPaths,
          ...artifacts.map((artifact) => artifact.path),
          ...skippedPathStates.keys(),
        ]),
      ],
      buildSkillParentIndex(documents),
      [...discovery.excludedSupportDirectoryPaths],
    );
    const knownArtifactPaths = new Set(
      artifacts.map((artifact) => artifact.path),
    );
    const candidates = expected.paths
      .map((expectation) => expectation.targetPath)
      .filter(
        (candidate) =>
          !attemptedExplicitPaths.has(candidate) &&
          !knownArtifactPaths.has(candidate) &&
          !skippedPathStates.has(candidate),
      );
    if (candidates.length === 0) break;
    for (const candidate of candidates) attemptedExplicitPaths.add(candidate);
    const explicit = await inspectExplicitWithBoundarySources(
      root,
      config,
      evidenceBoundarySources,
      candidates,
    );
    discoveryDiagnostics.push(...explicit.diagnostics);
    for (const [candidate, state] of explicit.skippedPathStates) {
      skippedPathStates.set(candidate, state);
    }
    for (const candidate of explicit.blockedTraversalPaths) {
      blockedTraversalPaths.add(candidate);
    }
    const addedArtifacts = explicit.artifacts.filter(
      (artifact) => !knownArtifactPaths.has(artifact.path),
    );
    if (addedArtifacts.length === 0) continue;
    for (const artifact of addedArtifacts) {
      artifacts.push(artifact);
      instrumentation?.onDocumentParse?.(artifact.path);
      documents.push(parseDocument(artifact));
    }
  }
  artifacts.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  documents.sort((left, right) =>
    left.artifact.path < right.artifact.path
      ? -1
      : left.artifact.path > right.artifact.path
        ? 1
        : 0,
  );
  const finalExpectedSupport = staticallyExpectedSupportInspection(
    documents,
    [
      ...new Set([
        ...discovery.discoveredPaths,
        ...artifacts.map((artifact) => artifact.path),
        ...skippedPathStates.keys(),
      ]),
    ],
    buildSkillParentIndex(documents),
    [...discovery.excludedSupportDirectoryPaths],
  );
  const executableDependencyCandidates = collectExecutableDependencyCandidates(
    artifacts,
    documents,
    new Set(
      finalExpectedSupport.paths.map((expectation) => expectation.targetPath),
    ),
  );
  return immutableEvidenceGraph({
    root,
    config,
    ...(configPath ? { configPath } : {}),
    evidenceBoundarySources,
    repositoryPathConfig: evidenceBoundaryConfig(
      config,
      evidenceBoundarySources,
    ),
    artifacts,
    documents,
    discoveredPaths: discovery.discoveredPaths,
    skippedPathStates,
    blockedTraversalPaths,
    excludedSupportDirectoryPaths: discovery.excludedSupportDirectoryPaths,
    discoveryDiagnostics,
    executableDependencyCandidates,
  });
}

export async function collectRepositorySnapshot(
  targetPath: string,
  overrides: ConfigOverrides = {},
  instrumentation?: RepositoryCollectionInstrumentation,
  evidenceBoundary?: RepositoryEvidenceBoundaryOptions,
): Promise<RepositorySnapshot> {
  const core = await collectRepositorySnapshotCore(
    targetPath,
    overrides,
    instrumentation,
    evidenceBoundary,
  );
  const projections = createRepositoryProjections(core, instrumentation);
  const catalog = projections.catalog();
  instrumentation?.onProjection?.("repository-paths");
  const repositoryPaths = await collectRepositoryPaths(
    core.root,
    core.artifacts,
    core.documents,
    catalog.catalog,
    core.discoveredPaths,
    core.executableDependencyCandidates,
    [...core.excludedSupportDirectoryPaths],
  );
  const repositoryPathStates = await collectRepositoryPathStates(
    core.root,
    [
      ...repositoryPaths,
      ...core.skippedPathStates.keys(),
      ...repositoryPathCandidates(
        core.documents,
        catalog.catalog,
        core.executableDependencyCandidates,
        [...core.excludedSupportDirectoryPaths],
      ),
    ],
    core.artifacts,
    core.repositoryPathConfig,
    core.skippedPathStates,
  );
  return createRepositorySnapshot(
    core,
    projections,
    immutableEvidenceGraph(repositoryPaths),
    immutableEvidenceGraph(repositoryPathStates),
    instrumentation,
  );
}

async function discoverWithBoundarySources(
  root: string,
  semanticConfig: ScanConfig,
  sources: readonly ScanBoundarySource[],
): Promise<Awaited<ReturnType<typeof discoverArtifacts>>> {
  if (sources.length === 1) {
    return discoverArtifacts(root, boundaryConfig(semanticConfig, sources[0]!));
  }
  const discoveries = await Promise.all(
    sources.map((source) =>
      discoverArtifacts(root, boundaryConfig(semanticConfig, source)),
    ),
  );
  const artifacts = new Map<string, Artifact>();
  const diagnostics = new Map<string, Diagnostic>();
  const discoveredPaths = new Set<string>();
  const skippedPathStates = new Map<string, RepositoryPathState>();
  const blockedTraversalPaths = new Set<string>();
  const traversedDirectoryPaths = new Set<string>();
  const excludedSupportDirectoryPaths = new Set<string>();
  for (const discovery of discoveries) {
    for (const artifact of discovery.artifacts) {
      artifacts.set(artifact.path, artifact);
    }
    for (const diagnostic of discovery.diagnostics) {
      diagnostics.set(JSON.stringify(diagnostic), diagnostic);
    }
    for (const discoveredPath of discovery.discoveredPaths) {
      discoveredPaths.add(discoveredPath);
    }
    for (const [skippedPath, state] of discovery.skippedPathStates) {
      skippedPathStates.set(skippedPath, state);
    }
    for (const blockedPath of discovery.blockedTraversalPaths) {
      blockedTraversalPaths.add(blockedPath);
    }
    for (const traversedPath of discovery.traversedDirectoryPaths) {
      traversedDirectoryPaths.add(traversedPath);
    }
    for (const excludedPath of discovery.excludedSupportDirectoryPaths) {
      excludedSupportDirectoryPaths.add(excludedPath);
    }
  }
  for (const traversedPath of traversedDirectoryPaths) {
    blockedTraversalPaths.delete(traversedPath);
    excludedSupportDirectoryPaths.delete(traversedPath);
  }
  return {
    artifacts: [...artifacts.values()].sort((left, right) =>
      compareUtf16CodeUnits(left.path, right.path),
    ),
    diagnostics: [...diagnostics.entries()]
      .sort(([left], [right]) => compareUtf16CodeUnits(left, right))
      .map(([, diagnostic]) => diagnostic),
    discoveredPaths,
    skippedPathStates,
    blockedTraversalPaths,
    traversedDirectoryPaths,
    excludedSupportDirectoryPaths,
  };
}

async function inspectExplicitWithBoundarySources(
  root: string,
  semanticConfig: ScanConfig,
  sources: readonly ScanBoundarySource[],
  candidatePaths: readonly string[],
): Promise<ExplicitArtifactInspectionResult> {
  const inspections = await Promise.all(
    sources.map((source) =>
      inspectExplicitRepositoryArtifacts(
        root,
        boundaryConfig(semanticConfig, source),
        candidatePaths,
      ),
    ),
  );
  const artifacts = new Map<string, Artifact>();
  const diagnostics = new Map<string, Diagnostic>();
  const skippedPathStates = new Map<string, RepositoryPathState>();
  const blockedTraversalPaths = new Set<string>();
  for (const inspection of inspections) {
    for (const artifact of inspection.artifacts) {
      artifacts.set(artifact.path, artifact);
    }
    for (const diagnostic of inspection.diagnostics) {
      diagnostics.set(JSON.stringify(diagnostic), diagnostic);
    }
    for (const [candidate, state] of inspection.skippedPathStates) {
      skippedPathStates.set(candidate, state);
    }
    for (const candidate of inspection.blockedTraversalPaths) {
      blockedTraversalPaths.add(candidate);
    }
  }
  for (const artifactPath of artifacts.keys()) {
    skippedPathStates.delete(artifactPath);
  }
  return {
    artifacts: [...artifacts.values()].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
    diagnostics: [...diagnostics.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, diagnostic]) => diagnostic),
    skippedPathStates,
    blockedTraversalPaths,
  };
}

function evidenceBoundaryConfig(
  semanticConfig: ScanConfig,
  sources: readonly ScanBoundarySource[],
): ScanConfig {
  const excludes =
    sources.length === 0 ? [] : sortedExactPatterns(sources[0]!.exclude);
  return {
    ...semanticConfig,
    globs: sortedExactPatterns(sources.flatMap((source) => source.globs)),
    exclude: excludes.filter((candidate) =>
      sources
        .slice(1)
        .every((source) =>
          sortedExactPatterns(source.exclude).includes(candidate),
        ),
    ),
    maxFileSizeBytes: Math.max(
      ...sources.map((source) => source.maxFileSizeBytes),
    ),
    maxDepth: Math.max(...sources.map((source) => source.maxDepth)),
  };
}

function boundaryConfig(
  semanticConfig: ScanConfig,
  source: ScanBoundarySource,
): ScanConfig {
  return {
    ...semanticConfig,
    globs: [...source.globs],
    exclude: [...source.exclude],
    maxFileSizeBytes: source.maxFileSizeBytes,
    maxDepth: source.maxDepth,
  };
}

function sortedExactPatterns(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    compareUtf16CodeUnits(left, right),
  );
}

/** Explicitly prepare the named pure projections from one collected core. */
export function prepareRepositorySnapshotProjections(
  snapshot: RepositorySnapshot,
  projectionNames: readonly RepositoryProjectionName[],
): void {
  for (const projectionName of projectionNames) {
    switch (projectionName) {
      case "catalog":
        void snapshot.catalog;
        break;
      case "agent-skills":
        void snapshot.agentSkills;
        break;
      case "skill-discovery":
        void snapshot.skillDiscovery;
        break;
      case "classifications":
        void snapshot.classifications;
        break;
      case "security-policies":
        void snapshot.securityPolicies;
        break;
      case "executable-surfaces":
        void snapshot.executableSurfaceInventory;
        break;
      case "context-lens":
        void snapshot.contextLens;
        break;
      case "repository-paths":
        void snapshot.repositoryPaths;
        break;
    }
  }
}

function createRepositoryProjections(
  core: RepositorySnapshotCore,
  instrumentation: RepositoryCollectionInstrumentation | undefined,
): RepositoryProjections {
  const catalog = memoizeProjection("catalog", instrumentation, () => {
    const skillParents = buildSkillParentIndex(core.documents);
    const built = buildCatalog(
      core.documents,
      core.discoveredPaths,
      skillParents,
      {
        policy: core.config.metadata,
        ...(core.configPath ? { configPath: core.configPath } : {}),
      },
      core.excludedSupportDirectoryPaths,
    );
    return {
      catalog: built.catalog,
      diagnostics: built.diagnostics,
      skillParents,
    };
  });
  const agentSkills = memoizeProjection("agent-skills", instrumentation, () =>
    validateAgentSkills(core.documents),
  );
  const skillDiscovery = memoizeProjection(
    "skill-discovery",
    instrumentation,
    () =>
      prepareSkillDiscoveryIndex(
        core.documents,
        catalog().catalog,
        agentSkills(),
        {
          repositoryWideAdopted: core.config.skillDiscovery.adopted,
          ...(core.configPath ? { configPath: core.configPath } : {}),
        },
      ),
  );
  const classifications = memoizeProjection(
    "classifications",
    instrumentation,
    () => buildClassificationEvidenceIndex(core.documents),
  );
  const securityPolicies = memoizeProjection(
    "security-policies",
    instrumentation,
    () =>
      collectSecurityPolicyAssetEvidence(core.documents, core.config.security),
  );
  const contextLens = memoizeProjection("context-lens", instrumentation, () =>
    summarizeContextLensGovernance(core.documents, catalog().catalog),
  );
  return {
    catalog,
    agentSkills,
    skillDiscovery,
    classifications,
    securityPolicies,
    contextLens,
  };
}

function createRepositorySnapshot(
  core: RepositorySnapshotCore,
  projections: RepositoryProjections,
  repositoryPaths: ReadonlySet<string>,
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>,
  instrumentation?: RepositoryCollectionInstrumentation,
): RepositorySnapshot {
  let combinedDiagnostics: Diagnostic[] | undefined;
  const executableSurfaceInventory = memoizeProjection(
    "executable-surfaces",
    instrumentation,
    () =>
      buildExecutableSurfaceInventory({
        artifacts: core.artifacts,
        documents: core.documents,
        repositoryPaths,
        repositoryPathStates,
        incompleteSupportDirectories: core.excludedSupportDirectoryPaths,
        skillParents: projections.catalog().skillParents,
        securityPolicies: projections.securityPolicies(),
        dependencyCandidates: core.executableDependencyCandidates,
      }),
  );
  return Object.freeze({
    core,
    root: core.root,
    ...(core.configPath ? { configPath: core.configPath } : {}),
    config: core.config,
    evidenceBoundarySources: core.evidenceBoundarySources,
    artifacts: core.artifacts,
    documents: core.documents,
    repositoryPaths,
    repositoryPathStates,
    scannedFileCount: core.artifacts.length,
    discoveryDiagnostics: core.discoveryDiagnostics,
    get catalog() {
      return projections.catalog().catalog;
    },
    get catalogDiagnostics() {
      return projections.catalog().diagnostics;
    },
    get skillParents() {
      return projections.catalog().skillParents;
    },
    get agentSkills() {
      return projections.agentSkills();
    },
    get skillDiscovery() {
      return projections.skillDiscovery();
    },
    get skillDiscoveryDiagnostics() {
      return projections.skillDiscovery().diagnostics;
    },
    get classifications() {
      return projections.classifications();
    },
    get securityPolicies() {
      return projections.securityPolicies();
    },
    get executableSurfaceInventory() {
      return executableSurfaceInventory();
    },
    get contextLens() {
      return projections.contextLens().summary;
    },
    get contextLensDiagnostics() {
      return projections.contextLens().diagnostics;
    },
    get diagnostics() {
      combinedDiagnostics ??= immutableEvidenceGraph([
        ...core.discoveryDiagnostics,
        ...projections.catalog().diagnostics,
        ...projections.contextLens().diagnostics,
        ...projections.skillDiscovery().diagnostics,
      ]);
      return combinedDiagnostics;
    },
  });
}

function memoizeProjection<T>(
  name: RepositoryProjectionName,
  instrumentation: RepositoryCollectionInstrumentation | undefined,
  prepare: () => T,
): () => T {
  let state: { prepared: false } | { prepared: true; value: T } = {
    prepared: false,
  };
  return () => {
    if (!state.prepared) {
      instrumentation?.onProjection?.(name);
      state = { prepared: true, value: immutableEvidenceGraph(prepare()) };
    }
    return state.value;
  };
}

/**
 * Copy one collected or projected evidence graph into runtime-immutable values.
 * Set and Map need protected proxies because Object.freeze alone does not block
 * their mutator methods. The mutable backing collections stay unreachable.
 */
function immutableEvidenceGraph<T>(value: T): T {
  return immutableEvidenceValue(value, new Map<object, unknown>());
}

function immutableEvidenceValue<T>(value: T, copies: Map<object, unknown>): T {
  if (typeof value !== "object" || !value) {
    return value;
  }

  const existing = copies.get(value);
  if (existing !== undefined) return existing as T;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const item of value) copy.push(immutableEvidenceValue(item, copies));
    return Object.freeze(copy) as T;
  }

  if (value instanceof Set) {
    return immutableSet(value, copies) as T;
  }

  if (value instanceof Map) {
    return immutableMap(value, copies) as T;
  }

  const copy = Object.create(Object.getPrototypeOf(value)) as SnapshotObject;
  copies.set(value, copy);
  for (const property of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      descriptor.value = immutableEvidenceValue(descriptor.value, copies);
    }
    Object.defineProperty(copy, property, descriptor);
  }
  return Object.freeze(copy) as T;
}

function immutableSet<T>(
  source: Set<T>,
  copies: Map<object, unknown>,
): ReadonlySet<T> {
  const target = new Set<T>();
  const view: ReadonlySet<T> = new Proxy(target, {
    get(set, property) {
      if (SET_MUTATORS.has(property)) return immutableCollectionMutation;
      if (property === "forEach") {
        return (
          callback: (value: T, valueAgain: T, set: ReadonlySet<T>) => void,
          thisArg?: unknown,
        ) => set.forEach((item) => callback.call(thisArg, item, item, view));
      }
      const member = Reflect.get(set, property, set) as unknown;
      return typeof member === "function" ? member.bind(set) : member;
    },
  });
  copies.set(source, view);
  for (const item of source) {
    target.add(immutableEvidenceValue(item, copies));
  }
  return Object.freeze(view);
}

function immutableMap<K, V>(
  source: Map<K, V>,
  copies: Map<object, unknown>,
): ReadonlyMap<K, V> {
  const target = new Map<K, V>();
  const view: ReadonlyMap<K, V> = new Proxy(target, {
    get(map, property) {
      if (MAP_MUTATORS.has(property)) return immutableCollectionMutation;
      if (property === "forEach") {
        return (
          callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
          thisArg?: unknown,
        ) =>
          map.forEach((item, key) => callback.call(thisArg, item, key, view));
      }
      const member = Reflect.get(map, property, map) as unknown;
      return typeof member === "function" ? member.bind(map) : member;
    },
  });
  copies.set(source, view);
  for (const [key, item] of source) {
    target.set(
      immutableEvidenceValue(key, copies),
      immutableEvidenceValue(item, copies),
    );
  }
  return Object.freeze(view);
}

function immutableCollectionMutation(): never {
  throw new TypeError("Repository snapshot evidence is immutable");
}
