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
import type { Diagnostic } from "./types/diagnostics.js";
import type { ParsedDocument } from "./types/metadata.js";
import type { ScanConfig } from "./types/configuration.js";

export interface RepositoryEvidence {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  catalog: Catalog;
  contextLens: ContextLensSummary;
  diagnostics: Diagnostic[];
}

export interface RepositorySnapshot extends RepositoryEvidence {
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

export async function collectRepositoryEvidence(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<RepositoryEvidence> {
  const snapshot = await collectRepositorySnapshot(targetPath, overrides);
  return {
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    catalog: snapshot.catalog,
    contextLens: snapshot.contextLens,
    diagnostics: repositoryDiagnosticsWithoutSkillDiscovery(snapshot),
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

export async function collectRepositorySnapshot(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<RepositorySnapshot> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const {
    artifacts,
    diagnostics: discoveryDiagnostics,
    discoveredPaths,
  } = await discoverArtifacts(root, config);
  const documents = artifacts.map(parseDocument);
  const skillParents = buildSkillParentIndex(documents);
  const built = buildCatalog(documents, discoveredPaths, skillParents);
  const agentSkills = validateAgentSkills(documents);
  const skillDiscovery = prepareSkillDiscoveryIndex(
    documents,
    built.catalog,
    agentSkills,
    {
      repositoryWideAdopted: config.skillDiscovery.adopted,
      ...(configPath ? { configPath } : {}),
    },
  );
  const classifications = buildClassificationEvidenceIndex(documents);
  const securityPolicies = collectSecurityPolicyAssetEvidence(
    documents,
    config.security,
  );
  const contextLens = summarizeContextLensGovernance(documents, built.catalog);
  const repositoryPaths = await collectRepositoryPaths(
    root,
    artifacts,
    documents,
    built.catalog,
    discoveredPaths,
  );
  const repositoryPathStates = await collectRepositoryPathStates(
    root,
    [...repositoryPaths, ...repositoryPathCandidates(documents, built.catalog)],
    artifacts,
    config,
  );

  return {
    root,
    ...(configPath ? { configPath } : {}),
    config,
    artifacts,
    documents,
    repositoryPaths,
    repositoryPathStates,
    classifications,
    skillParents,
    securityPolicies,
    agentSkills,
    skillDiscovery,
    skillDiscoveryDiagnostics: skillDiscovery.diagnostics,
    scannedFileCount: artifacts.length,
    catalog: built.catalog,
    contextLens: contextLens.summary,
    discoveryDiagnostics,
    catalogDiagnostics: built.diagnostics,
    contextLensDiagnostics: contextLens.diagnostics,
    diagnostics: [
      ...discoveryDiagnostics,
      ...built.diagnostics,
      ...contextLens.diagnostics,
      ...skillDiscovery.diagnostics,
    ],
  };
}
