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
import { discoverArtifacts } from "./discovery.js";
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
import type { AssetClassificationEvidence } from "./types/classification.js";
import type { ScanConfig } from "./types/configuration.js";
import type { Diagnostic } from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";

export interface RepositorySnapshotCore {
  readonly root: string;
  readonly config: ScanConfig;
  readonly configPath?: string;
  readonly artifacts: Artifact[];
  readonly documents: ParsedDocument[];
  readonly discoveredPaths: ReadonlySet<string>;
  readonly discoveryDiagnostics: Diagnostic[];
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
  | "context-lens"
  | "repository-paths";

/** Focused collection hooks used only to prove collection/projection invariants. */
export interface RepositoryCollectionInstrumentation {
  onDiscovery?: (root: string) => void;
  onDocumentParse?: (artifactPath: string) => void;
  onProjection?: (projection: RepositoryProjectionName) => void;
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
  artifacts: Artifact[];
  documents: ParsedDocument[];
  repositoryPaths: ReadonlySet<string>;
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>;
  /** Snapshot-scoped indexes reused by commands without reinterpreting files. */
  classifications: ReadonlyMap<string, AssetClassificationEvidence>;
  skillParents: SkillParentIndex;
  securityPolicies: SecurityPolicyAssetEvidence[];
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
  classifications(): ReadonlyMap<string, AssetClassificationEvidence>;
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

/** Preserve pre-Discovery diagnostics for projections deferred beyond 0.22. */
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
): Promise<RepositorySnapshotCore> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  instrumentation?.onDiscovery?.(root);
  const {
    artifacts,
    diagnostics: discoveryDiagnostics,
    discoveredPaths,
  } = await discoverArtifacts(root, config);
  const documents = artifacts.map((artifact) => {
    instrumentation?.onDocumentParse?.(artifact.path);
    return parseDocument(artifact);
  });
  return immutableEvidenceGraph({
    root,
    config,
    ...(configPath ? { configPath } : {}),
    artifacts,
    documents,
    discoveredPaths,
    discoveryDiagnostics,
  });
}

export async function collectRepositorySnapshot(
  targetPath: string,
  overrides: ConfigOverrides = {},
  instrumentation?: RepositoryCollectionInstrumentation,
): Promise<RepositorySnapshot> {
  const core = await collectRepositorySnapshotCore(
    targetPath,
    overrides,
    instrumentation,
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
  );
  const repositoryPathStates = await collectRepositoryPathStates(
    core.root,
    [
      ...repositoryPaths,
      ...repositoryPathCandidates(core.documents, catalog.catalog),
    ],
    core.artifacts,
    core.config,
  );
  return createRepositorySnapshot(
    core,
    projections,
    immutableEvidenceGraph(repositoryPaths),
    immutableEvidenceGraph(repositoryPathStates),
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
): RepositorySnapshot {
  let combinedDiagnostics: Diagnostic[] | undefined;
  return Object.freeze({
    core,
    root: core.root,
    ...(core.configPath ? { configPath: core.configPath } : {}),
    config: core.config,
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
